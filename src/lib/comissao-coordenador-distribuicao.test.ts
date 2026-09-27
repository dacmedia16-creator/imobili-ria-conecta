import { describe, expect, it } from "vitest";
import {
  agruparComissaoPorCoordenador,
  cargosDasLinhas,
  type LinhaComissaoCoordenador,
} from "./comissao-coordenador";

const base = { sem_cadastro_confirmado: false } as const;

/** Lançamento com dois team_leader (caso real 630591261-49): corretor da equipe do Salvador. */
const DOIS_LIDERES: LinhaComissaoCoordenador[] = [
  { ...base, occurrence_id: "o1", modalidade: "lancamento", papel: "corretor_vendedor", user_id: "luciano", nome: "Luciano", valor: 5553.36, lideres_equipe: ["salvador"] },
  { ...base, occurrence_id: "o1", modalidade: "lancamento", papel: "team_leader", user_id: "gustavo", nome: "Gustavo", valor: 1666.01, cargo_team_leader: true },
  { ...base, occurrence_id: "o1", modalidade: "lancamento", papel: "team_leader", user_id: "salvador", nome: "Salvador", valor: 555.33, cargo_gestor: true },
];

const secaoDoMembro = (linhas: LinhaComissaoCoordenador[]) => {
  const r = agruparComissaoPorCoordenador(linhas, cargosDasLinhas(linhas));
  return r.secoes.find((s) => s.itens.some((i) => i.tipo === "membro"))!.nome;
};

describe("Comissão por Coordenador — distribuição determinística (item 15)", () => {
  it("E1: o dono não depende da ordem das linhas e prefere o líder da equipe do corretor", () => {
    expect(secaoDoMembro(DOIS_LIDERES)).toBe("Salvador");
    expect(secaoDoMembro([...DOIS_LIDERES].reverse())).toBe("Salvador");
  });

  it("E1: sem líder da equipe entre os candidatos, vence o de maior valor", () => {
    const semEquipe = DOIS_LIDERES.map((l) => ({ ...l, lideres_equipe: [] }));
    expect(secaoDoMembro(semEquipe)).toBe("Gustavo");
    expect(secaoDoMembro([...semEquipe].reverse())).toBe("Gustavo");
  });

  it("E2: cargos vêm da RPC (mesma visão para Admin e Financeiro)", () => {
    const cargos = cargosDasLinhas(DOIS_LIDERES);
    expect(cargos.gustavo).toEqual({ gestor: false, teamLeader: true });
    expect(cargos.salvador).toEqual({ gestor: true, teamLeader: false });
    const r = agruparComissaoPorCoordenador(DOIS_LIDERES, cargos);
    expect(r.secoes.find((s) => s.nome === "Gustavo")!.bloco).toBe("TEAM_LEADERS");
  });

  it("E3: papel 'outro' aparece como coordenação da própria pessoa", () => {
    const linhas: LinhaComissaoCoordenador[] = [
      { ...base, occurrence_id: "o2", modalidade: "lancamento", papel: "outro", user_id: "gabriel", nome: "Gabriel", valor: 319.88, cargo_gestor: true },
    ];
    const r = agruparComissaoPorCoordenador(linhas, cargosDasLinhas(linhas));
    expect(r.totalComissao).toBeCloseTo(319.88, 2);
    expect(r.secoes[0].itens[0].tipo).toBe("coordenacao");
  });
});
