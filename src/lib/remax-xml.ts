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
  // Só no modo "generico" (XML de portal de qualquer imobiliária, t_76243950). No modo RE/MAX ficam ausentes.
  titulo?: string | null;
  condominio?: number | null;
  iptu?: number | null;
  iptu_periodo?: "mensal" | "anual" | null;
  suites?: number | null;
  fotos_qtd?: number | null;
  area_util?: number | null;
  area_terreno?: number | null;
  /** Só no genérico (t_25fe1197): venda, locação ou os dois. RE/MAX = sempre venda (campo ausente). */
  negocio?: "venda" | "locacao" | "venda_locacao";
  /** Só no genérico: aluguel mensal anunciado (<RentalPrice>). */
  preco_aluguel?: number | null;
}

/**
 * "remax": XML da RE/MAX (código 123456789-42, link remax.com.br, contato do corretor guardado).
 * "generico": VRSync de qualquer imobiliária (código livre de 1 a 60 caracteres, NENHUM contato guardado).
 */
export type ModoXml = "remax" | "generico";

export interface XmlParse {
  /** Todos os <Listing> do arquivo (venda + aluguel), só para conferência. */
  total: number;
  /** Anúncios gravados. RE/MAX: só venda. Genérico: venda E locação (ver `negocio`); conte só venda com
   * `soVenda(p.venda)`. O nome do campo ficou para não mexer nos chamadores da Única Escolha. */
  venda: XmlListing[];
}

/** Só os anúncios de venda (o que mapa, Feedback e contagens sempre usaram). */
export const soVenda = (xs: XmlListing[]) => xs.filter((l) => (l.negocio ?? "venda") === "venda");

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
  "residential / allotment land": "terreno",
  "commercial / allotment land": "terreno",
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

/** Código aceito no modo genérico (o banco confere o mesmo padrão em remax_xml_ingest). */
export const CODIGO_GENERICO_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/;

/**
 * Link de anúncio aceito (modo genérico e 1ª mensagem da Nicole, t_25fe1197): só https, com nome (IP é
 * recusado), sem usuário/senha, porta padrão, sem espaço e com até 300 caracteres (link maior é descartado,
 * não cortado: cortado ficaria quebrado). Mesma regra do banco (remax_xml_ingest, modo 'generico').
 */
export function urlAnuncioSegura(u: string | null | undefined): string | null {
  const s = (u ?? "").trim();
  if (!s || s.length > 300 || !/^https:\/\/[A-Za-z0-9.-]+(:443)?\/[^\s<>"'@\\]*$/.test(s)) return null;
  try {
    const x = new URL(s);
    if (x.protocol !== "https:" || x.username || x.password || (x.port && x.port !== "443")) return null;
    if (/^[0-9.]+$/.test(x.hostname) || !x.hostname.includes(".")) return null;
    return s;
  } catch {
    return null;
  }
}

const hostDe = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");

/** Atributo period="Monthly|Yearly" do <Iptu>. */
function periodoIptu(details: string): "mensal" | "anual" | null {
  const p = /<Iptu\b[^>]*\bperiod="([^"]*)"/i.exec(details)?.[1]?.toLowerCase();
  return p === "monthly" ? "mensal" : p === "yearly" ? "anual" : null;
}

/** Negócio do anúncio genérico. RE/MAX: só "For Sale" (como sempre). */
const NEGOCIO: Record<string, "venda" | "locacao" | "venda_locacao"> = {
  "for sale": "venda",
  "for rent": "locacao",
  "sale/rent": "venda_locacao",
};

/**
 * Converte um <Listing>. RE/MAX: só venda (aluguel = null, como sempre). Genérico (t_25fe1197): venda e
 * locação, com o negócio identificado. null = código fora do padrão do modo ou negócio desconhecido.
 */
export function mapXmlListing(item: string, modo: ModoXml = "remax"): XmlListing | null {
  const generico = modo === "generico";
  const tx = (tag(item, "TransactionType") ?? "").trim();
  const negocio = generico ? NEGOCIO[tx.toLowerCase()] : tx === "For Sale" ? "venda" : undefined;
  if (!negocio) return null;
  const code = (tag(item, "ListingID") ?? "").trim();
  if (!(generico ? CODIGO_GENERICO_RE : /^[0-9]{9}-[0-9]{1,6}$/).test(code)) return null;
  const details = tag(item, "Details") ?? "";
  // <Location> do imóvel vem antes de <ContactInfo> (que tem a própria <Location> do escritório).
  const contact = tag(item, "ContactInfo") ?? "";
  const semContato = item.replace(/<ContactInfo>[\s\S]*?<\/ContactInfo>/, "");
  const loc = tag(semContato, "Location") ?? "";
  const lat = num(tag(loc, "Latitude"), -90, 90);
  const lon = num(tag(loc, "Longitude"), -180, 180);
  const coordOk = lat != null && lon != null && !(lat === 0 && lon === 0);
  const url = tag(item, "DetailViewUrl");
  const base = {
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
    // RE/MAX: só remax.com.br (como sempre). Genérico (t_25fe1197): o link do anúncio no site da própria
    // imobiliária, se for seguro; parseVrsync ainda descarta o que não for do domínio principal do feed.
    url: generico
      ? urlAnuncioSegura(url)
      : url && /^https?:\/\/(www\.)?remax\.com\.br\//.test(url)
        ? url.slice(0, 300)
        : null,
  };
  if (!generico)
    return {
      ...base,
      escritorio: cut(tag(contact, "OfficeName"), 120),
      corretor_nome: cut(tag(contact, "Name"), 160),
      corretor_email: cut(tag(contact, "Email")?.toLowerCase() ?? null, 200),
      corretor_telefone: cut(tag(contact, "Telephone"), 30),
    };
  // Genérico: nenhum contato (nem do escritório) é lido. Título sem link/telefone/e-mail.
  const titulo = cut(tag(item, "Title"), 200);
  const fotos = (tag(item, "Media") ?? "").match(/<Item\b[^>]*\bmedium="image"/gi)?.length ?? 0;
  return {
    ...base,
    escritorio: null,
    corretor_nome: null,
    corretor_email: null,
    corretor_telefone: null,
    titulo: titulo && !/(https?:|www\.|@|\d{4,5}-?\d{4})/i.test(titulo) ? titulo : null,
    condominio: num(tag(details, "PropertyAdministrationFee"), 0, 1e7),
    iptu: num(tag(details, "Iptu"), 0, 1e8),
    iptu_periodo: periodoIptu(details),
    suites: int(tag(details, "Suites")),
    fotos_qtd: Math.min(fotos, 999),
    area_util: num(tag(details, "LivingArea"), 0.01, 1e8),
    area_terreno: num(tag(details, "LotArea"), 0.01, 1e8),
    negocio,
    preco_aluguel: negocio === "venda" ? null : num(tag(details, "RentalPrice"), 1, 1e9),
  };
}

/**
 * Chave única do anúncio, a MESMA de public.portal_code_key / portal_listing_snapshots:
 * "630601005-0114", "630601005x114" e "630601005XX114" viram "630601005-114" (une os pares -93/x93).
 */
export { codeKey } from "./feedback-captacao";

/** Resumo de QUALQUER anúncio do XML (venda ou aluguel), para conferência e cruzamento de corretores. */
export interface XmlAnuncio {
  /** Código como veio no XML (formato com hífen, ex.: 630601201-93). */
  code: string;
  transacao: "venda" | "aluguel" | "outro";
  escritorio: string | null;
  /** ID RE/MAX do corretor = 9 dígitos iniciais do código; null se o código fugir do padrão. */
  remax_id: string | null;
  corretor_nome: string | null;
  corretor_email: string | null;
  corretor_telefone: string | null;
}

/** Lê o resumo de um <Listing> (sem filtrar aluguel). */
export function resumoListing(item: string): XmlAnuncio {
  const code = (tag(item, "ListingID") ?? "").trim();
  const tx = tag(item, "TransactionType");
  const contact = tag(item, "ContactInfo") ?? "";
  const m = /^([0-9]{9})(?:-|x{1,2})[0-9]+$/i.exec(code);
  return {
    code,
    transacao: tx === "For Sale" ? "venda" : tx === "For Rent" ? "aluguel" : "outro",
    escritorio: cut(tag(contact, "OfficeName"), 120),
    remax_id: m ? m[1] : null,
    corretor_nome: cut(tag(contact, "Name"), 160),
    corretor_email: cut(tag(contact, "Email")?.toLowerCase() ?? null, 200),
    corretor_telefone: cut(tag(contact, "Telephone"), 30),
  };
}

function listingsDe(xml: string): string[] {
  const s = xml.replace(/^\uFEFF/, "");
  if (!/<ListingDataFeed[\s>]/.test(s)) throw new Error("Arquivo não é um XML VRSync");
  return s.match(/<Listing>[\s\S]*?<\/Listing>/g) ?? [];
}

/** Todos os anúncios (venda + aluguel) em formato resumido. */
export function listarAnunciosVrsync(xml: string): XmlAnuncio[] {
  return listingsDe(xml).map(resumoListing);
}

/** Contagens do arquivo (conferência; sem dados pessoais). */
export function contagemVrsync(anuncios: XmlAnuncio[]) {
  const ids = new Set(anuncios.map((a) => a.remax_id).filter(Boolean));
  return {
    total: anuncios.length,
    venda: anuncios.filter((a) => a.transacao === "venda").length,
    aluguel: anuncios.filter((a) => a.transacao === "aluguel").length,
    corretores: ids.size,
    com_email: anuncios.filter((a) => a.corretor_email).length,
    com_telefone: anuncios.filter((a) => a.corretor_telefone).length,
  };
}

/** Lê o arquivo inteiro. Lança erro se não for um feed VRSync (ex.: página de erro em HTML). */
export function parseVrsync(xml: string, modo: ModoXml = "remax"): XmlParse {
  const items = listingsDe(xml);
  const venda: XmlListing[] = [];
  for (const it of items) {
    const m = mapXmlListing(it, modo);
    if (m) venda.push(m);
  }
  // Genérico: só fica o link do domínio que o próprio feed mais usa (o site da imobiliária). Um anúncio
  // com link para outro site (portal, encurtador, endereço estranho) fica sem link.
  if (modo === "generico") {
    const conta = new Map<string, number>();
    for (const l of venda) if (l.url) conta.set(hostDe(l.url), (conta.get(hostDe(l.url)) ?? 0) + 1);
    const principal = [...conta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    for (const l of venda) if (l.url && hostDe(l.url) !== principal) l.url = null;
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
  ingest(
    org: string,
    listings: XmlListing[],
    total: number,
    started: string,
    modo?: ModoXml,
  ): Promise<unknown>;
  failed(org: string, message: string, started: string): Promise<void>;
}
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const LIMITE_BYTES = 60 * 1024 * 1024;

/**
 * Coleta: baixa, lê e grava. Mensagem de erro nunca leva a URL nem dados de corretor.
 * Alvo sem `modo` = RE/MAX (REMAX_XML_FEEDS, 1x/dia). `modo: "generico"` = link cadastrado na tela.
 */
export async function runRemaxXmlCollect(
  targets: { org: string; url: string; modo?: ModoXml }[],
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
      const p = parseVrsync(text, t.modo);
      // Modo RE/MAX: mesma chamada de sempre (4 argumentos); o genérico informa o modo ao banco.
      const r =
        t.modo === "generico"
          ? await db.ingest(t.org, p.venda, p.total, started, "generico")
          : await db.ingest(t.org, p.venda, p.total, started);
      log.push(`${t.org}: ${JSON.stringify(r)}`);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const msg = raw
        .replaceAll(t.url, "[url]")
        .replace(/https?:\/\/\S+/g, "[url]")
        .slice(0, 200);
      await db.failed(t.org, msg, started).catch(() => undefined);
      log.push(`${t.org}: falhou (${msg})`);
    }
  }
  return log;
}
