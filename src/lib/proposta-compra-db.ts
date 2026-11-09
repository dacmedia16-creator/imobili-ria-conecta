// Cliente das RPCs da proposta de compra (t_4cff61a6; migration 20261109120000, ainda fora do types.ts gerado).
// Chamadas com o login de quem está na tela: o banco confere permissão, imobiliária e módulo ligado.
// O envio (Enviar / Reenviar) passa pela server function enviarProposta, nunca daqui.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as unknown as SupabaseClient;

async function rpc<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(nome, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Módulo "proposta_compra" ligado na imobiliária atual. Falha = desligado. */
export async function propostaCompraEnabled(): Promise<boolean> {
  try {
    return (await rpc<boolean>("proposta_compra_enabled")) === true;
  } catch {
    return false;
  }
}

export const listarPropostasDaCaptacao = (captureId: string) =>
  rpc<unknown[]>("proposta_lista_captacao", { _capture_id: captureId });
export const detalheProposta = (id: string) =>
  rpc<Record<string, unknown>>("proposta_detalhe", { _id: id });
export const criarProposta = (captureId: string, leadId: string | null) =>
  rpc<Record<string, unknown>>("proposta_criar", { _capture_id: captureId, _lead_id: leadId });
export const salvarProposta = (id: string, dados: Record<string, unknown>) =>
  rpc<Record<string, unknown>>("proposta_salvar", { _id: id, _dados: dados });
export const registrarPdfProposta = (id: string, versao: number, pdfHash: string) =>
  rpc<Record<string, unknown>>("proposta_registrar_pdf", {
    _id: id,
    _versao: versao,
    _pdf_hash: pdfHash,
  });
export const recusarProposta = (id: string, motivo: string) =>
  rpc<Record<string, unknown>>("proposta_recusar", { _id: id, _motivo: motivo });
export const contraproposta = (id: string) =>
  rpc<Record<string, unknown>>("proposta_contraproposta", { _id: id });
/** Só no clique de "Criar venda em rascunho". */
export const criarVendaDaProposta = (id: string) =>
  rpc<{ criada: boolean; venda_id: string }>("proposta_criar_venda", { _id: id });
export const pendenciasProposta = () => rpc<unknown[]>("proposta_pendencias");
/** Assinaturas válidas da versão atual para a página "Comprovação das assinaturas" (t_da0dac53). */
export const comprovacaoProposta = (id: string) =>
  rpc<Record<string, unknown>>("proposta_comprovacao", { _id: id });

/**
 * Anexa o PDF assinado aos documentos da venda recém-criada (mesmo caminho do upload de contrato:
 * bucket sale-documents + insert_sale_document, que confere a permissão na venda).
 */
export async function anexarPdfNaVenda(
  saleId: string,
  bytes: Uint8Array,
  nome: string,
): Promise<void> {
  const { storageOrganizationPath } = await import("@/lib/storage-org");
  const path = await storageOrganizationPath(
    `${saleId}/outros/proposta_assinada/${crypto.randomUUID()}.pdf`,
  );
  const { error } = await supabase.storage
    .from("sale-documents")
    .upload(path, new Blob([bytes as BlobPart], { type: "application/pdf" }), { upsert: false });
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.rpc("insert_sale_document", {
    _sale_id: saleId,
    _tipo: "proposta_assinada",
    _parte: "outros",
    _storage_path: path,
    _file_name: nome,
    _descricao: "Proposta de compra assinada (com comprovação das assinaturas)",
  });
  if (e2) throw new Error(e2.message);
}

/** SHA-256 (hex) do PDF gerado no navegador, para registrar a versão. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dig = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return Array.from(new Uint8Array(dig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
