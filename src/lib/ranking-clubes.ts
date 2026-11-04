// Ranking e Clubes REMAX (card t_481a3f26). Funções puras; os dados vêm da RPC carreira_ranking_clubes
// (migração 20261104120000), que já filtra pela imobiliária ativa e omite a comissão de colegas quando a
// pessoa não pode vê-la. Regras: ranking.minharemax.com/conceitos (Comitê de Dados REMAX Brasil).

export type FaixaClube = { nome: string; minimo: number };

export type CorretorRanking = {
  user_id: string;
  nome: string;
  avatar_url: string | null;
  eu: boolean;
  /** null = comissão de colega oculta para quem consulta. */
  comissao: number | null;
  comissao_ano: number | null;
  capt: number;
  venda: number;
  team_id: string | null;
  team_nome: string | null;
  tamanho_time: number | null;
};

export type TimeRanking = {
  team_id: string;
  nome: string;
  tamanho_time: number;
  comissao: number | null;
  comissao_ano: number | null;
  capt: number;
  venda: number;
};

export type RankingClubes = {
  inicio: string;
  fim: string;
  ano: number;
  valores_visiveis: boolean;
  staff: boolean;
  faixas: FaixaClube[];
  faixas_ano: number | null;
  primeira_venda: string | null;
  corretores: CorretorRanking[];
  times: TimeRanking[];
};

export type PeriodoRanking = "mes" | "tri" | "ytd" | "ano_anterior";
export type Porte = "sem_time" | "micro" | "pequeno" | "medio" | "grande";

export const PERIODOS: { valor: PeriodoRanking; rotulo: string }[] = [
  { valor: "mes", rotulo: "Mês" },
  { valor: "tri", rotulo: "Trimestre" },
  { valor: "ytd", rotulo: "Ano até o mês" },
  { valor: "ano_anterior", rotulo: "Ano anterior" },
];

export const PORTES: { valor: Porte; rotulo: string }[] = [
  { valor: "sem_time", rotulo: "Sem time" },
  { valor: "micro", rotulo: "Micro" },
  { valor: "pequeno", rotulo: "Pequeno" },
  { valor: "medio", rotulo: "Médio" },
  { valor: "grande", rotulo: "Grande" },
];

/** Perto de subir de clube: falta menos de 12% do valor do próximo clube. */
export const PERTO_DE_SUBIR = 0.12;

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const z = (v: unknown) => num(v) ?? 0;
const txt = (v: unknown) => (v == null ? null : String(v));

export function normalizarRankingClubes(raw: unknown): RankingClubes {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    inicio: String(r.inicio ?? ""),
    fim: String(r.fim ?? ""),
    ano: z(r.ano),
    valores_visiveis: r.valores_visiveis === true,
    staff: r.staff === true,
    faixas: lista(r.faixas)
      .map((f) => ({ nome: String(f.nome ?? ""), minimo: z(f.minimo) }))
      .sort((a, b) => a.minimo - b.minimo),
    faixas_ano: num(r.faixas_ano),
    primeira_venda: txt(r.primeira_venda),
    corretores: lista(r.corretores).map((c) => ({
      user_id: String(c.user_id),
      nome: (c.nome as string | null) ?? "Corretor",
      avatar_url: txt(c.avatar_url),
      eu: c.eu === true,
      comissao: num(c.comissao),
      comissao_ano: num(c.comissao_ano),
      capt: z(c.capt),
      venda: z(c.venda),
      team_id: txt(c.team_id),
      team_nome: txt(c.team_nome),
      tamanho_time: num(c.tamanho_time),
    })),
    times: lista(r.times).map((t) => ({
      team_id: String(t.team_id),
      nome: (t.nome as string | null) ?? "Time",
      tamanho_time: z(t.tamanho_time),
      comissao: num(t.comissao),
      comissao_ano: num(t.comissao_ano),
      capt: z(t.capt),
      venda: z(t.venda),
    })),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Datas ISO (SP) de cada período, a partir de hoje (AAAA-MM-DD). */
export function intervaloPeriodo(p: PeriodoRanking, hoje: string): { inicio: string; fim: string } {
  const [y, m] = hoje.split("-").map(Number);
  const fimMes = `${y}-${pad(m)}-${pad(ultimoDia(y, m))}`;
  if (p === "mes") return { inicio: `${y}-${pad(m)}-01`, fim: fimMes };
  if (p === "ytd") return { inicio: `${y}-01-01`, fim: fimMes };
  if (p === "ano_anterior") return { inicio: `${y - 1}-01-01`, fim: `${y - 1}-12-31` };
  const ini = new Date(Date.UTC(y, m - 3, 1));
  return { inicio: `${ini.getUTCFullYear()}-${pad(ini.getUTCMonth() + 1)}-01`, fim: fimMes };
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function rotuloIntervalo(inicio: string, fim: string): string {
  const [yi, mi] = inicio.split("-").map(Number);
  const [yf, mf] = fim.split("-").map(Number);
  const a = `${MESES[mi - 1]}/${yi}`;
  const b = `${MESES[mf - 1]}/${yf}`;
  return a === b ? a : `${a} a ${b}`;
}

/** Porte do time pelo tamanho no fim do período, líder incluído (Micro < 3; Pequeno 3–5; Médio 6–10; Grande 11+). */
export function porteDoTime(tamanho: number | null | undefined): Porte {
  if (tamanho == null || tamanho <= 0) return "sem_time";
  if (tamanho < 3) return "micro";
  if (tamanho <= 5) return "pequeno";
  if (tamanho <= 10) return "medio";
  return "grande";
}

export const rotuloPorte = (p: Porte) => PORTES.find((x) => x.valor === p)?.rotulo ?? p;

/** Clube alcançado com a comissão do ano (null = ainda sem clube). */
export function clubeDe(valor: number | null, faixas: FaixaClube[]): FaixaClube | null {
  if (valor == null) return null;
  let c: FaixaClube | null = null;
  for (const f of faixas) if (valor >= f.minimo) c = f;
  return c;
}

export function proximoClube(valor: number | null, faixas: FaixaClube[]): FaixaClube | null {
  if (valor == null) return null;
  return faixas.find((f) => valor < f.minimo) ?? null;
}

/** Progresso (0–100) do clube atual até o próximo; 100 = clube mais alto. */
export function progressoAteProximo(valor: number | null, faixas: FaixaClube[]): number {
  if (valor == null) return 0;
  const prox = proximoClube(valor, faixas);
  if (!prox) return faixas.length ? 100 : 0;
  const base = clubeDe(valor, faixas)?.minimo ?? 0;
  const span = prox.minimo - base;
  return span > 0 ? Math.min(100, Math.max(0, ((valor - base) / span) * 100)) : 0;
}

export function faltaParaProximo(valor: number | null, faixas: FaixaClube[]): number | null {
  const prox = proximoClube(valor, faixas);
  return prox && valor != null ? Math.max(0, prox.minimo - valor) : null;
}

export function pertoDeSubir(valor: number | null, faixas: FaixaClube[]): boolean {
  const prox = proximoClube(valor, faixas);
  if (!prox || valor == null || valor <= 0) return false;
  return (prox.minimo - valor) / prox.minimo < PERTO_DE_SUBIR;
}

const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Previsão de fechamento do ano no ritmo atual: comissão do ano / dias corridos × dias do ano.
 * O ritmo conta desde 1º de janeiro ou desde a 1ª venda da imobiliária no sistema (o que vier depois),
 * para não diluir o ritmo nos meses em que o sistema ainda não tinha dados.
 */
export function previsaoAno(
  comissaoAno: number | null,
  hoje: string,
  primeiraVenda: string | null,
): { valor: number; desde: string } | null {
  if (comissaoAno == null || comissaoAno <= 0) return null;
  const ano = hoje.slice(0, 4);
  const jan = `${ano}-01-01`;
  const desde = primeiraVenda && primeiraVenda > jan && primeiraVenda <= hoje ? primeiraVenda : jan;
  const corridos = diasEntre(desde, hoje) + 1;
  const total = diasEntre(desde, `${ano}-12-31`) + 1;
  if (corridos <= 0 || total <= 0) return null;
  return { valor: (comissaoAno / corridos) * total, desde };
}

export type ComPosicao<T> = T & { posicao: number; posicaoFiltro: number | null };

/** Posição geral = ordem do banco; posição no filtro só quando há filtro. */
export function aplicarFiltro<T>(
  lista: T[],
  passa: ((x: T) => boolean) | null,
): { linhas: ComPosicao<T>[]; total: number } {
  const geral = lista.map((x, i) => ({
    ...x,
    posicao: i + 1,
    posicaoFiltro: null as number | null,
  }));
  if (!passa) return { linhas: geral, total: lista.length };
  const f = geral.filter((x) => passa(x));
  return { linhas: f.map((x, i) => ({ ...x, posicaoFiltro: i + 1 })), total: lista.length };
}

export function resumoEmpresa(corretores: CorretorRanking[], faixas: FaixaClube[]) {
  const total = corretores.reduce((s, c) => s + (c.comissao_ano ?? 0), 0);
  const comClube = corretores.filter((c) => clubeDe(c.comissao_ano, faixas)).length;
  const perto = corretores.filter((c) => pertoDeSubir(c.comissao_ano, faixas));
  const porClube = faixas
    .map((f) => ({
      clube: f,
      n: corretores.filter((c) => clubeDe(c.comissao_ano, faixas)?.nome === f.nome).length,
    }))
    .filter((x) => x.n > 0);
  return { total, comClube, corretores: corretores.length, perto, porClube };
}

export const fmtTransacoes = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
