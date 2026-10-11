// Lógica da função estudo-vendas-reais sem dependências do Deno (testável localmente com vitest).
// SOMENTE LEITURA. Cada imobiliária tem a própria chave; a organização vem da chave (hash SHA-256
// conferido no banco por estudo_vendas_reais), nunca de parâmetro do chamador.
// Saída: só os campos permitidos por Denis (11/10/2026). Nenhum dado pessoal, código, número,
// complemento, data exata ou coordenada.

// Só a RPC é usada: a função nunca lê tabelas diretamente.
type AdminClient = {
  rpc: (
    fn: string,
    args: { _key_hash: string },
  ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

export type CoreResult = { status: number; body: Record<string, unknown> };

export const TIPOS = [
  "Apartamento",
  "Casa",
  "Terreno",
  "Comercial",
  "Cobertura",
  "Studio",
] as const;
export const MAX_RESULTADOS = 200;

/** Lista FECHADA de campos que podem sair. Qualquer coluna nova da RPC é descartada aqui. */
export const CAMPOS_PERMITIDOS = [
  "tipo_imovel",
  "area_m2",
  "valor_venda",
  "preco_m2",
  "mes_assinatura",
  "rua",
  "bairro",
  "cidade",
  "uf",
  "quartos",
  "suites",
  "banheiros",
  "vagas",
] as const;

export type VendaReal = {
  tipo_imovel: string | null;
  area_m2: number | null;
  valor_venda: number;
  preco_m2: number | null;
  mes_assinatura: string;
  rua: string | null;
  bairro: string | null;
  cidade: string;
  uf: string | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
};

export type Filtros = {
  cidade?: string;
  uf?: string;
  bairros?: string[];
  tipo?: string;
  area_min?: number;
  area_max?: number;
};

export async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação de texto sem acento/caixa ("São Paulo" == "sao paulo"). */
export function normalizar(t: unknown): string {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function texto(v: unknown, max = 120): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

export function lerFiltros(body: Record<string, unknown> | null): Filtros {
  const f: Filtros = {};
  f.cidade = texto(body?.cidade);
  const uf = texto(body?.uf, 2);
  if (uf && /^[A-Za-z]{2}$/.test(uf)) f.uf = uf.toUpperCase();
  if (Array.isArray(body?.bairros)) {
    const b = (body!.bairros as unknown[]).map((x) => texto(x)).filter((x): x is string => !!x);
    if (b.length) f.bairros = b.slice(0, 30);
  }
  const tipo = texto(body?.tipo, 20);
  if (tipo && (TIPOS as readonly string[]).includes(tipo)) f.tipo = tipo;
  const amin = num(body?.area_min);
  const amax = num(body?.area_max);
  if (amin !== null && amin > 0) f.area_min = amin;
  if (amax !== null && amax > 0) f.area_max = amax;
  return f;
}

/** Copia só os campos permitidos (lista fechada), com tipos normalizados. */
export function sanitizar(row: Record<string, unknown>): VendaReal {
  const area = num(row.area_m2);
  const valor = num(row.valor_venda) ?? 0;
  const precoM2 = num(row.preco_m2);
  const mes =
    typeof row.mes_assinatura === "string" && /^\d{4}-\d{2}$/.test(row.mes_assinatura)
      ? row.mes_assinatura
      : "";
  return {
    tipo_imovel: texto(row.tipo_imovel, 20) ?? null,
    area_m2: area !== null && area > 0 ? area : null,
    valor_venda: valor,
    preco_m2: area !== null && area > 0 && precoM2 !== null && precoM2 > 0 ? precoM2 : null,
    mes_assinatura: mes,
    rua: texto(row.rua) ?? null,
    bairro: texto(row.bairro) ?? null,
    cidade: texto(row.cidade) ?? "",
    uf: texto(row.uf, 2) ?? null,
    quartos: num(row.quartos),
    suites: num(row.suites),
    banheiros: num(row.banheiros),
    vagas: num(row.vagas),
  };
}

export function aplicarFiltros(vendas: VendaReal[], f: Filtros): VendaReal[] {
  const cidade = f.cidade ? normalizar(f.cidade) : null;
  const bairros = f.bairros ? new Set(f.bairros.map(normalizar)) : null;
  return vendas.filter((v) => {
    if (cidade && normalizar(v.cidade) !== cidade) return false;
    if (f.uf && v.uf && v.uf !== f.uf) return false;
    if (bairros && !bairros.has(normalizar(v.bairro))) return false;
    if (f.tipo && v.tipo_imovel !== f.tipo) return false;
    // Faixa de metragem: venda sem área não entra quando a faixa foi pedida.
    if (f.area_min !== undefined && (v.area_m2 === null || v.area_m2 < f.area_min)) return false;
    if (f.area_max !== undefined && (v.area_m2 === null || v.area_m2 > f.area_max)) return false;
    return true;
  });
}

/** Resumo de R$/m²: só vendas COM área (as sem área aparecem na lista, mas não entram no cálculo). */
export function resumo(vendas: VendaReal[]) {
  const m2 = vendas
    .map((v) => v.preco_m2)
    .filter((x): x is number => x !== null && x > 0)
    .sort((a, b) => a - b);
  const mediana = m2.length
    ? m2.length % 2
      ? m2[(m2.length - 1) / 2]
      : (m2[m2.length / 2 - 1] + m2[m2.length / 2]) / 2
    : null;
  const media = m2.length ? m2.reduce((s, x) => s + x, 0) / m2.length : null;
  return {
    total: vendas.length,
    com_area: m2.length,
    sem_area: vendas.length - m2.length,
    preco_m2_mediana: mediana !== null ? Math.round(mediana) : null,
    preco_m2_media: media !== null ? Math.round(media) : null,
    criterio:
      "Últimos 12 meses pela data da assinatura; só vendas assinadas. R$/m² = valor de venda ÷ área útil (Terreno: área do terreno). Vendas sem área aparecem sem R$/m² e ficam fora do cálculo.",
  };
}

export async function handleVendasReais(
  admin: AdminClient,
  token: string,
  body: Record<string, unknown> | null,
): Promise<CoreResult> {
  if (token.length < 32) return { status: 401, body: { error: "unauthorized" } };
  const keyHash = await sha256Hex(token);
  const { data, error } = await admin.rpc("estudo_vendas_reais", { _key_hash: keyHash });
  if (error) {
    // 28000 = chave desconhecida/revogada/imobiliária inativa (mesma resposta para não revelar qual)
    if (error.code === "28000") return { status: 401, body: { error: "unauthorized" } };
    console.error("estudo_vendas_reais_failed", error.code);
    return { status: 500, body: { error: "query_failed" } };
  }
  const todas = ((data ?? []) as Array<Record<string, unknown>>).map(sanitizar);
  const filtros = lerFiltros(body);
  const filtradas = aplicarFiltros(todas, filtros);
  return {
    status: 200,
    body: {
      vendas: filtradas.slice(0, MAX_RESULTADOS),
      resumo: resumo(filtradas),
      filtros,
      truncado: filtradas.length > MAX_RESULTADOS,
    },
  };
}
