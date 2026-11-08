// Cliente do bloco "Link de acompanhamento" da venda (t_54c79bdc). RPCs da migration 20261108200000 (ainda
// fora do types.ts gerado). Chamadas com o login de quem está na tela: o banco confere se a pessoa já vê a venda.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lerLinksVenda, type Lado, type LinksVenda } from "@/lib/link-acompanhamento";

const db = supabase as unknown as SupabaseClient;

/** Módulo "link_acompanhamento" ligado na imobiliária atual. Falha = desligado. */
export async function linkAcompanhamentoEnabled(): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("link_acompanhamento_enabled");
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function carregarLinksVenda(saleId: string): Promise<LinksVenda> {
  const { data, error } = await db.rpc("acompanhamento_links", { _sale_id: saleId });
  if (error) throw new Error(error.message);
  return lerLinksVenda(data);
}

export async function regenerarLinkVenda(saleId: string, lado: Lado): Promise<LinksVenda> {
  const { data, error } = await db.rpc("acompanhamento_link_regenerar", {
    _sale_id: saleId,
    _lado: lado,
  });
  if (error) throw new Error(error.message);
  return lerLinksVenda(data);
}

/** Cadastro da imobiliária: "Link de avaliação no Google" (só admin; o banco confere). */
export async function lerGoogleAvaliacao(orgId: string): Promise<string> {
  const { data } = await db
    .from("organizations")
    .select("google_avaliacao_url")
    .eq("id", orgId)
    .maybeSingle();
  return (data as { google_avaliacao_url?: string | null } | null)?.google_avaliacao_url ?? "";
}

export async function salvarGoogleAvaliacao(url: string): Promise<string> {
  const { data, error } = await db.rpc("agency_google_avaliacao_salvar", { _url: url });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? "";
}
