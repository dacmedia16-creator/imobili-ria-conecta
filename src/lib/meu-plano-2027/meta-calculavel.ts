/**
 * Só assina com a meta oficial calculada (cartão t_3d55d20c, Denis 23/11/2026, tópico 6238).
 *
 * Regra ÚNICA: pode assinar quando metaOficialDoPlano(calc(S)) não é null, ou seja, quando dá para calcular as
 * transações do ano (captação digitada ou sugerida) e a comissão média (digitada ou ticket × %). O banco repete
 * a mesma conta em carreira_plano_falta_meta (migration 20261228120000); os dois são conferidos com os mesmos
 * casos (meta-calculavel.casos.json) no vitest e na suíte SQL.
 * As taxas do funil (padrão da imobiliária) não entram no VGC nem nas transações, por isso não são parâmetro.
 */
import { calc, cheio, metaOficialDoPlano, ok, num, type Respostas } from "./regras";

export type FaltaMeta = { campo: "mt.tCapt" | "mt.comMedia"; nome: string; msg: string };

/** Nomes usados também na mensagem do banco ("Plano sem meta calculada: falta …"). */
export const NOMES_FALTA = {
  "mt.tCapt": "transações de captação",
  "mt.comMedia": "comissão média por transação",
} as const;

/** O que falta para a meta oficial sair. Lista vazia = a meta está calculada e pode assinar. */
export function faltaParaMeta(S: Respostas | null | undefined): FaltaMeta[] {
  const r = S ?? {};
  const C = calc(r);
  if (metaOficialDoPlano(C)) return [];
  const falta: FaltaMeta[] = [];
  if (!ok(C.tCapt)) {
    const digitado = cheio(r["mt.tCapt"]) && !ok(num(r["mt.tCapt"]));
    falta.push({
      campo: "mt.tCapt",
      nome: NOMES_FALTA["mt.tCapt"],
      msg: digitado
        ? "Transações de captação: o valor digitado não é um número. Corrija na tela Metas."
        : "Transações de captação do ano: digite na tela Metas (ou complete estilo de vida, faixa, ticket e % para o sistema sugerir).",
    });
  }
  if (!ok(C.comMedia)) {
    falta.push({
      campo: "mt.comMedia",
      nome: NOMES_FALTA["mt.comMedia"],
      msg: "Comissão média por transação: digite na tela Metas (ou o ticket médio e o % por transação na tela Da comissão à transação).",
    });
  }
  return falta;
}

/** Atalho: a meta oficial está calculada (mesma regra de metaOficialDoPlano). */
export const metaCalculada = (S: Respostas | null | undefined) => faltaParaMeta(S).length === 0;

/** Mensagem curta para o toast e para o erro do hook. */
export function msgFaltaMeta(falta: readonly FaltaMeta[]): string {
  if (!falta.length) return "";
  return `Para assinar, falta a meta oficial: complete ${falta.map((f) => f.nome).join(" e ")} na tela Metas.`;
}
