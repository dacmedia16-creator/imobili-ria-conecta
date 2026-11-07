import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { partesComExigenciaPessoal } from "./status";

/**
 * Números dos compradores/vendedores extras (2, 3, ...) que a aba Documentos precisa mostrar.
 *
 * Usa a MESMA lista da validação de envio (partesComExigenciaPessoal): parte com nome na aba Partes
 * ou com documento ativo. Antes a aba Documentos olhava só os documentos — se o corretor arquivava
 * os documentos de um vendedor extra, o bloco sumia, mas a parte continuava gravada com nome e o
 * envio seguia cobrando os documentos dela, apontando para um bloco que não existia (t_b0d45ab1).
 */
export function numerosPartesExtras(
  tipo: "comprador" | "vendedor",
  parties: Parameters<typeof partesComExigenciaPessoal>[0],
  docs: Parameters<typeof partesComExigenciaPessoal>[1],
): number[] {
  const re = new RegExp(`^${tipo}_(\\d+)$`);
  const nums = partesComExigenciaPessoal(parties, docs)
    .map((p) => Number(p.match(re)?.[1] ?? 0))
    .filter((n) => n > 1);
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

/**
 * Remove de vez um comprador_N/vendedor_N extra da venda: arquiva os documentos ativos dessa parte
 * (mesma RPC do botão "Excluir" do documento, que mantém o arquivo para auditoria), apaga a linha
 * da parte e a conta bancária dela. Usado pelas abas Partes e Documentos, para "Remover" nunca
 * deixar resquício que a validação de envio continue cobrando. Idempotente: repetir após uma falha
 * parcial termina o serviço.
 */
export async function removerParteDaVenda(
  db: SupabaseClient<Database>,
  saleId: string,
  papel: string,
): Promise<{ error: string | null; docsArquivados: string[] }> {
  const docsArquivados: string[] = [];
  const m = papel.match(/^(comprador|vendedor)_(\d+)$/);
  if (!m || m[2] === "1")
    return { error: "Só é possível remover um comprador/vendedor extra.", docsArquivados };

  const { data: docs, error: docsError } = await db
    .from("sale_documents")
    .select("id")
    .eq("sale_id", saleId)
    .eq("parte", papel)
    .is("deleted_at", null);
  if (docsError) return { error: docsError.message, docsArquivados };
  for (const d of docs ?? []) {
    const { error } = await db.rpc("archive_sale_document", { _document_id: d.id });
    if (error) return { error: error.message, docsArquivados };
    docsArquivados.push(d.id);
  }

  const { error: partyError } = await db
    .from("sale_parties")
    .delete()
    .eq("sale_id", saleId)
    .eq("papel", papel);
  if (partyError) return { error: partyError.message, docsArquivados };

  const { error: bankError } = await db
    .from("sale_bank_accounts")
    .delete()
    .eq("sale_id", saleId)
    .eq("parte", papel);
  if (bankError) return { error: bankError.message, docsArquivados };

  return { error: null, docsArquivados };
}
