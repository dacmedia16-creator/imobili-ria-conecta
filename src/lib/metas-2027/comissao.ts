/**
 * Quebra da comissão de uma venda e o que cada papel pode ver (cartão t_f87b2ae5, Denis 19/11). Puro.
 *
 * - Admin/gestor: bruta → parte da imobiliária → indicador/extras → parte do corretor, discriminados.
 * - CORRETOR: só a parte dele e o que foi descontado DELE (indicador/extras). Nunca a bruta da venda
 *   nem a parte da imobiliária (a visão do corretor nem carrega esses campos).
 * Os valores virão de uma RPC futura (etapa 2) montada sobre calcular_distribuicao_venda.
 */
export type QuebraComissao = {
  bruta: number;
  imobiliaria: number;
  indicador: number;
  extras: number;
  /** Parte do corretor = bruta − imobiliária − indicador − extras (nunca negativa). */
  corretor: number;
};

export type VisaoCorretorComissao = {
  suaParte: number;
  descontadoDeVoce: { indicador: number; extras: number; total: number };
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);

export function quebrarComissao(v: {
  bruta: number;
  imobiliaria: number;
  indicador?: number;
  extras?: number;
}): QuebraComissao {
  const bruta = n(v.bruta);
  const imobiliaria = n(v.imobiliaria);
  const indicador = n(v.indicador);
  const extras = n(v.extras);
  return {
    bruta: r2(bruta),
    imobiliaria: r2(imobiliaria),
    indicador: r2(indicador),
    extras: r2(extras),
    corretor: r2(Math.max(0, bruta - imobiliaria - indicador - extras)),
  };
}

/** O que o corretor vê: sem bruta e sem parte da imobiliária. */
export function visaoCorretor(q: QuebraComissao): VisaoCorretorComissao {
  return {
    suaParte: q.corretor,
    descontadoDeVoce: {
      indicador: q.indicador,
      extras: q.extras,
      total: r2(q.indicador + q.extras),
    },
  };
}
