import { describe, expect, it } from "vitest";
import { opcoesEquipeNovoUsuario } from "./novo-usuario-equipe";

describe("opcoesEquipeNovoUsuario", () => {
  it("lista mães por nome e as subequipes logo abaixo como 'Mãe → Sub'", () => {
    const teams = [
      { id: "s2", nome: "Zeta", parent_team_id: "b" },
      { id: "a", nome: "Beta", parent_team_id: null },
      { id: "b", nome: "Alfa", parent_team_id: null },
      { id: "s1", nome: "Leste", parent_team_id: "b" },
    ];
    expect(opcoesEquipeNovoUsuario(teams)).toEqual([
      { id: "b", label: "Alfa" },
      { id: "s1", label: "Alfa → Leste" },
      { id: "s2", label: "Alfa → Zeta" },
      { id: "a", label: "Beta" },
    ]);
  });

  it("sem equipes devolve lista vazia (fica só 'Sem equipe')", () => {
    expect(opcoesEquipeNovoUsuario([])).toEqual([]);
  });
});
