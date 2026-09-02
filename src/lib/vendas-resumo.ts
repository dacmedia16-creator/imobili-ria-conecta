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
