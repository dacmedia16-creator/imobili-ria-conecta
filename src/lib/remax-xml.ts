/**
 * Leitura do XML VRSync que a RE/MAX gera para a OLX/ZAP (t_698be0d2, regras de Denis 16/10/2026).
 * Só anúncios de VENDA ("For Sale") viram registro; aluguel é descartado aqui e nunca chega ao banco.
 * Nome, e-mail e telefone do corretor são guardados (para ligar ao cadastro do ADM), mas nunca vão para log.
 * A URL do XML é segredo do Worker (REMAX_XML_FEEDS) e não aparece em mensagens de erro.
 */

export interface XmlListing {
  code: string;
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
  url: string | null;
  escritorio: string | null;
  corretor_nome: string | null;
  corretor_email: string | null;
  corretor_telefone: string | null;
}

export interface XmlParse {
  /** Todos os <Listing> do arquivo (venda + aluguel), só para conferência. */
  total: number;
  venda: XmlListing[];
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
      return ENT[k] ?? m;
    })
    .trim();
}

/** Conteúdo da PRIMEIRA tag com esse nome (sem atributos obrigatórios). null = ausente ou vazia. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  if (!m) return null;
  const v = decode(m[1]);
  return v || null;
}

const cut = (v: string | null, n: number) => (v ? v.slice(0, n) : null);
function num(v: string | null, min: number, max: number): number | null {
  if (v == null) return null;
  const x = Number(v.replace(",", "."));
  return Number.isFinite(x) && x >= min && x <= max ? x : null;
}
const int = (v: string | null) => {
  const x = num(v, 0, 99);
  return x == null ? null : Math.trunc(x);
};

/**
 * "Residential / Apartment" -> mesmo slug do site RE/MAX ("apartamento"), para os filtros do mapa e as
 * comparações de preço continuarem iguais. Tipo desconhecido vira "outros".
 */
const TIPOS: Record<string, string> = {
  "residential / apartment": "apartamento",
  "residential / home": "casa",
  "residential / land lot": "terreno",
  "commercial / land lot": "terreno",
  "residential / condo": "casa-de-condominio",
  "residential / farm ranch": "chacara",
  "residential / sobrado": "sobrado",
  "residential / studio": "studio",
  "residential / kitnet": "kitnet",
  "residential / penthouse": "cobertura",
  "residential / flat": "flat",
  "residential / village house": "casa-de-vila",
  "commercial / building": "predio",
  "commercial / edificio comercial": "predio",
  "commercial / office": "cj-comercial",
  "commercial / industrial": "galpao",
  "commercial / business": "ponto-comercial",
};
export function tipoXml(propertyType: string | null): string | null {
  if (!propertyType) return null;
  return TIPOS[propertyType.trim().toLowerCase()] ?? "outros";
}

/** Converte um <Listing> de venda. null = aluguel ou código fora do padrão RE/MAX (ignorado). */
export function mapXmlListing(item: string): XmlListing | null {
  if (tag(item, "TransactionType") !== "For Sale") return null;
  const code = (tag(item, "ListingID") ?? "").trim();
  if (!/^[0-9]{9}-[0-9]{1,6}$/.test(code)) return null;
  const details = tag(item, "Details") ?? "";
  // <Location> do imóvel vem antes de <ContactInfo> (que tem a própria <Location> do escritório).
  const contact = tag(item, "ContactInfo") ?? "";
  const semContato = item.replace(/<ContactInfo>[\s\S]*?<\/ContactInfo>/, "");
  const loc = tag(semContato, "Location") ?? "";
  const lat = num(tag(loc, "Latitude"), -90, 90);
  const lon = num(tag(loc, "Longitude"), -180, 180);
  const coordOk = lat != null && lon != null && !(lat === 0 && lon === 0);
  const url = tag(item, "DetailViewUrl");
  return {
    code,
    tipo: tipoXml(tag(details, "PropertyType")),
    rua: cut(tag(loc, "Address"), 200),
    numero: cut(tag(loc, "StreetNumber"), 20),
    bairro: cut(tag(loc, "Neighborhood"), 120),
    cidade: cut(tag(loc, "City"), 120),
    cep: cut(tag(loc, "PostalCode"), 12),
    lat: coordOk ? lat : null,
    lon: coordOk ? lon : null,
    area: num(tag(details, "LivingArea"), 0.01, 1e8) ?? num(tag(details, "LotArea"), 0.01, 1e8),
    quartos: int(tag(details, "Bedrooms")),
    banheiros: int(tag(details, "Bathrooms")),
    vagas: int(tag(details, "Garage")),
    preco: num(tag(details, "ListPrice"), 1, 1e11),
    url: url && /^https?:\/\/(www\.)?remax\.com\.br\//.test(url) ? url.slice(0, 300) : null,
    escritorio: cut(tag(contact, "OfficeName"), 120),
    corretor_nome: cut(tag(contact, "Name"), 160),
    corretor_email: cut(tag(contact, "Email")?.toLowerCase() ?? null, 200),
    corretor_telefone: cut(tag(contact, "Telephone"), 30),
  };
}

/** Lê o arquivo inteiro. Lança erro se não for um feed VRSync (ex.: página de erro em HTML). */
export function parseVrsync(xml: string): XmlParse {
  const s = xml.replace(/^\uFEFF/, "");
  if (!/<ListingDataFeed[\s>]/.test(s)) throw new Error("Arquivo não é um XML VRSync");
  const items = s.match(/<Listing>[\s\S]*?<\/Listing>/g) ?? [];
  const venda: XmlListing[] = [];
  for (const it of items) {
    const m = mapXmlListing(it);
    if (m) venda.push(m);
  }
  return { total: items.length, venda };
}

/** REMAX_XML_FEEDS = {"<organization_id>": "https://..."}. Valor inválido = nenhuma imobiliária. */
export function feedTargets(raw: string | undefined): { org: string; url: string }[] {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(obj)
      .filter(
        ([org, url]) =>
          /^[0-9a-f-]{36}$/i.test(org) && typeof url === "string" && /^https:\/\//.test(url),
      )
      .map(([org, url]) => ({ org, url: url as string }));
  } catch {
    return [];
  }
}

export interface XmlCollectDb {
  ingest(org: string, listings: XmlListing[], total: number, started: string): Promise<unknown>;
  failed(org: string, message: string, started: string): Promise<void>;
}
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const LIMITE_BYTES = 60 * 1024 * 1024;

/** Coleta diária: baixa, lê e grava. Mensagem de erro nunca leva a URL nem dados de corretor. */
export async function runRemaxXmlCollect(
  targets: { org: string; url: string }[],
  db: XmlCollectDb,
  fetchFn: FetchLike,
): Promise<string[]> {
  const log: string[] = [];
  for (const t of targets) {
    const started = new Date().toISOString();
    try {
      const res = await fetchFn(t.url, {
        headers: { Accept: "application/xml,text/xml", "User-Agent": "ADM-MAX/1.0" },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`XML respondeu ${res.status}`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > LIMITE_BYTES) throw new Error("XML grande demais");
      const text = await res.text();
      if (text.length > LIMITE_BYTES) throw new Error("XML grande demais");
      const p = parseVrsync(text);
      const r = await db.ingest(t.org, p.venda, p.total, started);
      log.push(`${t.org}: ${JSON.stringify(r)}`);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const msg = raw.replaceAll(t.url, "[url]").replace(/https?:\/\/\S+/g, "[url]").slice(0, 200);
      await db.failed(t.org, msg, started).catch(() => undefined);
      log.push(`${t.org}: falhou (${msg})`);
    }
  }
  return log;
}
