const round2 = (valor: number) => Math.round(valor * 100) / 100;

/**
 * Métricas atribuíveis à unidade. A parceria externa nunca é receita nem produção da REMAX.
 * O VGV é rateado na mesma proporção da comissão que ficou com a unidade.
 */
export function metricasSemParceria(args: {
  vgv: number | null | undefined;
  comissaoBruta: number | null | undefined;
  parceriaExterna: number | null | undefined;
}) {
  const vgvTotal = Math.max(Number(args.vgv ?? 0), 0);
  const comissaoBruta = Math.max(Number(args.comissaoBruta ?? 0), 0);
  const parceriaExterna = Math.max(Number(args.parceriaExterna ?? 0), 0);
  const comissaoPropria = round2(Math.max(comissaoBruta - parceriaExterna, 0));
  const fracaoPropria = comissaoBruta > 0 ? Math.min(comissaoPropria / comissaoBruta, 1) : 0;

  return {
    vgvProprio: round2(vgvTotal * fracaoPropria),
    comissaoPropria,
    parceriaExterna: round2(Math.min(parceriaExterna, comissaoBruta)),
    fracaoPropria,
  };
}
