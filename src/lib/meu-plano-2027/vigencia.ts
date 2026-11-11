import { ANO_PLANO } from "./telas";
import { calc, metaMensalDoPlano, type Respostas, type TaxasFunil } from "./regras";

/** Primeiro dia em que as metas do Meu Plano 2027 passam a contar (fuso de São Paulo, aaaa-mm-dd). */
export const INICIO_VIGENCIA = `${ANO_PLANO}-01-01`;

export const AVISO_VIGENCIA = "Suas metas do Meu Plano 2027 valem a partir de janeiro";
export const TEXTO_FAROL_AGUARDANDO = "Plano vale a partir de jan/2027";
export const TEXTO_MES_TRAVADO = "vem do Meu Plano 2027 — para mudar, ajuste o plano";

/**
 * `hoje` já vem no fuso de São Paulo (periodoAtual().hoje). Antes de 01/01/2027 as metas do plano
 * não coloram Sua semana, Equipe nem Farol; V1/V2/visita do Diário continuam valendo.
 */
export function planoVigente(hoje: string): boolean {
  return hoje >= INICIO_VIGENCIA;
}

/** Ano civil de uma data aaaa-mm-dd. */
export function anoCivil(hoje: string): number {
  return Number(hoje.slice(0, 4));
}

/**
 * Meta do mês no "Meu mês" em 2027, só com módulo ligado e plano assinado. null = campo manual
 * (2026, módulo desligado, sem assinatura ou plano incompleto).
 */
export function metaMesDoPlanoAssinado(opts: {
  hoje: string;
  moduloOn: boolean;
  assinadoEm: string | null | undefined;
  respostas: Respostas | null | undefined;
  padrao?: Partial<TaxasFunil> | null;
}) {
  if (!opts.moduloOn) return null;
  if (anoCivil(opts.hoje) !== ANO_PLANO) return null;
  if (!opts.assinadoEm) return null;
  if (!opts.respostas || Object.keys(opts.respostas).length === 0) return null;
  return metaMensalDoPlano(calc(opts.respostas, opts.padrao));
}
