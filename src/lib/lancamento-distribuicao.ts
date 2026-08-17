/**
 * Espelho em JS do branch "lancamento" de calcular_distribuicao_venda() (ver migration
 * 20260818000000_calcular_distribuicao_lancamento.sql) — usado SÓ pra preview instantâneo no
 * front-end (banner atualiza a cada tecla, sem esperar round-trip da RPC). Quem persiste e quem
 * bloqueia de verdade é sempre o banco (RPC salvar_divisao_comissao_lancamento + trigger
 * trg_validar_distribuicao_concluir_lancamento) — este módulo nunca decide se algo é salvo, só
 * antecipa a mesma conta pro usuário ver o erro sem esperar a rede.
 *
 * Qualquer mudança na fórmula do lado do banco precisa ser replicada aqui (e vice-versa) — os testes
 * deste arquivo (lancamento-distribuicao.test.ts) documentam os mesmos cenários usados pra validar
 * a migration.
 */

export type LancamentoLinhaComissao = {
  valor: number | string | null;
  semCadastroConfirmado?: boolean | null;
};

export type LancamentoDistribuicao = {
  comissao_bruta: number;
  total_pessoas: number;
  parceria_externa: number;
  saldo_imobiliaria: number;
  total_distribuido: number;
  diferenca_restante: number;
  calculo_valido: boolean;
  inconsistencias: string[];
};

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function calcularDistribuicaoLancamento(input: {
  valorNegociado: number | null;
  percentualComissao: number | null;
  valorTotalComissao: number | null;
  linhas: LancamentoLinhaComissao[];
}): LancamentoDistribuicao {
  const negociado = input.valorNegociado ?? null;
  const comissaoBruta = round2(
    input.percentualComissao != null && negociado != null && negociado > 0
      ? (input.percentualComissao / 100) * negociado
      : (input.valorTotalComissao ?? 0),
  );

  let totalPessoas = 0;
  let parceriaExterna = 0;
  for (const linha of input.linhas) {
    const valor = Number(linha.valor ?? 0);
    if (linha.semCadastroConfirmado) parceriaExterna += valor;
    else totalPessoas += valor;
  }
  totalPessoas = round2(totalPessoas);
  parceriaExterna = round2(parceriaExterna);

  const saldoImobiliaria = round2(comissaoBruta - totalPessoas - parceriaExterna);
  const totalDistribuido = round2(totalPessoas + parceriaExterna + saldoImobiliaria);

  const inconsistencias: string[] = [];
  if (comissaoBruta > 0 && saldoImobiliaria < -0.01) {
    inconsistencias.push(
      `A soma das comissões de pessoas e parceria externa (R$ ${(totalPessoas + parceriaExterna).toFixed(2)}) ultrapassa a comissão bruta (R$ ${comissaoBruta.toFixed(2)}) em R$ ${Math.abs(saldoImobiliaria).toFixed(2)}.`,
    );
  }

  return {
    comissao_bruta: comissaoBruta,
    total_pessoas: totalPessoas,
    parceria_externa: parceriaExterna,
    saldo_imobiliaria: saldoImobiliaria,
    total_distribuido: totalDistribuido,
    diferenca_restante: saldoImobiliaria,
    calculo_valido: inconsistencias.length === 0,
    inconsistencias,
  };
}
