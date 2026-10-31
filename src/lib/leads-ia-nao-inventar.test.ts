// t_d775be06 (Denis 31/10, tópico 6238): casos reais da ZZ.
//  - Daniela 2225f4d9: "Boa noite! ... para amanhã" virou "Amanhã à noite anotado!" (inventado).
//  - Thiago 995c6dc0: "Finais de semana..." + "Manhã" virou "sábado de manhã" e a frase do corretor saiu duplicada.
//  - Luciana 66050ec1: 2 respostas automáticas da Grafi10 foram tratadas como a cliente.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diaPedido, norm, periodoDe, respostaAutomatica, visitaDasFalas } from "./leads-ia";
import { INSTRUCAO, semFraseCorretor, visitaInventada } from "./leads-ia-redacao";

const DANIELA =
  "Boa noite! Gostaria de agendar visita se possível para amanhã pq não é para mim, mas para uma amiga que vem de são Paulo e só poderá visitar amanhã.";
const GRAFI1 =
  "Olá queridos clientes informamos que nosso horário de atendimento é de segunda a quinta das 9h as 18h e na sexta das 9h as 17h30.\nResponderemos o mais breve possível. Agradecemos a compreensão.";
const GRAFI2 = "Olá aqui é Luciana da Grafi10 em que posso te ajudar?";

describe("Ajuste 1 — não inventar dia/período", () => {
  it("Daniela: \"Boa noite\" é cumprimento; o dia é amanhã e NÃO há período", () => {
    expect(periodoDe(norm(DANIELA))).toBeNull();
    expect(diaPedido(DANIELA)).toBe("amanhã");
    expect(diaPedido(DANIELA)).not.toMatch(/noite/);
    expect(visitaDasFalas([DANIELA])).toEqual({ dia: "amanhã", periodo: null });
  });
  it("Daniela: a frase \"Amanhã à noite anotado!\" é barrada pelo validador", () => {
    expect(visitaInventada("Amanhã à noite anotado! Já pedi para o corretor.", [DANIELA])).toMatch(/noite/);
    expect(visitaInventada("Anotado, amanhã! Fica melhor de manhã ou à tarde?", [DANIELA])).toBeNull();
  });
  it("Thiago: \"finais de semana\" + \"Manhã\" = fim de semana de manhã (nunca sábado/domingo)", () => {
    const falas = ["Manhã", "Finais de semana não tem horário específico"];
    const v = visitaDasFalas(falas);
    expect(v).toEqual({ dia: "fim de semana", periodo: "de manhã" });
    expect(`${v.dia} ${v.periodo}`).not.toMatch(/sábado|domingo/);
    expect(visitaInventada("Anotado, sábado de manhã!", falas)).toMatch(/sabado/);
    expect(visitaInventada("Fim de semana de manhã anotado!", falas)).toBeNull();
  });
  it("horário que o cliente não disse é barrado; o que ele disse passa", () => {
    expect(visitaInventada("Sexta às 15h anotado!", ["pode ser sexta à tarde"])).toMatch(/15h/);
    expect(visitaInventada("Sexta às 15h anotado!", ["sexta 15h"])).toBeNull();
  });
  it("Thiago: só uma frase sobre o corretor na passagem", () => {
    const m = semFraseCorretor("Anotado, fim de semana de manhã! O corretor confirma o horário com você.");
    expect(m).toBe("Anotado, fim de semana de manhã!");
  });
  it("prompt: anota só o que o cliente disse; cumprimento não é período; fim de semana não vira sábado", () => {
    expect(INSTRUCAO).toMatch(/Anote SÓ o que o cliente disse/);
    expect(INSTRUCAO).toMatch(/"Boa noite", "bom dia" e "boa tarde" são cumprimentos, NÃO período/);
    expect(INSTRUCAO).toMatch(/nunca vire "sábado" nem "domingo"/);
  });
});

describe("Ajuste 2 — resposta automática de empresa", () => {
  it("as 2 mensagens da Grafi10 são classificadas como automáticas", () => {
    expect(respostaAutomatica(GRAFI1)).toBe("forte");
    expect(respostaAutomatica(GRAFI2)).toBe("forte");
  });
  it("falas humanas comuns NÃO são automáticas", () => {
    for (const t of [DANIELA, "Gostaria de saber mais detalhes sobre o imóvel", "Financiar", "Manhã", "sou a Ana, de Itu", "Boa noite! Tem vaga?"])
      expect(respostaAutomatica(t), t).not.toBe("forte");
  });
  it("migration: grava como sistema, não responde, avisa o gestor 1 vez; rollback em 1 arquivo", () => {
    const mig = readFileSync("supabase/migrations/20261031020000_leads_ia_resposta_automatica.sql", "utf8");
    expect(mig).toMatch(/_msg->>'auto', ''\) IN \('forte', 'apresentacao'\)/);
    expect(mig).toMatch(/x\.autor = 'cliente'\)/); // só antes da 1ª fala humana
    expect(mig).toMatch(/'sistema',\s+left\('Resposta automática do número/);
    expect(mig).toMatch(/'responder', false, 'lead_id', _cv\.lead_id, 'auto', true/);
    expect(mig).toMatch(/e\.para = 'resposta_automatica'\) THEN/);
    const rb = readFileSync("docs/sql/rollback/20261031020000_leads_ia_resposta_automatica.rollback.sql", "utf8");
    expect(rb).toMatch(/CREATE OR REPLACE FUNCTION public\.lead_ia_retorno_receber\(/);
    expect(rb).not.toMatch(/'auto'/);
  });
});
