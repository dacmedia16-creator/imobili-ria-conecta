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
 * Único ponto que muda "Valor negociado" no Resumo. A comissão em reais é a fonte oficial e nunca
 * é recalculada pelo percentual; o percentual é apenas uma referência derivada do valor oficial.
 * Parceria e REMAX continuam com suas regras próprias, percentuais sobre o valor negociado.
 */
export function calcularPatchValorNegociado(formSale: FieldBag, v: number | null): FieldBag {
  const negociado = v != null ? Number(v) : null;
  const patch: FieldBag = { valor_negociado: negociado };
  const pctSobreNegociado = (percentual: number | null | undefined) =>
    percentual != null && negociado != null && negociado > 0 ? Number(((percentual / 100) * negociado).toFixed(2)) : null;
  if (formSale.valor_total_comissao != null && negociado != null && negociado > 0) {
    patch.percentual_comissao = Number(((Number(formSale.valor_total_comissao) / negociado) * 100).toFixed(6));
  } else if (negociado == null || negociado <= 0) {
    patch.percentual_comissao = null;
  }
  if (formSale.parceria_percentual != null) patch.parceria_valor = pctSobreNegociado(formSale.parceria_percentual);
  if (formSale.percentual_remax != null) patch.valor_remax = pctSobreNegociado(formSale.percentual_remax);
  // Campo legado (sem % da REMAX preenchido) — recalcula com o novo total/parceria pra não ficar
  // com "Valor para a imobiliária" desatualizado nas vendas antigas que ainda dependem dele.
  patch.valor_comissao_imobiliaria = recalcImobiliaria(patch, formSale);
  return patch;
}

/** Mesma regra do lado da Ocorrência: valor em reais prevalece e o percentual é derivado. */
export function calcularPatchOccValorNegociado(formOcc: FieldBag, v: number | null): FieldBag {
  const negociado = v != null ? Number(v) : null;
  const patch: FieldBag = { valor_negociado: negociado };
  if (formOcc.valor_comissao != null && negociado != null && negociado > 0) {
    patch.percentual_comissao = Number(((Number(formOcc.valor_comissao) / negociado) * 100).toFixed(6));
  } else if (negociado == null || negociado <= 0) {
    patch.percentual_comissao = null;
  }
  return patch;
}

// Papéis com link de verdade pra conta de usuário: captador/vendedor via
// sales.corretor_captador_id/vendedor_id, gestor/team_leader via coordenador_id/team_leader_id,
// lider_captador/vendedor via sales.lider_captador_id/vendedor_id (Equipe). Indicador/outro
// continuam só por nome — geralmente é gente de fora do sistema.
export function userIdParaPapel(papel: string, sale: FieldBag): string | null {
  if (papel === "corretor_captador") return sale.corretor_captador_id ?? null;
  if (papel === "corretor_vendedor") return sale.corretor_vendedor_id ?? null;
  if (papel === "gestor") return sale.coordenador_id ?? null;
  if (papel === "team_leader") return sale.team_leader_id ?? null;
  if (papel === "lider_captador") return sale.lider_captador_id ?? null;
  if (papel === "lider_vendedor") return sale.lider_vendedor_id ?? null;
  return null;
}

// Partes extras da divisão (Resumo) viram comissões na ocorrência usando o "papel" que a pessoa
// recebeu lá (Gestor/Team Leader/Outro/mais um captador ou vendedor) — sem papel definido, cai em "outro".
const EXTRA_ORIGEM_PAPEIS = new Set(["gestor", "team_leader", "outro", "corretor_captador", "corretor_vendedor"]);
export function papelDaExtra(papel: string | null): string {
  return papel && EXTRA_ORIGEM_PAPEIS.has(papel) ? papel : "outro";
}

// Só pra partes EXTRAS (sale_commission_extras / papelDaExtra) — nunca usar userIdParaPapel pra
// "corretor_captador"/"corretor_vendedor" aqui, porque um "Outro captador/vendedor" extra é uma
// PESSOA DIFERENTE do captador/vendedor principal da venda. Usar userIdParaPapel nesse caso
// grudaria o id do captador/vendedor principal na comissão de outra pessoa. `extra.user_id` (quando
// o "Outro captador/vendedor" foi selecionado da lista, não digitado) tem prioridade sobre tudo.
export function userIdParaExtra(papel: string, sale: FieldBag, extra?: { user_id?: string | null }): string | null {
  if (extra?.user_id) return extra.user_id;
  if (papel === "gestor") return sale.coordenador_id ?? null;
  if (papel === "team_leader") return sale.team_leader_id ?? null;
  return null;
}

export type OcorrenciaComissaoRow = {
  papel: string;
  nome: string | null;
  valor: number | null;
  user_id: string | null;
  sale_commission_extra_id: string | null;
  managed_by_sale: boolean;
};
export type SaleExtraRow = { id: string; papel: string | null; nome: string | null; valor: number | null; user_id: string | null };

const PAPEIS_FIXOS = ["corretor_captador", "corretor_vendedor", "indicador_captador", "indicador_vendedor", "lider_captador", "lider_vendedor"] as const;

/**
 * Uma comissão fixa só existe quando há uma pessoa identificada ou valor efetivamente positivo.
 * Campos monetários vazios chegam como 0 em algumas vendas com parceria externa; tratá-los como
 * comissão criaria uma linha sem vínculo e faria a constraint do banco bloquear a ocorrência.
 */
export function deveSincronizarComissaoFixa(nome: string | null, valorBruto: number | null, userId: string | null): boolean {
  return nome != null || Number(valorBruto ?? 0) !== 0 || userId != null;
}

/**
 * Compara as linhas GERENCIADAS (managed_by_sale=true) de occurrence_commissions contra o que
 * calcular_distribuicao_venda()/sale_commission_extras dizem que deveria estar lá. "Deveria existir"
 * usa a MESMA regra de sync_occurrence_commissions (nome, valor bruto OU user_id não-nulos) — nunca
 * só "valor não é null": isso deixava passar um indicador/líder removido só no nome, e não detectava
 * uma linha automática velha que já deveria ter sido apagada. Nunca usa uma linha manual
 * (managed_by_sale=false) pra decidir se está sincronizado — mesmo que exista uma com o mesmo papel.
 */
export function verificarComissoesDesatualizadas(args: {
  sale: FieldBag;
  distribuicao: FieldBag | null | undefined;
  commissions: OcorrenciaComissaoRow[];
  commissionExtras: SaleExtraRow[];
}): boolean {
  const { sale, distribuicao, commissions, commissionExtras } = args;
  if (!distribuicao) return false;

  const checagens: { papel: (typeof PAPEIS_FIXOS)[number]; nome: string | null; valorBruto: number | null; valorEsperado: number | null; userIdEsperado: string | null }[] = [
    { papel: "corretor_captador", nome: sale.corretor_captador ?? null, valorBruto: sale.valor_comissao_captador ?? null, valorEsperado: distribuicao.liquido_captador ?? null, userIdEsperado: userIdParaPapel("corretor_captador", sale) },
    { papel: "corretor_vendedor", nome: sale.corretor_vendedor ?? null, valorBruto: sale.valor_comissao_vendedor ?? null, valorEsperado: distribuicao.liquido_vendedor ?? null, userIdEsperado: userIdParaPapel("corretor_vendedor", sale) },
    { papel: "indicador_captador", nome: sale.indicador_captador ?? null, valorBruto: sale.valor_comissao_indicador_captador ?? null, valorEsperado: sale.valor_comissao_indicador_captador ?? null, userIdEsperado: null },
    { papel: "indicador_vendedor", nome: sale.indicador_vendedor ?? null, valorBruto: sale.valor_comissao_indicador_vendedor ?? null, valorEsperado: sale.valor_comissao_indicador_vendedor ?? null, userIdEsperado: null },
    { papel: "lider_captador", nome: sale.lider_captador_nome ?? null, valorBruto: sale.valor_comissao_lider_captador ?? null, valorEsperado: sale.valor_comissao_lider_captador ?? null, userIdEsperado: userIdParaPapel("lider_captador", sale) },
    { papel: "lider_vendedor", nome: sale.lider_vendedor_nome ?? null, valorBruto: sale.valor_comissao_lider_vendedor ?? null, valorEsperado: sale.valor_comissao_lider_vendedor ?? null, userIdEsperado: userIdParaPapel("lider_vendedor", sale) },
  ];

  const divergeFixo = checagens.some(({ papel, nome, valorBruto, valorEsperado, userIdEsperado }) => {
    const deveriaExistir = deveSincronizarComissaoFixa(nome, valorBruto, userIdEsperado);
    const row = commissions.find((r) => r.papel === papel && !r.sale_commission_extra_id && r.managed_by_sale === true);
    if (!deveriaExistir) return !!row; // linha automática velha ainda presente = desatualizado
    if (!row) return true; // deveria existir e não tem linha automática = desatualizado
    if (Math.abs(Number(row.valor ?? 0) - Number(valorEsperado ?? 0)) > 0.01) return true;
    if ((row.nome ?? null) !== (nome ?? null)) return true;
    if ((row.user_id ?? null) !== (userIdEsperado ?? null)) return true;
    return false;
  });

  const divergeExtra = commissionExtras.some((extra) => {
    const papel = papelDaExtra(extra.papel);
    const userIdEsperado = userIdParaExtra(papel, sale, extra);
    const row = commissions.find((r) => r.sale_commission_extra_id === extra.id);
    if (!row) return true; // extra novo ainda sem linha
    if (Math.abs(Number(row.valor ?? 0) - Number(extra.valor ?? 0)) > 0.01) return true;
    if ((row.nome ?? null) !== (extra.nome ?? null)) return true;
    if (row.papel !== papel) return true;
    if ((row.user_id ?? null) !== (userIdEsperado ?? null)) return true;
    if (row.managed_by_sale !== true) return true;
    return false;
  });

  // Extra removido no Resumo, mas a linha automática ainda existe na Ocorrência.
  const extraOrfao = commissions.some((r) => r.sale_commission_extra_id && r.managed_by_sale === true && !commissionExtras.some((e) => e.id === r.sale_commission_extra_id));

  return divergeFixo || divergeExtra || extraOrfao;
}
