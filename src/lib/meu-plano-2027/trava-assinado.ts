/**
 * Plano assinado = só leitura nos campos de meta e cálculo (cartão t_850a0d39, Denis 20/11: "trava sim").
 * Para mudar, o gestor/admin/líder reabre o plano ("Reabrir plano", t_495e4305).
 *
 * Espelho de public.carreira_plano_parte_travada() (migration 20261209140000). O banco é quem garante: um
 * gatilho em carreira_plano recusa a mudança vinda de qualquer RPC. Aqui só evita a tela tentar gravar.
 *
 * LIVRES depois de assinar (acompanhamento do ano e navegação; não entram em calc() nem na meta oficial):
 *  - ac.*  p44 Meu acompanhamento semanal (o que fez em cada semana);
 *  - pm.*  p43 Meu painel mensal (realizado digitado no fim de cada mês);
 *  - sem.* p50 Minhas 4 primeiras semanas (checklist);
 *  - mc.*  p51 Primeira captação e primeira venda (marcos e datas que aconteceram);
 *  - ui.*  última tela/página do book aberta (só navegação).
 * TODO o resto trava (lista fechada de livres: prefixo novo nasce travado).
 */
import type { Respostas } from "./regras";

export const PREFIXOS_LIVRES = ["ac", "pm", "sem", "mc", "ui"] as const;

/** Campo que continua editável com o plano assinado. */
export const campoLivre = (k: string) =>
  (PREFIXOS_LIVRES as readonly string[]).includes(k.split(".")[0]);

/** Mesma mensagem do banco. */
export const MSG_PLANO_ASSINADO = "Plano assinado. Para mudar, peça ao seu gestor para reabrir.";

/** Erro do banco é a trava do plano assinado? */
export const erroPlanoAssinado = (msg: string | null | undefined) =>
  /Plano assinado\. Para mudar/i.test(msg ?? "");

/** Só as chaves livres (o que a tela ainda pode gravar num plano assinado). */
export function soLivres<T extends Record<string, unknown>>(campos: T): Partial<T> {
  const r: Partial<T> = {};
  for (const [k, v] of Object.entries(campos))
    if (campoLivre(k)) (r as Record<string, unknown>)[k] = v;
  return r;
}

/** Telas em que TODOS os campos são livres (seguem editáveis com o plano assinado). */
export const TELAS_LIVRES: readonly string[] = ["p43", "p44", "p50", "p51"];

/** Fila guardada no aparelho: com o plano assinado, só as chaves livres seguem (as outras o banco recusaria). */
export function filaPermitida(
  fila: Respostas,
  assinado: boolean,
): { fica: Respostas; descartou: number } {
  if (!assinado) return { fica: fila, descartou: 0 };
  const fica = soLivres(fila) as Respostas;
  return { fica, descartou: Object.keys(fila).length - Object.keys(fica).length };
}
