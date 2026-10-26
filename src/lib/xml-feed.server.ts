/**
 * "Link do XML (portais)" da imobiliária (card t_76243950) — lógica de servidor.
 * Fluxo: tela "Editar imobiliária" (só administrador da plataforma) -> server function -> aqui.
 * - ler/testar: assertPlatformAdmin (platform_admins) antes de tocar no service_role;
 * - salvar: RPC platform_xml_feed_salvar com o JWT de quem pede (o banco confere de novo e valida https);
 * - testar: download SEMPRE pelo servidor (fetchXmlSeguro: https, sem IP interno, até 3 redirecionamentos)
 *   e devolve só contagens. Nada é gravado no teste. O link nunca vai para log nem para mensagem de erro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPlatformAdmin } from "./platform-organizations.server";
import { parseVrsync } from "./remax-xml";
import { fetchXmlSeguro, LinkXmlInvalido, validarLinkXml, type ResolverDns } from "./xml-feed-seguro";

const LIMITE_BYTES = 60 * 1024 * 1024;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function lerLinkXml(admin: SupabaseClient, callerId: string, organizationId: string) {
  await assertPlatformAdmin(admin, callerId);
  const { data, error } = await admin
    .from("organization_xml_feeds")
    .select("url, updated_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível ler o link do XML.");
  const row = data as { url: string; updated_at: string } | null;
  return { url: row?.url ?? "", atualizadoEm: row?.updated_at ?? null };
}

export async function salvarLinkXml(
  user: SupabaseClient,
  admin: SupabaseClient,
  callerId: string,
  organizationId: string,
  url: string,
) {
  await assertPlatformAdmin(admin, callerId);
  const u = url.trim();
  if (u) validarLinkXml(u); // mensagem clara antes de ir ao banco (que confere de novo)
  const { error } = await user.rpc("platform_xml_feed_salvar", { _org: organizationId, _url: u || null });
  if (error) {
    if (error.code === "42501") throw new Error("Somente o super-admin da plataforma altera o link do XML.");
    if (error.code === "22023") throw new Error("Link inválido: use um endereço https.");
    throw new Error("Não foi possível salvar o link do XML.");
  }
  return { ok: true as const };
}

export type TesteXml =
  | { ok: true; total: number; venda: number; aluguel: number }
  | { ok: false; erro: string };

/** Baixa e conta. Só contagens na resposta (sem endereço, sem contato). */
export async function testarLinkXml(
  admin: SupabaseClient,
  callerId: string,
  url: string,
  deps: { fetchFn?: FetchLike; resolver?: ResolverDns } = {},
): Promise<TesteXml> {
  await assertPlatformAdmin(admin, callerId);
  return baixarEContar(url, deps);
}

export async function baixarEContar(
  url: string,
  deps: { fetchFn?: FetchLike; resolver?: ResolverDns } = {},
): Promise<TesteXml> {
  try {
    const res = await fetchXmlSeguro(
      url,
      {
        headers: { Accept: "application/xml,text/xml", "User-Agent": "ADM-MAX/1.0" },
        signal: AbortSignal.timeout(60_000),
      },
      deps,
    );
    if (!res.ok) return { ok: false, erro: `O link respondeu com erro ${res.status}.` };
    if (Number(res.headers.get("content-length") ?? 0) > LIMITE_BYTES)
      return { ok: false, erro: "O XML é grande demais (mais de 60 MB)." };
    const text = await res.text();
    if (text.length > LIMITE_BYTES) return { ok: false, erro: "O XML é grande demais (mais de 60 MB)." };
    const p = parseVrsync(text, "generico");
    return { ok: true, total: p.total, venda: p.venda.length, aluguel: p.total - p.venda.length };
  } catch (e) {
    if (e instanceof LinkXmlInvalido) return { ok: false, erro: e.message };
    if (e instanceof Error && /VRSync/.test(e.message))
      return { ok: false, erro: "O link não devolveu um XML de portal (VRSync)." };
    return { ok: false, erro: "Não foi possível baixar o XML agora." };
  }
}
