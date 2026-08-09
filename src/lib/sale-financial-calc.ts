/**
 * Recálculos puros disparados quando o usuário edita "Valor negociado" (Resumo e Ocorrência).
 * Extraído de vendas.$id.tsx pra ser testável sem montar o componente inteiro — mesma lógica,
 * mesmo comportamento, só movida pra fora do closure do componente.
 */

const COMISSAO_ROLES = ["captador", "vendedor"] as const;

// Mesmo "patch: any" já usado em todo vendas.$id.tsx pra bag de formulário — tipar aqui sem tipar lá
// só criaria fricção sem segurança real.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FieldBag = Record<string, any>;

const fromPatchOrSale = (patch: FieldBag, formSale: FieldBag, key: string) => (key in patch ? patch[key] : formSale[key]);

/**
 * Imobiliária = total menos captador, vendedor e a parceria externa (quando houver — o valor dela
 * sai da fatia da imobiliária, já que é quem paga o parceiro externo). Indicador/líder do
 * captador/vendedor NÃO descontam daqui — a comissão de cada um sai de dentro da fatia do próprio
 * lado (captador ou vendedor), não são uma 3ª fatia do total.
 */
export function recalcImobiliaria(patch: FieldBag, formSale: FieldBag): number {
  const total = Number(fromPatchOrSale(patch, formSale, "valor_total_comissao") ?? 0);
  const soma = COMISSAO_ROLES.reduce((s, r) => s + Number(fromPatchOrSale(patch, formSale, `valor_comissao_${r}`) ?? 0), 0);
  const parceria = Number(fromPatchOrSale(patch, formSale, "parceria_valor") ?? 0);
  return Number((total - soma - parceria).toFixed(2));
}

/**
 * Único ponto que muda "Valor negociado" no Resumo. O percentual que o usuário digitou continua o
 * mesmo, só o valor em reais é recalculado em cima do novo negociado — igual à convenção já usada nos
 * campos de REMAX e parceria (percentual sobre o negociado, não sobre o total da comissão). Captador,
 * vendedor, indicador e líder nunca são tocados aqui: são valores em reais digitados direto, sem
 * percentual vinculado ao negociado.
 */
export function calcularPatchValorNegociado(formSale: FieldBag, v: number | null): FieldBag {
  const negociado = v != null ? Number(v) : null;
  const patch: FieldBag = { valor_negociado: negociado };
  const pctSobreNegociado = (percentual: number | null | undefined) =>
    percentual != null && negociado != null && negociado > 0 ? Number(((percentual / 100) * negociado).toFixed(2)) : null;
  if (formSale.percentual_comissao != null) patch.valor_total_comissao = pctSobreNegociado(formSale.percentual_comissao);
  if (formSale.parceria_percentual != null) patch.parceria_valor = pctSobreNegociado(formSale.parceria_percentual);
  if (formSale.percentual_remax != null) patch.valor_remax = pctSobreNegociado(formSale.percentual_remax);
  // Campo legado (sem % da REMAX preenchido) — recalcula com o novo total/parceria pra não ficar
  // com "Valor para a imobiliária" desatualizado nas vendas antigas que ainda dependem dele.
  patch.valor_comissao_imobiliaria = recalcImobiliaria(patch, formSale);
  return patch;
}

/** Mesma regra do lado da Ocorrência: só valor_comissao recalcula sobre o novo negociado. */
export function calcularPatchOccValorNegociado(formOcc: FieldBag, v: number | null): FieldBag {
  const negociado = v != null ? Number(v) : null;
  const patch: FieldBag = { valor_negociado: negociado };
  if (formOcc.percentual_comissao != null) {
    patch.valor_comissao = negociado != null && negociado > 0 ? Number(((formOcc.percentual_comissao / 100) * negociado).toFixed(2)) : null;
  }
  return patch;
}
