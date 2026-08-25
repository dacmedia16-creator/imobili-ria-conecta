/**
 * Sanitização pura do payload de "Resumo da transação" do Lançamento (LancamentoDetail.tsx) antes
 * de mandar pro banco — extraída pra ser testável sem montar o componente (mesmo motivo do
 * lancamento-pessoas.ts: vitest.config.ts roda em `environment: "node"`, sem jsdom).
 *
 * BUG #1 (pré-existente, achado na validação mobile da Etapa 3): data_assinatura e
 * previsao_recebimento_data são colunas `date` no Postgres — nunca aceitam string vazia, só null ou
 * uma data válida ("invalid input syntax for type date: \"\""). midia tem CHECK constraint com
 * lista fixa de valores — também nunca aceita "" (sales_midia_check). Como o autosave do Resumo
 * manda o form INTEIRO a cada edição (não só o campo alterado), bastava editar QUALQUER outro campo
 * num Lançamento novo (sem essas datas/mídia preenchidas ainda) pra falhar. Esta função é a fonte
 * única de "o que vira null antes de salvar" — usada tanto no estado inicial do formulário quanto,
 * de novo, logo antes do `.update()` (defesa em profundidade).
 */

const CAMPOS_STRING_VAZIA_VIRA_NULL = [
  "data_assinatura",
  "midia",
  "previsao_recebimento_data",
  "previsao_recebimento2_data",
  "previsao_recebimento3_data",
] as const;

export function sanitizeLancamentoResumoPayload<T extends Record<string, unknown>>(form: T): T {
  const payload = { ...form };
  for (const campo of CAMPOS_STRING_VAZIA_VIRA_NULL) {
    if ((payload as Record<string, unknown>)[campo] === "") {
      (payload as Record<string, unknown>)[campo] = null;
    }
  }
  return payload;
}
