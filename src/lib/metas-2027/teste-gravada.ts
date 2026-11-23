/**
 * Só para testes (t_91ec7aa3): a assinatura grava a meta oficial (carreira_plano.meta_oficial) com a MESMA conta
 * da tela (metaOficialDoPlano). Desde a fonte única, o painel só conta quem tem meta GRAVADA, então os planos
 * "assinados" dos testes precisam trazer a meta gravada, como acontece no banco.
 */
import { calc, metaOficialDoPlano, type Respostas } from "@/lib/meu-plano-2027/regras";
import type { MetaOficialGravada } from "./consolidado";

export const ASSINADO_EM = "2026-12-10T13:00:00Z";

/** Meta gravada pela assinatura (ou pelo botão verde) para estas respostas; null se o plano não fecha meta. */
export function gravadaDe(r: Respostas | null | undefined): MetaOficialGravada | null {
  const m = r ? metaOficialDoPlano(calc(r)) : null;
  return m
    ? {
        meta_comissao: m.comissao,
        meta_vgv: m.vgv,
        meta_vendas: m.vendas,
        meta_captacoes: m.captacoes,
      }
    : null;
}

/** Campos de meta gravada (formato da RPC metas_equipe_planos) de um plano assinado/gravado em `em`. */
export function comGravada(r: Respostas | null | undefined, em: string = ASSINADO_EM) {
  const g = gravadaDe(r);
  return { meta_oficial: g, meta_oficial_em: g ? em : null };
}
