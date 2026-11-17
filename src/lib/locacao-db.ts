// Cliente das RPCs da locação (t_74426f94; migration 20261110120000, ainda fora do types.ts gerado).
// Chamadas com o login de quem está na tela: o banco confere papel, etapa, imobiliária e módulo ligado.
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { extensaoDoc, extensaoMinuta, TAMANHO_MAX_DOC, type ImovelTipo } from "@/lib/locacao";

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

/** Ajuda MAX (t_365484dc): Locação + chave ajuda_max_locacao ligadas na imobiliária de quem está logado. */
export async function ajudaMaxLocacaoEnabled(): Promise<boolean> {
  try {
    return (await rpc<boolean>("ajuda_max_locacao_enabled")) === true;
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
/** Abre a locação já com o tipo do imóvel (t_8f09d406): condomínio, casa de rua ou comercial. */
export const criarLocacao = (imovelTipo: ImovelTipo | null = null) =>
  rpc<{ id: string }>("locacao_criar", { _imovel_tipo: imovelTipo });
export const definirImovelTipo = (id: string, tipo: ImovelTipo) =>
  rpc<{ ok: boolean; tipo: string }>("locacao_imovel_tipo_definir", { _id: id, _tipo: tipo });
/** Lançamento para comissão (Fernanda, papel vistoria; t_8f09d406 item 6). */
export const lerLancamento = (id: string) => rpc<unknown>("locacao_lancamento_ler", { _id: id });
export const salvarLancamento = (id: string, dados: Record<string, string | null>) =>
  rpc<{ ok: boolean; novo: boolean }>("locacao_lancamento_salvar", { _id: id, _dados: dados });
/** Pessoas ativas da imobiliária para o campo "corretor captador" (t_28e583e2). */
export const corretoresLocacao = () => rpc<unknown[]>("locacao_corretores");
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
export const lerMontagem = (id: string) => rpc<unknown>("locacao_montagem_ler", { _id: id });
export const salvarMontagem = (id: string, dados: Record<string, string>) =>
  rpc<{ ok: boolean }>("locacao_montagem_salvar", { _id: id, _dados: dados });
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

/** Modelos por imobiliária: toda edição/volta grava versão nova no banco. */
export const listarModelosLocacao = () => rpc<unknown[]>("locacao_modelos_listar");
export const lerModeloLocacao = (chave: string, versao: number | null = null) =>
  rpc<unknown>("locacao_modelo_ler", { _chave: chave, _versao: versao });
export const historicoModeloLocacao = (chave: string) =>
  rpc<unknown[]>("locacao_modelo_historico", { _chave: chave });
export const salvarModeloLocacao = (
  chave: string,
  paragrafos: unknown[],
  nota: string,
  confirma: boolean,
) =>
  rpc<unknown>("locacao_modelo_salvar", {
    _chave: chave,
    _paragrafos: paragrafos,
    _nota: nota,
    _confirma: confirma,
  });
export const restaurarModeloLocacao = (chave: string, versao: number, confirma: boolean) =>
  rpc<unknown>("locacao_modelo_restaurar", { _chave: chave, _versao: versao, _confirma: confirma });

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

const MIME_MINUTA: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function anexarGarantiaLocacao(
  locacaoId: string,
  tipo: "apolice" | "loft_termos",
  arquivo: File,
  numero: string,
): Promise<void> {
  const ext = extensaoDoc(arquivo.name);
  if (!ext) throw new Error("Envie PDF ou imagem (JPG, PNG, WEBP).");
  if (arquivo.size > TAMANHO_MAX_DOC) throw new Error("Arquivo maior que 16 MB.");
  const mime: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  if (arquivo.type !== mime[ext]) throw new Error("O tipo do arquivo não confere com a extensão.");
  const { prepararEnvioAnexoLocacao } = await import("@/lib/locacao.functions");
  const { path, token } = await prepararEnvioAnexoLocacao({ data: { locacaoId, tipo, ext } });
  const { error } = await supabase.storage
    .from("locacao-documentos")
    .uploadToSignedUrl(path, token, arquivo, { contentType: mime[ext] });
  if (error) throw new Error(error.message);
  await rpc("locacao_anexo_registrar", {
    _id: locacaoId,
    _tipo: tipo,
    _path: path,
    _nome: arquivo.name.slice(0, 200),
    _numero: numero.trim() || null,
  });
}

export async function abrirAnexoLocacao(anexoId: string): Promise<void> {
  const aba = window.open("", "_blank");
  if (aba) aba.opener = null;
  try {
    const { linkAnexoLocacao } = await import("@/lib/locacao.functions");
    const { url } = await linkAnexoLocacao({ data: { anexoId } });
    if (aba) aba.location.href = url;
    else window.location.href = url;
  } catch (e) {
    aba?.close();
    throw e;
  }
}

/**
 * Guarda um arquivo de minuta (t_f8f83f9f): servidor confere o papel e gera URL assinada → upload direto ao bucket
 * privado → registra a versão (v1, v2…). origem "gerada" = PDF do modelo ("Gerar e guardar"); "anexo" = feito por fora.
 */
export async function guardarMinuta(
  locacaoId: string,
  arquivo: Blob,
  nome: string,
  origem: "anexo" | "gerada",
  modelo?: { chave: string; versao: number },
): Promise<number> {
  const ext = extensaoMinuta(nome);
  if (!ext) throw new Error("Envie a minuta em PDF ou Word (.doc/.docx).");
  if (arquivo.size > TAMANHO_MAX_DOC) throw new Error("Arquivo maior que 16 MB.");
  const { prepararEnvioMinutaLocacao } = await import("@/lib/locacao.functions");
  const { path, token } = await prepararEnvioMinutaLocacao({ data: { locacaoId, ext } });
  const { error } = await supabase.storage
    .from("locacao-documentos")
    .uploadToSignedUrl(path, token, arquivo, { contentType: MIME_MINUTA[ext] });
  if (error) throw new Error(error.message);
  const reg = await rpc<{ versao?: unknown }>("locacao_minuta_registrar", {
    _id: locacaoId,
    _path: path,
    _nome: nome.slice(0, 200),
    _origem: origem,
    ...(modelo ? { _modelo_chave: modelo.chave, _modelo_versao: modelo.versao } : {}),
  });
  return typeof reg?.versao === "number" ? reg.versao : 0;
}

export async function baixarMinuta(minutaId: string): Promise<void> {
  // Abre a aba ainda no clique (senão o navegador bloqueia como pop-up) e só depois põe a URL assinada.
  const aba = window.open("", "_blank");
  if (aba) aba.opener = null;
  try {
    const { linkMinutaLocacao } = await import("@/lib/locacao.functions");
    const { url } = await linkMinutaLocacao({ data: { minutaId } });
    if (aba) aba.location.href = url;
    else window.location.href = url;
  } catch (e) {
    aba?.close();
    throw e;
  }
}

export const registrarAndamento = (id: string, texto: string, aguardando: string | null) =>
  rpc<{ id: string }>("locacao_andamento_registrar", {
    _id: id,
    _texto: texto,
    _aguardando: aguardando,
  });
export const resolverAndamento = (andamentoId: string, texto: string | null = null) =>
  rpc<boolean>("locacao_andamento_resolver", { _andamento: andamentoId, _texto: texto });

/** Leitura por IA de um documento (t_127811ca). Nunca lança por falha da IA: devolve o selo. */
export async function lerDocumentoIa(documentoId: string) {
  const { lerDocumentoLocacao } = await import("@/lib/locacao-ia.functions");
  return lerDocumentoLocacao({ data: { documentoId } });
}

/** URL assinada curta (5 min) de um documento ou anexo da locação; o banco confere quem pode ver. */
export async function linkArquivoLocacao(tipo: "documento" | "anexo", id: string): Promise<string> {
  const { linkDocumentoLocacao, linkAnexoLocacao } = await import("@/lib/locacao.functions");
  const { url } =
    tipo === "documento"
      ? await linkDocumentoLocacao({ data: { documentoId: id } })
      : await linkAnexoLocacao({ data: { anexoId: id } });
  return url;
}

export async function abrirDocumento(documentoId: string): Promise<void> {
  // Abre a aba ainda no clique (senão o navegador bloqueia como pop-up) e só depois põe a URL assinada.
  const aba = window.open("", "_blank");
  if (aba) aba.opener = null;
  try {
    const url = await linkArquivoLocacao("documento", documentoId);
    if (aba) aba.location.href = url;
    else window.location.href = url;
  } catch (e) {
    aba?.close();
    throw e;
  }
}
