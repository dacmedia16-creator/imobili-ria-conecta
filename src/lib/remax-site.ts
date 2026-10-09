/**
 * Coleta dos anúncios PÚBLICOS do site remax.com.br (pedido de Denis 09/10, tópico 6238).
 * Uma vez por dia, de madrugada, sem IA e sem custo. Guarda só o necessário para ligar captação <-> anúncio;
 * dos corretores, só ID, nome e escritório (NUNCA telefone nem e-mail).
 * Módulo sem dependências de servidor: a tarefa (server/tasks/remax-site-collect.ts) injeta o fetch e o banco.
 */

export const REMAX_SEARCH = "https://www.remax.com.br/search";
export const REMAX_USER_AGENT = "ADM-MAX-coleta/1.0 (+https://unicaescolha.com.br; 1x/dia)";
export const PAGE_SIZE = 500;
export const PAUSA_MS = 1500;
/** Status do anúncio no site: 160 = ativo (168/169/161 = vendido, alugado, suspenso). */
export const STATUS_ATIVO = 160;

/** Campos pedidos ao site (o resto dos ~225 campos nem chega). */
export const LISTING_FIELDS = [
  "MLSID",
  "AgentId",
  "OfficeId",
  "ListingStatusUID",
  "ShowContractTypeExclusive",
  "TransactionTypeUID",
  "StreetName",
  "StreetNumber",
  "LocalZone",
  "City",
  "PostalCode",
  "Location",
  "BuiltArea",
  "LivingArea",
  "TotalArea",
  "NumberOfBedrooms",
  "NumberOfBathrooms",
  "ParkingSpaces",
  "ListingPrice",
  "FirstUpdatedToWeb",
  "ShortLinks",
] as const;
export const AGENT_FIELDS = ["AgentId", "AgentName", "OfficeId"] as const;

export interface SiteListing {
  code: string;
  agent_id: string;
  office_id: number;
  status_uid: number | null;
  exclusivo: boolean | null;
  transacao: "venda" | "locacao" | null;
  tipo: string | null;
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  cep: string | null;
  lat: number | null;
  lon: number | null;
  area: number | null;
  quartos: number | null;
  banheiros: number | null;
  vagas: number | null;
  preco: number | null;
  publicado_em: string | null;
  url: string | null;
}
export interface SiteAgent {
  agent_id: string;
  nome: string;
  office_id: number;
}

export function searchBody(index: "listing" | "agent", office: number, skip: number) {
  const filter =
    index === "listing"
      ? `content/TenantId eq 6 and content/IsViewable eq true and content/OnHoldListing eq false and content/OfficeId eq ${office}`
      : `content/OfficeId eq ${office}`;
  const fields = index === "listing" ? LISTING_FIELDS : AGENT_FIELDS;
  return {
    count: true,
    top: PAGE_SIZE,
    skip,
    search: "*",
    filter,
    select: fields.map((f) => `content/${f}`).join(","),
  };
}

const str = (v: unknown, max: number): string | null => {
  const t = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return t ? t.slice(0, max) : null;
};
const numOrNull = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const intOrNull = (v: unknown) => {
  const n = numOrNull(v, 0, 99);
  return n == null ? null : Math.round(n);
};

/** Link pt-BR do anúncio (ShortLinks) -> { url, tipo }. Ex.: imoveis/apartamento/venda/... */
export function linkPtBr(shortLinks: unknown): { url: string | null; tipo: string | null } {
  if (!Array.isArray(shortLinks)) return { url: null, tipo: null };
  const pt = shortLinks.find(
    (s) => s && typeof s === "object" && (s as { LanguageCode?: string }).LanguageCode === "pt-BR",
  ) as { ShortLink?: string } | undefined;
  const path = typeof pt?.ShortLink === "string" ? pt.ShortLink.replace(/^\/+/, "") : "";
  if (!/^pt-br\/imoveis\//.test(path)) return { url: null, tipo: null };
  return {
    url: `https://www.remax.com.br/${encodeURI(decodeURI(path))}`,
    tipo: path.split("/")[2]?.slice(0, 60) || null,
  };
}

/** Converte um item do site (value[].content) no registro guardado. null = item inválido (ignorado). */
export function mapListing(raw: Record<string, unknown>): SiteListing | null {
  const code = typeof raw.MLSID === "string" ? raw.MLSID.trim() : "";
  const agent = String(raw.AgentId ?? "");
  const office = Number(raw.OfficeId);
  if (!/^[0-9]{9}-[0-9]{1,6}$/.test(code) || !/^[0-9]{9}$/.test(agent) || !Number.isInteger(office))
    return null;
  const loc = raw.Location as { coordinates?: unknown } | null | undefined;
  const coords = Array.isArray(loc?.coordinates) ? loc!.coordinates : [];
  const { url, tipo } = linkPtBr(raw.ShortLinks);
  const t = Number(raw.TransactionTypeUID);
  const area =
    numOrNull(raw.LivingArea, 0.01, 1e8) ??
    numOrNull(raw.BuiltArea, 0.01, 1e8) ??
    numOrNull(raw.TotalArea, 0.01, 1e8);
  const pub = numOrNull(raw.FirstUpdatedToWeb, 1, 4e9);
  return {
    code,
    agent_id: agent,
    office_id: office,
    status_uid: numOrNull(raw.ListingStatusUID, 0, 1e6),
    exclusivo:
      typeof raw.ShowContractTypeExclusive === "boolean" ? raw.ShowContractTypeExclusive : null,
    // Conferido em 09/10 pelos preços: 261 = venda (mediana R$ 450 mil), 260 = locação (mediana R$ 4.200).
    transacao: t === 261 ? "venda" : t === 260 ? "locacao" : null,
    tipo,
    rua: str(raw.StreetName, 200),
    numero: str(raw.StreetNumber, 20),
    bairro: str(raw.LocalZone, 120),
    cidade: str(raw.City, 120),
    cep: str(raw.PostalCode, 12),
    lat: numOrNull(coords[1], -90, 90),
    lon: numOrNull(coords[0], -180, 180),
    area,
    quartos: intOrNull(raw.NumberOfBedrooms),
    banheiros: intOrNull(raw.NumberOfBathrooms),
    vagas: intOrNull(raw.ParkingSpaces),
    preco: numOrNull(raw.ListingPrice, 0, 1e11),
    publicado_em: pub ? new Date(pub * 1000).toISOString() : null,
    url,
  };
}

/** Só ID, nome e escritório; telefone e e-mail são descartados aqui (nem chegam ao banco). */
export function mapAgent(raw: Record<string, unknown>): SiteAgent | null {
  const id = String(raw.AgentId ?? "");
  const nome = typeof raw.AgentName === "string" ? raw.AgentName.trim().slice(0, 160) : "";
  const office = Number(raw.OfficeId);
  if (!/^[0-9]{9}$/.test(id) || !nome || !Number.isInteger(office)) return null;
  return { agent_id: id, nome, office_id: office };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Lê todas as páginas de um escritório, uma por vez, com pausa. Lança erro se o formato mudar. */
export async function fetchOffice(
  fetchFn: FetchLike,
  index: "listing" | "agent",
  office: number,
  sleep: (ms: number) => Promise<void>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let skip = 0; skip < 10_000; skip += PAGE_SIZE) {
    const r = await fetchFn(`${REMAX_SEARCH}/${index}-search/docs/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://www.remax.com.br",
        Referer: "https://www.remax.com.br/",
        "User-Agent": REMAX_USER_AGENT,
      },
      body: JSON.stringify(searchBody(index, office, skip)),
    });
    if (!r.ok)
      throw new Error(`site RE/MAX respondeu HTTP ${r.status} (${index}, escritório ${office})`);
    const d = (await r.json()) as { value?: unknown; "@odata.count"?: unknown };
    if (!Array.isArray(d.value)) throw new Error(`formato do site mudou (${index}: sem "value")`);
    const page = d.value.map((v) =>
      v && typeof v === "object" && "content" in v
        ? (v as { content: Record<string, unknown> }).content
        : (v as Record<string, unknown>),
    );
    out.push(...page);
    const total = typeof d["@odata.count"] === "number" ? d["@odata.count"] : out.length;
    if (!page.length || out.length >= total) break;
    await sleep(PAUSA_MS);
  }
  return out;
}

export interface CollectDb {
  targets(): Promise<{ organization_id: string; offices: number[] }[]>;
  ingest(
    org: string,
    listings: SiteListing[],
    agents: SiteAgent[],
    started: string,
  ): Promise<unknown>;
  failed(org: string, message: string, started: string): Promise<void>;
}

/**
 * Coleta de todas as imobiliárias configuradas. Uma imobiliária que falha não atrapalha as outras e não apaga
 * nada (o banco mantém a última coleta boa). Retorna um resumo curto para o log da tarefa.
 */
export async function runRemaxSiteCollect(
  db: CollectDb,
  fetchFn: FetchLike,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string[]> {
  const log: string[] = [];
  for (const t of await db.targets()) {
    const started = new Date().toISOString();
    try {
      const listings: SiteListing[] = [];
      const agents: SiteAgent[] = [];
      for (const office of t.offices) {
        for (const raw of await fetchOffice(fetchFn, "listing", office, sleep)) {
          const m = mapListing(raw);
          if (m) listings.push(m);
        }
        await sleep(PAUSA_MS);
        for (const raw of await fetchOffice(fetchFn, "agent", office, sleep)) {
          const a = mapAgent(raw);
          if (a) agents.push(a);
        }
        await sleep(PAUSA_MS);
      }
      const res = await db.ingest(t.organization_id, listings, agents, started);
      log.push(`${t.organization_id}: ${JSON.stringify(res)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.failed(t.organization_id, msg, started).catch(() => undefined);
      log.push(`${t.organization_id}: falhou (${msg})`);
    }
  }
  return log;
}

/** Sugestão vinda do banco (exclusive_site_suggestions). */
export interface SiteSuggestion {
  code: string;
  score: number;
  confianca: "alta" | "media";
  motivos: string[];
  distancia_m: number | null;
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  tipo: string | null;
  transacao: "venda" | "locacao" | null;
  area: number | null;
  quartos: number | null;
  banheiros: number | null;
  vagas: number | null;
  preco: number | null;
  exclusivo: boolean | null;
  publicado_em: string | null;
  url: string | null;
}
export interface SiteSuggestions {
  prefix: string | null;
  coleta: string | null;
  items: SiteSuggestion[];
}

/** "casa-de-condominio" -> "Casa de condominio". */
export function tipoLegivel(slug: string | null | undefined): string {
  const t = (slug ?? "").replace(/^-+/, "").replace(/-/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Imóvel";
}

/** Linha curta para o cartão: "Casa · 150 m² · 3 quartos · R$ 650.000". */
export function resumoSugestao(s: SiteSuggestion): string {
  const p: string[] = [tipoLegivel(s.tipo)];
  if (s.area) p.push(`${s.area.toLocaleString("pt-BR")} m²`);
  if (s.quartos != null) p.push(`${s.quartos} ${s.quartos === 1 ? "quarto" : "quartos"}`);
  if (s.preco)
    p.push(
      s.preco.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }) + (s.transacao === "locacao" ? "/mês" : ""),
    );
  return p.join(" · ");
}
