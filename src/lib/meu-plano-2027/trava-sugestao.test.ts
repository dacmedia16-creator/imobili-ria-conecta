/**
 * Brecha da trava de valores no servidor (Denis 23/11, item 1, cartão t_3d55d20c): transações SUGERIDAS (campo em
 * branco) e o VGC calculado com elas também bloqueiam a assinatura, igual à tela. Estes casos são a referência da
 * tela (conferirPlano) e são repetidos na suíte SQL contra carreira_plano_trava (migration 20261228120000).
 */
import { describe, expect, it } from "vitest";
import { conferirPlano } from "./conferencia";
import type { Respostas } from "./regras";
import CASOS from "./trava-sugestao.casos.json";

describe("trava de valores: tela = referência dos casos do servidor", () => {
  it.each(CASOS as { nome: string; r: Respostas; bloqueia: boolean }[])(
    "$nome",
    ({ r, bloqueia }) => {
      expect(conferirPlano(r).bloqueiaAssinatura).toBe(bloqueia);
    },
  );
});
