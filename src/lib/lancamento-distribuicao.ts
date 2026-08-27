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
  percentual?: number | string | null;
  semCadastroConfirmado?: boolean | null;
};

export type LancamentoDistribuicao = {
  comissao_bruta: number;
  premio_valor: number;
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
  premioValor?: number | string | null;
  linhas: LancamentoLinhaComissao[];
}): LancamentoDistribuicao {
  const negociado = input.valorNegociado ?? null;
  const comissaoBruta = round2(
    input.valorTotalComissao != null
      ? input.valorTotalComissao
      : input.percentualComissao != null && negociado != null && negociado > 0
        ? (input.percentualComissao / 100) * negociado
        : 0,
  );
  const premioValor = round2(Number(input.premioValor ?? 0));

  let totalPessoas = 0;
  let parceriaExterna = 0;
  for (const linha of input.linhas) {
    const valor = Number(linha.valor ?? 0);
    if (linha.semCadastroConfirmado) parceriaExterna += valor;
    else totalPessoas += valor;
  }
  totalPessoas = round2(totalPessoas);
  parceriaExterna = round2(parceriaExterna);

  // O prêmio é dividido junto com a comissão pelos corretores (a % deles já incide sobre os dois
  // somados), então precisa entrar na base do saldo automático — senão a imobiliária aparenta reter
  // R$ premioValor a menos do que realmente fica com ela.
  const baseSaldo = round2(comissaoBruta + premioValor);
  const saldoImobiliaria = round2(baseSaldo - totalPessoas - parceriaExterna);
  const totalDistribuido = round2(totalPessoas + parceriaExterna + saldoImobiliaria);

  const inconsistencias: string[] = [];
  for (const linha of input.linhas) {
    const percentual = linha.percentual == null || linha.percentual === "" ? null : Number(linha.percentual);
    const valor = linha.valor == null || linha.valor === "" ? null : Number(linha.valor);
    if (percentual != null && valor != null && baseSaldo > 0) {
      const esperado = round2((percentual / 100) * baseSaldo);
      if (Math.abs(esperado - valor) > 0.01) {
        inconsistencias.push(
          `Percentual e valor divergentes: ${percentual}% corresponde a R$ ${esperado.toFixed(2)}, não a R$ ${valor.toFixed(2)}.`,
        );
      }
    }
  }
  if (baseSaldo > 0 && saldoImobiliaria < -0.01) {
    inconsistencias.push(
      `A soma das comissões de pessoas e parceria externa (R$ ${(totalPessoas + parceriaExterna).toFixed(2)}) ultrapassa a comissão bruta${premioValor > 0 ? " + prêmio" : ""} (R$ ${baseSaldo.toFixed(2)}) em R$ ${Math.abs(saldoImobiliaria).toFixed(2)}.`,
    );
  }

  return {
    comissao_bruta: comissaoBruta,
    premio_valor: premioValor,
    total_pessoas: totalPessoas,
    parceria_externa: parceriaExterna,
    saldo_imobiliaria: saldoImobiliaria,
    total_distribuido: totalDistribuido,
    diferenca_restante: saldoImobiliaria,
    calculo_valido: inconsistencias.length === 0,
    inconsistencias,
  };
}
