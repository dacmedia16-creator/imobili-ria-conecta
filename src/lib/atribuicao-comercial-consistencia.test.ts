import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260901222000_centraliza_atribuicao_comercial.sql", import.meta.url),
  "utf8",
);
const equipes = readFileSync(new URL("../routes/_authenticated/equipe.tsx", import.meta.url), "utf8");

describe("atribuição comercial única", () => {
  it("separa gestão de lançamento do resultado de equipe", () => {
    expect(migration).toContain("oc.papel <> 'coordenador_lancamento'");
    expect(migration).toContain("case when p.conta_equipe then coalesce(tm.team_id, tl.id) end");
    expect(migration).toContain("join team_members m on m.team_id = t.id");
  });

  it("metas e detalhes consomem a fonte central", () => {
    expect(migration.match(/public\.participacoes_comerciais_validas\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("create or replace function public.metas_progresso_periodo");
    expect(migration).toContain("create or replace function public.desempenho_detalhe_periodo");
  });

  it("Equipes usa o mesmo resumo de atribuição", () => {
    expect(equipes).toContain("fetchAtribuicaoComercialResumo");
    expect(equipes).not.toContain("FECHADAS.includes");
  });

  it("remove as funções antigas sem consumidores", () => {
    for (const nome of [
      "visao_executiva_stats",
      "visao_executiva_detalhe_comissao",
      "resumo_operacao_sem_parceria_30d",
      "comissoes_carteira_sem_parceria",
    ]) expect(migration).toContain(`drop function if exists public.${nome}`);
  });
});
