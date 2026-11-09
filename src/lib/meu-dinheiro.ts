// Minha carreira, PR 4 (cards t_5a47a73c e t_3f1d4f0f): regras puras do bloco "Meu dinheiro".
// Os dados vêm da RPC minhas_comissoes (migração 20261016170000), que já devolve só a comissão do
// corretor logado, uma linha por venda. Decisão de Denis (16/10): mostrar só o total de comissão a que
// ele tem direito — sem "recebido"/"a receber", porque o sistema não registra o repasse ao corretor.

export type MinhaComissao = {
  sale_id: string;
  venda_em: string | null;
  imovel: string | null;
  papel: string | null;
  minha_comissao: number;
};

export type PeriodoDinheiro = "mes" | "ano" | "todas";

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export function normalizarComissao(r: Record<string, unknown>): MinhaComissao {
  return {
    sale_id: String(r.sale_id),
    venda_em: (r.venda_em as string | null) ?? null,
    imovel: (r.imovel as string | null) ?? null,
    papel: (r.papel as string | null) ?? null,
    minha_comissao: num(r.minha_comissao) ?? 0,
  };
}

/** Vendas do período pela data da venda; `hoje` no horário de São Paulo (AAAA-MM-DD). */
export function filtrarPeriodo(
  lista: MinhaComissao[],
  periodo: PeriodoDinheiro,
  hoje: string,
): MinhaComissao[] {
  if (periodo === "todas") return lista;
  const prefixo = periodo === "mes" ? hoje.slice(0, 7) : hoje.slice(0, 4);
  return lista.filter((c) => (c.venda_em ?? "").startsWith(prefixo));
}

/** Mais recentes primeiro; vendas sem data no fim. */
export function ordenarPorData(lista: MinhaComissao[]): MinhaComissao[] {
  return [...lista].sort((a, b) => (b.venda_em ?? "").localeCompare(a.venda_em ?? ""));
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export const totalComissao = (lista: MinhaComissao[]) =>
  r2(lista.reduce((s, c) => s + c.minha_comissao, 0));

// --- Filtro "Minhas vendas / Do time" (t_31729652) -------------------------------------------------
// Só EXIBIÇÃO: a lista e o total de "Todas" continuam vindo da RPC, sem mudança. A divisão usa o papel
// de cada linha de occurrence_commissions do próprio usuário (lista fechada por CHECK no banco).
// Pessoal = corretor/indicador captador ou vendedor; time = líder (TL/gestor) do lado ou extra de
// gestor/TL; outras = coordenador de lançamento e "outro". Uma venda pode ter partes nas duas visões.

export type OrigemDinheiro = "todas" | "minhas" | "time" | "outras";
type Parte = Exclude<OrigemDinheiro, "todas">;

const PAPEL_ORIGEM: Record<string, Parte> = {
  corretor_captador: "minhas",
  corretor_vendedor: "minhas",
  indicador_captador: "minhas",
  indicador_vendedor: "minhas",
  lider_captador: "time",
  lider_vendedor: "time",
  gestor: "time",
  team_leader: "time",
  coordenador_lancamento: "outras",
  outro: "outras",
};

/** Papel desconhecido (não previsto no CHECK) cai em "outras", nunca some. */
export const origemDoPapel = (papel: string | null): Parte =>
  (papel && PAPEL_ORIGEM[papel]) || "outras";

/** Mesmo rótulo curto da RPC minhas_comissoes. */
export const rotuloPapel = (papel: string): string =>
  papel === "corretor_captador"
    ? "captador"
    : papel === "corretor_vendedor"
      ? "vendedor"
      : papel.replace(/_/g, " ");

export type ParteVenda = { valor: number; papeis: string[] };
export type PartesPorVenda = Map<string, Partial<Record<Parte, ParteVenda>>>;

export type LinhaParte = {
  sale_id: string;
  papel: string | null;
  valor: unknown;
  sem_cadastro_confirmado?: boolean | null;
};

/** Agrupa as linhas de comissão do usuário por venda e por origem (mesmo filtro da RPC). */
export function agruparPartes(linhas: LinhaParte[]): PartesPorVenda {
  const m: PartesPorVenda = new Map();
  for (const l of linhas) {
    if (l.sem_cadastro_confirmado) continue;
    const o = origemDoPapel(l.papel);
    const venda = m.get(l.sale_id) ?? {};
    const p = venda[o] ?? { valor: 0, papeis: [] };
    p.valor += num(l.valor) ?? 0;
    if (l.papel && !p.papeis.includes(l.papel)) p.papeis.push(l.papel);
    venda[o] = p;
    m.set(l.sale_id, venda);
  }
  return m;
}

/** Inverso do rótulo da RPC ("captador" → corretor_captador, "lider captador" → lider_captador). */
const codigoDoRotulo = (r: string): string =>
  r === "captador"
    ? "corretor_captador"
    : r === "vendedor"
      ? "corretor_vendedor"
      : r.replace(/ /g, "_");

/**
 * Venda cuja linha de comissão a RLS não deixa ler (ex.: indicador sem acesso à ocorrência), mas com
 * UM único papel no texto da RPC: o valor inteiro é desse papel, então a parte sai da própria RPC.
 * Venda com mais de um papel e sem leitura fica como está (partesConferem desliga o filtro).
 */
export function completarPartesPelaRpc(
  lista: MinhaComissao[],
  partes: PartesPorVenda,
): PartesPorVenda {
  const out: PartesPorVenda = new Map(partes);
  for (const c of lista) {
    if (out.has(c.sale_id) || !c.papel || c.papel.includes(" e ")) continue;
    const papel = codigoDoRotulo(c.papel);
    out.set(c.sale_id, { [origemDoPapel(papel)]: { valor: c.minha_comissao, papeis: [papel] } });
  }
  return out;
}

/**
 * As partes só valem se baterem, venda a venda, com o valor da RPC (diferença até 1 centavo de
 * arredondamento). Qualquer divergência (ex.: linha que a RLS não deixou ler) → filtro desligado.
 */
export function partesConferem(lista: MinhaComissao[], partes: PartesPorVenda): boolean {
  return lista.every((c) => {
    const v = partes.get(c.sale_id);
    if (!v) return false;
    const soma = Object.values(v).reduce((s, p) => s + (p?.valor ?? 0), 0);
    return Math.abs(r2(soma) - c.minha_comissao) <= 0.011;
  });
}

/** Quais origens o usuário tem (com valor diferente de zero) nas vendas da lista. */
export function origensDisponiveis(lista: MinhaComissao[], partes: PartesPorVenda): Parte[] {
  const tem = new Set<Parte>();
  for (const c of lista) {
    const v = partes.get(c.sale_id);
    for (const o of ["minhas", "time", "outras"] as Parte[]) if (v?.[o]?.valor) tem.add(o);
  }
  return (["minhas", "time", "outras"] as Parte[]).filter((o) => tem.has(o));
}

/** Filtro só aparece para quem tem comissão de time; corretor sem time não vê o filtro. */
export const mostrarFiltroOrigem = (origens: Parte[]) => origens.includes("time");

/**
 * "todas" devolve a lista da RPC sem tocar em nada. As outras visões mantêm só as vendas com parte
 * naquela origem e trocam o valor/papel da linha pela parte correspondente.
 */
export function filtrarOrigem(
  lista: MinhaComissao[],
  partes: PartesPorVenda,
  origem: OrigemDinheiro,
): MinhaComissao[] {
  if (origem === "todas") return lista;
  const out: MinhaComissao[] = [];
  for (const c of lista) {
    const p = partes.get(c.sale_id)?.[origem];
    if (!p || !p.valor) continue;
    out.push({ ...c, minha_comissao: r2(p.valor), papel: p.papeis.map(rotuloPapel).join(" e ") });
  }
  return out;
}

/** "28/10/2026" a partir de "2026-10-28"; "—" se vazio. */
export function dataBR(d: string | null): string {
  if (!d) return "—";
  const [y, m, dd] = d.slice(0, 10).split("-");
  return `${dd}/${m}/${y}`;
}
