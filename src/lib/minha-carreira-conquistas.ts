// Minha carreira, PR 3 (card t_b848f957): bloco "Conquistas" — ranking, destaques do Mural e
// Clube RE/MAX. Funções puras; os dados vêm das RPCs carreira_ranking, carreira_meus_destaques e
// carreira_clube e da tabela clube_remax_faixas (migração 20261016140000). O banco já filtra por
// auth.uid() + current_org_id() e omite VGV/comissão de colegas quando a chave está desligada.

export type LinhaRanking = {
  posicao: number;
  user_id: string;
  nome: string;
  avatar_url: string | null;
  captacoes: number;
  vendas: number;
  pontos: number;
  /** null = valor de colega oculto (chave "ranking_valores" desligada). */
  vgv: number | null;
  comissao: number | null;
  eu: boolean;
  valores_visiveis: boolean;
};

export type Destaque = {
  id: string;
  venda_em: string;
  papel: string;
  captador_nome: string | null;
  vendedor_nome: string | null;
  tipo_imovel: string | null;
  bairro: string | null;
  cidade: string | null;
  cheers: number;
};

export type Clube = {
  ano: number;
  vgc_ano_anterior: number;
  clube_atual: string | null;
  tabela_atual: number | null;
  vgc_ano_corrente: number;
  clube_buscando: string | null;
  proximo_clube: string | null;
  falta_proximo: number | null;
  tabela_buscando: number | null;
  origem: string | null;
};

export type Faixa = {
  id?: string;
  ano: number;
  ordem: number;
  nome: string;
  vgc_minimo: number;
  origem: string | null;
};

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const z = (v: unknown) => num(v) ?? 0;

export function normalizarRanking(
  rows: Record<string, unknown>[] | null | undefined,
): LinhaRanking[] {
  return (rows ?? []).map((r) => ({
    posicao: z(r.posicao),
    user_id: String(r.user_id),
    nome: (r.nome as string | null) ?? "Corretor",
    avatar_url: (r.avatar_url as string | null) ?? null,
    captacoes: z(r.captacoes),
    vendas: z(r.vendas),
    pontos: z(r.pontos),
    vgv: num(r.vgv),
    comissao: num(r.comissao),
    eu: r.eu === true,
    valores_visiveis: r.valores_visiveis === true,
  }));
}

export function normalizarClube(r: Record<string, unknown> | null | undefined): Clube | null {
  if (!r) return null;
  return {
    ano: z(r.ano),
    vgc_ano_anterior: z(r.vgc_ano_anterior),
    clube_atual: (r.clube_atual as string | null) ?? null,
    tabela_atual: num(r.tabela_atual),
    vgc_ano_corrente: z(r.vgc_ano_corrente),
    clube_buscando: (r.clube_buscando as string | null) ?? null,
    proximo_clube: (r.proximo_clube as string | null) ?? null,
    falta_proximo: num(r.falta_proximo),
    tabela_buscando: num(r.tabela_buscando),
    origem: (r.origem as string | null) ?? null,
  };
}

/** Período do ranking: mês corrente ou ano corrente (até hoje), em datas ISO de SP. */
export function periodoRanking(aba: "mes" | "ano", hoje: string): { inicio: string; fim: string } {
  const [y, m] = hoje.split("-");
  if (aba === "ano") return { inicio: `${y}-01-01`, fim: `${y}-12-31` };
  const ultimo = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return { inicio: `${y}-${m}-01`, fim: `${y}-${m}-${String(ultimo).padStart(2, "0")}` };
}

/** Percentual do VGC do ano corrente até o próximo clube (0–100). */
export function progressoClube(c: Clube): number {
  if (c.falta_proximo == null) return 100;
  const alvo = c.vgc_ano_corrente + c.falta_proximo;
  return alvo > 0 ? Math.min(100, Math.max(0, (c.vgc_ano_corrente / alvo) * 100)) : 0;
}

/** Valida as faixas de um ano antes de salvar. Devolve a mensagem de erro ou null. */
export function validarFaixas(faixas: Pick<Faixa, "nome" | "vgc_minimo">[]): string | null {
  if (faixas.length === 0) return "Cadastre pelo menos uma faixa.";
  const nomes = new Set<string>();
  for (const f of faixas) {
    const nome = f.nome.trim();
    if (!nome) return "Toda faixa precisa de nome.";
    if (nome.length > 60) return "Nome da faixa com no máximo 60 caracteres.";
    if (nomes.has(nome.toLowerCase())) return `Faixa repetida: ${nome}.`;
    nomes.add(nome.toLowerCase());
    if (!Number.isFinite(f.vgc_minimo) || f.vgc_minimo < 0) return "VGC mínimo inválido.";
  }
  for (let i = 1; i < faixas.length; i++) {
    if (faixas[i].vgc_minimo <= faixas[i - 1].vgc_minimo)
      return "Os valores mínimos precisam subir de uma faixa para a próxima.";
  }
  return null;
}

/** Fim de cada faixa = início da próxima − 0,01; a última é "acima de". */
export function textoFaixa(
  faixas: Pick<Faixa, "vgc_minimo">[],
  i: number,
  fmt: (n: number) => string,
) {
  const prox = faixas[i + 1];
  return prox
    ? `${fmt(faixas[i].vgc_minimo)} a ${fmt(prox.vgc_minimo - 0.01)}`
    : `acima de ${fmt(faixas[i].vgc_minimo)}`;
}
