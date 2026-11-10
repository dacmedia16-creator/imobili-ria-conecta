// Cliente das RPCs da locação (t_74426f94; migration 20261110120000, ainda fora do types.ts gerado).
// Chamadas com o login de quem está na tela: o banco confere papel, etapa, imobiliária e módulo ligado.
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { extensaoDoc, TAMANHO_MAX_DOC } from "@/lib/locacao";

const db = supabase as unknown as SupabaseClient;

async function rpc<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(nome, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Módulo "locacao" ligado na imobiliária atual. Falha = desligado. */
export async function locacaoEnabled(): Promise<boolean> {
  try {
    return (await rpc<boolean>("locacao_enabled")) === true;
  } catch {
    return false;
  }
}

/** Guarda das rotas; o banco repete a checagem em cada RPC. */
export async function guardLocacaoRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !(await locacaoEnabled())) throw redirect({ to: "/dashboard" });
}

export const contextoLocacao = () => rpc<unknown>("locacao_contexto");
export const listarLocacoes = () => rpc<unknown[]>("locacao_lista");
export const detalheLocacao = (id: string) => rpc<unknown>("locacao_detalhe", { _id: id });
export const criarLocacao = () => rpc<{ id: string }>("locacao_criar");
export const salvarPreAnalise = (id: string, dados: Record<string, unknown>) =>
  rpc<unknown>("locacao_salvar_pre", { _id: id, _dados: dados });
export const enviarPreAnalise = (id: string) => rpc<unknown>("locacao_enviar_pre", { _id: id });
export const gestoraDecidir = (id: string, aprovar: boolean, motivo: string | null) =>
  rpc<unknown>("locacao_gestora_decidir", { _id: id, _aprovar: aprovar, _motivo: motivo });
export const enviarDocumentacao = (id: string) =>
  rpc<unknown>("locacao_enviar_documentacao", { _id: id });
export const salvarContrato = (id: string, dados: Record<string, string | null>) =>
  rpc<{ ok: boolean; campos: number; faltando: string[] }>("locacao_contrato_salvar", {
    _id: id,
    _dados: dados,
  });
export const removerDocumento = (docId: string) =>
  rpc<boolean>("locacao_documento_remover", { _doc: docId });
export const contratosAcao = (id: string, acao: string, dados: Record<string, unknown> = {}) =>
  rpc<unknown>("locacao_contratos_acao", { _id: id, _acao: acao, _dados: dados });
export const corretorMinuta = (id: string, acao: string, texto: string | null = null) =>
  rpc<unknown>("locacao_corretor_minuta", { _id: id, _acao: acao, _texto: texto });
export const posAcao = (id: string, acao: string, dados: Record<string, unknown> = {}) =>
  rpc<{ ok: boolean; etapa: string; alerta?: boolean }>("locacao_pos_acao", {
    _id: id,
    _acao: acao,
    _dados: dados,
  });
export const enviarProtocolo = (id: string, servico: string, protocolo: string) =>
  rpc<unknown>("locacao_protocolo", { _id: id, _servico: servico, _protocolo: protocolo });
export const salvarConfigLocacao = (dados: Record<string, unknown>) =>
  rpc<unknown>("locacao_config_salvar", { _dados: dados });
export const listarPapeisLocacao = () => rpc<unknown[]>("locacao_papeis_lista");
export const definirPapelLocacao = (userId: string, papel: string, ativo: boolean) =>
  rpc<boolean>("locacao_papel_definir", { _user: userId, _papel: papel, _ativo: ativo });

/**
 * Envia um documento: servidor confere e gera URL assinada → upload direto ao bucket → registra no banco.
 * Se o registro falhar, o arquivo fica órfão no bucket privado (ninguém lê sem registro).
 */
export async function anexarDocumento(
  locacaoId: string,
  item: string,
  arquivo: File,
): Promise<string> {
  const ext = extensaoDoc(arquivo.name);
  if (!ext) throw new Error("Envie PDF ou imagem (JPG, PNG, WEBP).");
  if (arquivo.size > TAMANHO_MAX_DOC) throw new Error("Arquivo maior que 16 MB.");
  const { prepararEnvioDocumentoLocacao } = await import("@/lib/locacao.functions");
  const { path, token } = await prepararEnvioDocumentoLocacao({ data: { locacaoId, item, ext } });
  const { error } = await supabase.storage
    .from("locacao-documentos")
    .uploadToSignedUrl(path, token, arquivo, { contentType: arquivo.type || undefined });
  if (error) throw new Error(error.message);
  const reg = await rpc<{ id?: unknown }>("locacao_documento_registrar", {
    _id: locacaoId,
    _item: item,
    _path: path,
    _nome: arquivo.name.slice(0, 200),
  });
  return typeof reg?.id === "string" ? reg.id : "";
}

/** Leitura por IA de um documento (t_127811ca). Nunca lança por falha da IA: devolve o selo. */
export async function lerDocumentoIa(documentoId: string) {
  const { lerDocumentoLocacao } = await import("@/lib/locacao-ia.functions");
  return lerDocumentoLocacao({ data: { documentoId } });
}

export async function abrirDocumento(documentoId: string): Promise<void> {
  // Abre a aba ainda no clique (senão o navegador bloqueia como pop-up) e só depois põe a URL assinada.
  const aba = window.open("", "_blank");
  if (aba) aba.opener = null;
  try {
    const { linkDocumentoLocacao } = await import("@/lib/locacao.functions");
    const { url } = await linkDocumentoLocacao({ data: { documentoId } });
    if (aba) aba.location.href = url;
    else window.location.href = url;
  } catch (e) {
    aba?.close();
    throw e;
  }
}
