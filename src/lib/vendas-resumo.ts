const STATUS_COM_CONTRATO_ASSINADO = new Set([
  "contrato_assinado",
  "ocorrencia_pendente",
  "ocorrencia_analise_financeiro",
  "ocorrencia_devolvida_gestor",
  "ocorrencia_concluida",
]);

export type VendaParaResumo = {
  status: string;
  modalidade?: string | null;
  valor_negociado?: number | string | null;
};

export async function resolverResumoOpcional<T>(consulta: Promise<T>): Promise<T | null> {
  try {
    return await consulta;
  } catch {
    return null;
  }
}

type PeriodoResumoContratos = {
  desde?: string;
  ate?: string;
};

export function idsDeContratosAssinadosNoPeriodo(
  vendas: Array<{ sale_id: string; venda_em: string }>,
  periodo: PeriodoResumoContratos,
) {
  const desde = periodo.desde ? new Date(periodo.desde).getTime() : null;
  const ate = periodo.ate ? new Date(periodo.ate).getTime() : null;

  return vendas
    .filter((venda) => {
      const assinatura = new Date(venda.venda_em).getTime();
      return (desde === null || assinatura >= desde) && (ate === null || assinatura <= ate);
    })
    .map((venda) => venda.sale_id);
}

export function resumirVendas(vendas: VendaParaResumo[]) {
  return vendas.reduce(
    (resumo, venda) => {
      const valorConvertido = Number(venda.valor_negociado);
      const valor = Number.isFinite(valorConvertido) ? valorConvertido : 0;
      const temContratoAssinado =
        venda.modalidade !== "lancamento" && STATUS_COM_CONTRATO_ASSINADO.has(venda.status);

      resumo.quantidadeTotal += 1;
      resumo.valorTotal += valor;
      if (temContratoAssinado) {
        resumo.quantidadeComContratoAssinado += 1;
        resumo.valorComContratoAssinado += valor;
      }
      return resumo;
    },
    {
      quantidadeTotal: 0,
      valorTotal: 0,
      quantidadeComContratoAssinado: 0,
      valorComContratoAssinado: 0,
    },
  );
}
