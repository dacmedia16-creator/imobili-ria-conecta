import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Cadeia from().select().eq().maybeSingle() do supabase-js (só o que a função usa).
const calls: { table?: string; select?: string; eq?: [string, unknown] } = {};
let resposta: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: (table: string) => {
      calls.table = table;
      const q = {
        select: (s: string) => ((calls.select = s), q),
        eq: (c: string, v: unknown) => ((calls.eq = [c, v]), q),
        maybeSingle: async () => resposta,
      };
      return q;
    },
  },
}));

import { proprietariosDaCaptacao } from "./feedback-captacao-db";
import { ownerNames } from "./exclusive-captures";
import { juntarNomes } from "./link-acompanhamento";

const dono = (nome_completo: string) => ({ nome_completo, cpf: "000", telefone: "1", email: "x" });

describe("Feedback: nomes dos proprietários no topo (t_3a4fdb92)", () => {
  beforeEach(() => {
    resposta = { data: null, error: null };
  });

  it("ownerNames: todos na ordem do contrato, sem vazios", () => {
    expect(
      ownerNames({
        proprietario_1: dono(" Maria Silva "),
        proprietario_2: dono("João Souza"),
        proprietarios_extras: [dono(""), dono("Ana Lima")],
      } as never),
    ).toEqual(["Maria Silva", "João Souza", "Ana Lima"]);
    expect(ownerNames(null)).toEqual([]);
    expect(ownerNames({ proprietario_1: dono("  ") } as never)).toEqual([]);
  });

  it("lê só o nome do 1º e do 2º (e os extras), pela tabela com RLS", async () => {
    resposta = {
      data: { p1: "Maria", p2: "João", tem_p2: dono("João"), extras: null },
      error: null,
    };
    const nomes = await proprietariosDaCaptacao("cap-1");
    expect(nomes).toEqual(["Maria", "João"]);
    expect(calls.select).toContain("form_data->proprietario_1->>nome_completo");
    expect(calls.select).toContain("form_data->proprietario_2->>nome_completo");
    expect(juntarNomes(nomes)).toBe("Maria e João");
    expect(calls.table).toBe("exclusive_captures");
    expect(calls.eq).toEqual(["id", "cap-1"]);
    expect(calls.select).not.toMatch(/\*|cpf|telefone|email|broker|captor/);
  });

  it("três ou mais proprietários: todos, na ordem; 1º sem nome não aparece", async () => {
    resposta = {
      data: { p1: "", p2: "João", tem_p2: dono("João"), extras: [dono("Ana"), dono("Bia")] },
      error: null,
    };
    expect(await proprietariosDaCaptacao("cap-2")).toEqual(["João", "Ana", "Bia"]);
    // Extras sem 2º proprietário são ignorados, como em captureOwners.
    resposta = {
      data: { p1: "Maria", p2: null, tem_p2: null, extras: [dono("Ana")] },
      error: null,
    };
    expect(await proprietariosDaCaptacao("cap-3")).toEqual(["Maria"]);
  });

  it("sem permissão (RLS devolve nada) ou erro: lista vazia, a linha some", async () => {
    resposta = { data: null, error: null };
    expect(await proprietariosDaCaptacao("cap-x")).toEqual([]);
    resposta = { data: null, error: { message: "permission denied" } };
    expect(await proprietariosDaCaptacao("cap-x")).toEqual([]);
  });

  it("tela: a linha só aparece com nome e só depois da captação visível", () => {
    const src = readFileSync("src/routes/_authenticated/feedback.tsx", "utf8");
    expect(src).toContain("proprietarios.length ? (");
    expect(src).toMatch(
      /if \(c\) \{\s*const nomes = await proprietariosDaCaptacao\(c\.capture_id\)/,
    );
  });
});
