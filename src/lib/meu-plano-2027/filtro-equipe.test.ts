/** Busca + filtro da lista "Planos 2027 · equipe" (t_8960c522). Só exibição. */
import { describe, expect, it } from "vitest";
import {
  bateSituacao,
  contarSituacoes,
  filtrarEquipe,
  normalizarBusca,
  type LinhaFiltro,
} from "./filtro-equipe";

const L = (nome: string, pct: number, assinado: boolean, selo: LinhaFiltro["selo"]) => ({
  nome,
  pct,
  assinado,
  selo,
});
const LISTA = [
  L("Juan Pérez", 100, true, "conta"), // assinado + conta na meta
  L("Ana Lúcia Simões", 60, false, "conta_falta_assinar"), // meta oficial, falta assinar
  L("Bruno Costa", 30, false, "falta_meta"), // preenchendo, sem meta
  L("Conceição Araújo", 0, false, "falta_meta"), // não começou
  L("Giulia Moretti", 90, true, "meta_a_conferir"), // valor a conferir
  L("Diego Ávila", 100, true, "assinado_sem_meta"), // assinou, falta a meta
];
const nomes = (xs: { nome: string }[]) => xs.map((x) => x.nome);

describe("busca por nome", () => {
  it("ignora acentos, maiúsculas e espaços: 'perez' acha 'Pérez' e vice-versa", () => {
    expect(normalizarBusca("  PÉREZ  ")).toBe("perez");
    expect(nomes(filtrarEquipe(LISTA, "perez", "todos"))).toEqual(["Juan Pérez"]);
    expect(nomes(filtrarEquipe(LISTA, "PÉREZ", "todos"))).toEqual(["Juan Pérez"]);
    expect(nomes(filtrarEquipe(LISTA, "conceicao", "todos"))).toEqual(["Conceição Araújo"]);
    expect(nomes(filtrarEquipe(LISTA, "simoes", "todos"))).toEqual(["Ana Lúcia Simões"]);
  });
  it("parte do nome e várias palavras em qualquer ordem", () => {
    expect(nomes(filtrarEquipe(LISTA, "avi", "todos"))).toEqual(["Diego Ávila"]);
    expect(nomes(filtrarEquipe(LISTA, "simoes ana", "todos"))).toEqual(["Ana Lúcia Simões"]);
    expect(filtrarEquipe(LISTA, "ana xyz", "todos")).toEqual([]);
  });
  it("busca vazia devolve todos, na ordem original", () => {
    expect(nomes(filtrarEquipe(LISTA, "   ", "todos"))).toEqual(nomes(LISTA));
  });
});

describe("filtro por situação", () => {
  const por = (s: Parameters<typeof bateSituacao>[1]) => nomes(filtrarEquipe(LISTA, "", s));
  it("cada situação usa os estados que a tela já calcula", () => {
    expect(por("nao_comecou")).toEqual(["Conceição Araújo"]);
    expect(por("preenchendo")).toEqual(["Ana Lúcia Simões", "Bruno Costa"]);
    expect(por("falta_assinar")).toEqual(["Ana Lúcia Simões"]);
    expect(por("assinado")).toEqual(["Juan Pérez", "Giulia Moretti", "Diego Ávila"]);
    expect(por("conta_meta")).toEqual(["Juan Pérez", "Ana Lúcia Simões"]);
    expect(por("sem_meta")).toEqual(["Bruno Costa", "Conceição Araújo", "Diego Ávila"]);
    expect(por("a_conferir")).toEqual(["Giulia Moretti"]);
  });
  it("busca e filtro juntos", () => {
    expect(nomes(filtrarEquipe(LISTA, "o", "assinado"))).toEqual(["Giulia Moretti", "Diego Ávila"]);
    expect(filtrarEquipe(LISTA, "perez", "nao_comecou")).toEqual([]);
  });
  it("contagem por situação é sobre o total", () => {
    expect(contarSituacoes(LISTA)).toEqual({
      todos: 6,
      nao_comecou: 1,
      preenchendo: 2,
      falta_assinar: 1,
      assinado: 3,
      conta_meta: 2,
      sem_meta: 3,
      a_conferir: 1,
    });
  });
});
