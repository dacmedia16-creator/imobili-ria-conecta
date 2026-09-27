import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { criarResolverEquipe, meioDiaSaoPaulo } from "@/lib/equipe-vigente";
import { gerarPontas } from "@/lib/producao-por-pessoa-calc";
import type { ProducaoRawRow } from "@/lib/producao-por-pessoa-types";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260927160000_equipe_historico_vigencia.sql",
    import.meta.url,
  ),
  "utf8",
);
const scriptRafaela = readFileSync(
  new URL("../../docs/sql/dados/20260927_rafaela_fuentes_equipe_gustavo.sql", import.meta.url),
  "utf8",
);

describe("equipe vigente na data da assinatura (itens 7 e 8)", () => {
  const resolver = criarResolverEquipe([
    // trocou da equipe A para a B em 10/09
    {
      membro_id: "p1",
      team_id: "A",
      de: "2026-08-01T00:00:00Z",
      ate: "2026-09-10T15:00:00Z",
      prioridade: 1,
    },
    { membro_id: "p1", team_id: "B", de: "2026-09-10T15:00:00Z", ate: null, prioridade: 1 },
    // líder sem vínculo de membro: equipe própria
    { membro_id: "lider", team_id: "L", de: null, ate: null, prioridade: 2 },
  ]);

  it("o que foi feito antes da troca fica na equipe anterior; depois, na atual", () => {
    expect(resolver("p1", "2026-09-05T12:00:00-03:00")).toBe("A");
    expect(resolver("p1", "2026-09-20T12:00:00-03:00")).toBe("B");
    expect(resolver("p1", null)).toBe("B");
  });

  it("fora de qualquer vigência a pessoa fica sem equipe; líder usa a própria equipe", () => {
    expect(resolver("p1", "2026-07-01T00:00:00Z")).toBeNull();
    expect(resolver("ninguem", "2026-09-01T00:00:00Z")).toBeNull();
    expect(resolver("lider", "2026-09-01T00:00:00Z")).toBe("L");
  });

  it("data civil vira meio-dia de Brasília", () => {
    expect(meioDiaSaoPaulo("2026-09-10")).toBe("2026-09-10T12:00:00-03:00");
    expect(meioDiaSaoPaulo(null)).toBeNull();
  });

  it("Produção por pessoa atribui cada venda pela equipe da data dela", () => {
    const base: Omit<ProducaoRawRow, "sale_id" | "concluida_em"> = {
      imovel_id: null,
      codigo_interno: null,
      modalidade: "lancamento",
      valor_negociado: 100,
      comissao_bruta: 10,
      captador_id: null,
      captador_nome: null,
      vendedor_id: "p1",
      vendedor_nome: "P1",
      vendedor_fracao: 1,
    };
    const pontas = gerarPontas(
      [
        { ...base, sale_id: "s1", concluida_em: "2026-09-05T15:00:00Z" },
        { ...base, sale_id: "s2", concluida_em: "2026-09-20T15:00:00Z" },
      ],
      resolver,
      new Map([
        ["A", "Equipe A"],
        ["B", "Equipe B"],
      ]),
    );
    expect(pontas.map((p) => [p.saleId, p.teamNome])).toEqual([
      ["s1", "Equipe A"],
      ["s2", "Equipe B"],
    ]);
  });

  it("migration cria histórico com vigência, trigger e usa a data da assinatura nas RPCs", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.team_membership_history");
    expect(migration).toContain("EXCLUDE USING gist");
    expect(migration).toContain("CREATE TRIGGER trg_team_members_historico");
    expect(migration).toContain("public.equipe_vigente(p.user_id, p.venda_em)");
    expect(migration).toContain("public.equipe_vigente(p.user_id, p.fechado_em)");
    expect(migration).toContain("h.vigente_de <= occs.venda_em");
    // item 7: equipe própria só com membros ou cargo team_leader (Aline fica sem equipe)
    expect(migration).toContain("public.has_role(_user, 'team_leader')");
    expect(migration).not.toMatch(
      /^\s*(update|delete)\s+(from\s+)?public\.(sales|occurrences|occurrence_commissions)/im,
    );
  });

  it("script da Rafaela é separado, idempotente e não mexe no Pedro Luiz", () => {
    expect(scriptRafaela).toContain(
      "NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.membro_id = p.id)",
    );
    expect(scriptRafaela).not.toMatch(/INSERT[\s\S]*Pedro Luiz/i);
  });
});
