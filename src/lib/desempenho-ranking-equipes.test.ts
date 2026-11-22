import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ID_COORDENACAO_LANCAMENTO,
  ID_SEM_EQUIPE,
  INFO_PREMIO_LANCAMENTO,
  linhaRankingEquipe,
  tipoLinhaEquipe,
} from "./desempenho-ranking-equipes";

const V = "20261225120000_conferencia_contagem_dashboard_ranking_sem_equipe";
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const mig = ler(`supabase/migrations/${V}.sql`);
const rb = ler(`supabase/rollback/${V}.sql`);
const tela = ler("src/routes/_authenticated/visao-executiva.tsx");

const base = { vendas_fechadas: 1, comissao: 100, taxa_devolucao: 0 };

describe("linhas do ranking por equipe (t_fee0b359)", () => {
  it("equipe real mantém id e nome", () => {
    const l = linhaRankingEquipe({
      ...base,
      team_id: "t1",
      team_nome: "Equipe Azul",
      linha: "equipe",
    });
    expect(l).toMatchObject({ id: "t1", nome: "Equipe Azul", tipo: "equipe" });
    expect(l.info).toBeUndefined();
  });

  it("team_id nulo vira a linha Sem equipe com explicação (também em resposta antiga, sem `linha`)", () => {
    for (const r of [
      { ...base, team_id: null, team_nome: null, linha: "sem_equipe" as const },
      { ...base, team_id: null, team_nome: null },
    ]) {
      const l = linhaRankingEquipe(r);
      expect(l).toMatchObject({ id: ID_SEM_EQUIPE, nome: "Sem equipe", tipo: "sem_equipe" });
      expect(l.info).toMatch(/soma das pessoas/);
    }
  });

  it("coordenação de lançamento tem linha própria explicada", () => {
    const r = { ...base, team_id: null, team_nome: null, linha: "coordenacao_lancamento" as const };
    expect(tipoLinhaEquipe(r)).toBe("coordenacao_lancamento");
    const l = linhaRankingEquipe(r);
    expect(l).toMatchObject({ id: ID_COORDENACAO_LANCAMENTO, nome: "Coordenação de lançamento" });
    expect(l.info).toMatch(/fora das equipes/);
  });

  it("aviso do prêmio de Lançamento à parte da comissão", () => {
    expect(INFO_PREMIO_LANCAMENTO).toMatch(/prêmio de Lançamento fica à parte da comissão/);
    expect(tela).toContain("infoComissao={INFO_PREMIO_LANCAMENTO}");
  });
});

describe("tela Desempenho (t_fee0b359)", () => {
  it("B1: ranking por corretor diz que é produção como corretor e aponta o Meu Realizado", () => {
    expect(tela).toContain('rotuloComissao="Produção como corretor (captação e venda)"');
    expect(tela).toMatch(
      /Comissões de líder, indicação e coordenação ficam fora daqui: aparecem no Meu Realizado/,
    );
  });

  it("C: ranking por equipe usa as linhas novas, fixas no fim e sem meta", () => {
    expect(tela).toContain("const linha = linhaRankingEquipe(r);");
    expect(tela).toContain('fixoNoFim: linha.tipo !== "equipe"');
    expect(tela).toContain('selecionavel: linha.tipo !== "coordenacao_lancamento"');
  });
});

describe("migration 20261225120000 (contrato)", () => {
  it("só redefine as 2 funções (mesma assinatura), sem DDL de tabela nem grant", () => {
    expect(mig.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    expect(mig).toContain("CREATE OR REPLACE FUNCTION public.dashboard_stats_leve()");
    expect(mig).toContain(
      "CREATE OR REPLACE FUNCTION public.desempenho_ranking_periodo(_de date, _ate date)",
    );
    expect(mig).not.toMatch(
      /\b(ALTER|DROP|CREATE)\s+TABLE\b|\bGRANT\b|\bREVOKE\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i,
    );
  });

  it("A: Minhas vendas/Meus assinados pela comissão de ponta; pendências seguem o cadastro", () => {
    expect(mig).toContain("oc.papel::text in ('corretor_captador', 'corretor_vendedor')");
    expect(mig).toContain("s.id in (select id from meu_cor_cadastro)))");
    expect(mig).toContain(
      "'minhas_vendas', (select count(*) from vs s where s.id in (select id from meu_cor))",
    );
  });

  it("C: linhas sem_equipe e coordenacao_lancamento no ranking de equipes", () => {
    expect(mig).not.toContain("where p.team_id is not null");
    expect(mig).toContain("left join teams t on t.id = r.team_id");
    expect(mig).toContain("'linha', 'coordenacao_lancamento'");
    expect(mig).toContain("'sem_equipe'");
  });

  it("rollback devolve os corpos anteriores das 2 funções", () => {
    expect(rb.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    expect(rb).toContain("where p.team_id is not null");
    expect(rb).not.toContain("meu_occ_pontas");
    expect(rb).not.toContain("coordenacao_lancamento'");
  });
});
