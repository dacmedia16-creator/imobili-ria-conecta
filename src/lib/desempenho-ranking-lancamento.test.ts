import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260901210000_ranking_lancamento_separa_gestao.sql",
    import.meta.url,
  ),
  "utf8",
);

const page = readFileSync(
  new URL("../routes/_authenticated/visao-executiva.tsx", import.meta.url),
  "utf8",
);

describe("ranking de lançamentos", () => {
  it("mantém toda a participação no ranking individual", () => {
    expect(migration).toContain("sum(oc.valor) as valor_na_venda");
    expect(migration).toContain("as gestao_lancamento");
    expect(migration).toContain("as corretora_lancamento");
  });

  it("não atribui a coordenação de lançamento ao ranking de equipes", () => {
    expect(migration).toMatch(
      /sum\(oc\.valor\) filter \(where[\s\S]*oc\.papel <> 'coordenador_lancamento'[\s\S]*as valor_equipe_na_venda/,
    );
    expect(migration).toContain("where p.conta_equipe and u.team_id is not null");
    expect(migration).toContain("vp.modalidade = 'lancamento'");
    expect(migration).toContain("join team_members membros on membros.team_id = equipe.id");
  });

  it("identifica a gestão de lançamentos na visão individual", () => {
    expect(migration).toContain("'gestao_lancamento', gestao_lancamento");
    expect(migration).toContain("'corretora_lancamento', corretora_lancamento");
    expect(page).toContain("Gestão de lançamentos");
    expect(page).toContain("Corretora / ");
  });
});
