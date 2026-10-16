// Minha carreira, PR 4 (card t_5a47a73c): regras puras do bloco "Meu dinheiro".
// Os dados vêm da RPC minhas_comissoes (migração 20261016170000), que já devolve só a parte do
// corretor logado, parcela a parcela. Aqui só separamos "a receber" × "recebidas" e somamos.

export type MinhaParcela = {
  sale_id: string;
  occurrence_id: string;
  venda_em: string | null;
  imovel: string | null;
  papel: string | null;
  minha_comissao: number;
  parcela: number;
  parcelas: number;
  data_prevista: string | null;
  valor_previsto: number;
  recebido_em: string | null;
  valor_recebido: number | null;
};

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export function normalizarParcela(r: Record<string, unknown>): MinhaParcela {
  return {
    sale_id: String(r.sale_id),
    occurrence_id: String(r.occurrence_id),
    venda_em: (r.venda_em as string | null) ?? null,
    imovel: (r.imovel as string | null) ?? null,
    papel: (r.papel as string | null) ?? null,
    minha_comissao: num(r.minha_comissao) ?? 0,
    parcela: num(r.parcela) ?? 1,
    parcelas: num(r.parcelas) ?? 1,
    data_prevista: (r.data_prevista as string | null) ?? null,
    valor_previsto: num(r.valor_previsto) ?? 0,
    recebido_em: (r.recebido_em as string | null) ?? null,
    valor_recebido: num(r.valor_recebido),
  };
}

export const recebida = (p: MinhaParcela) => p.recebido_em != null;
/** Valor que conta como recebido: o baixado pelo financeiro ou, se faltar, o previsto. */
export const valorRecebido = (p: MinhaParcela) => p.valor_recebido ?? p.valor_previsto;

/** A receber: datas mais próximas primeiro, "sem data" no fim. */
export function aReceber(lista: MinhaParcela[]): MinhaParcela[] {
  return lista
    .filter((p) => !recebida(p))
    .sort((a, b) => {
      if (a.data_prevista === b.data_prevista) return a.parcela - b.parcela;
      if (a.data_prevista == null) return 1;
      if (b.data_prevista == null) return -1;
      return a.data_prevista.localeCompare(b.data_prevista);
    });
}

/** Recebidas: mais recentes primeiro. */
export function recebidas(lista: MinhaParcela[]): MinhaParcela[] {
  return lista
    .filter(recebida)
    .sort((a, b) => (b.recebido_em ?? "").localeCompare(a.recebido_em ?? ""));
}

export type ResumoDinheiro = {
  recebidoNoAno: number;
  aReceber: number;
  /** Data (AAAA-MM-DD) da próxima parcela a receber com data; null se não houver. */
  proximo: string | null;
  /** true se a próxima parcela já passou da data prevista e ainda não foi baixada. */
  proximoAtrasado: boolean;
  semData: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** `hoje` e `ano` no horário de São Paulo (AAAA-MM-DD e AAAA). */
export function resumoDinheiro(lista: MinhaParcela[], hoje: string): ResumoDinheiro {
  const ano = hoje.slice(0, 4);
  const pend = aReceber(lista);
  const comData = pend.filter((p) => p.data_prevista != null);
  const proximo = comData[0]?.data_prevista ?? null;
  return {
    recebidoNoAno: r2(
      lista
        .filter((p) => recebida(p) && (p.recebido_em ?? "").startsWith(ano))
        .reduce((s, p) => s + valorRecebido(p), 0),
    ),
    aReceber: r2(pend.reduce((s, p) => s + p.valor_previsto, 0)),
    proximo,
    proximoAtrasado: proximo != null && proximo < hoje,
    semData: pend.length - comData.length,
  };
}

/** "28/10/2026" a partir de "2026-10-28"; "sem data" se vazio. */
export function dataBR(d: string | null): string {
  if (!d) return "sem data";
  const [y, m, dd] = d.slice(0, 10).split("-");
  return `${dd}/${m}/${y}`;
}
