import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260906203000_producao_por_pessoa_fallback_lider_unico.sql",
);

function sqlExecutavel() {
  return readFileSync(MIGRATION, "utf8").replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
}

describe("producao_por_pessoa_dados — contrato SQL do fallback por líder", () => {
  const sql = sqlExecutavel();

  it("considera somente fontes internas com lado explícito e deduplica a mesma pessoa", () => {
    expect(sql).toContain("s.lider_captador_id");
    expect(sql).toContain("s.lider_vendedor_id");
    expect(sql).toContain("oc.papel in ('lider_captador', 'lider_vendedor')");
    expect(sql).toContain(
      "oc.papel in ('gestor', 'team_leader') and oc.lado in ('captador', 'vendedor')",
    );
    expect(sql).toContain("join profiles p on p.id = oc.user_id");
    expect(sql).toContain("count(distinct user_id) = 1");
  });

  it("não usa criador, parceria externa nem liderança financeira sem lado como inferência", () => {
    expect(sql).not.toContain("s.corretor_id");
    expect(sql).not.toContain("s.coordenador_id");
    expect(sql).not.toContain("s.team_leader_id");
    expect(sql).not.toContain("occurrence_partners");
    expect(sql).not.toContain("parceria_");
  });

  it("limita o fallback a vendas padrão e preserva o rateio de Lançamento", () => {
    expect(sql).toContain(
      "when s.modalidade::text = 'padrao' then coalesce(s.corretor_captador_id, fc.user_id)",
    );
    expect(sql).toContain("else coalesce(s.corretor_vendedor_id, fv.user_id)");
    expect(sql).toContain("when s.modalidade::text = 'lancamento' then lv.user_id");
    expect(sql).toContain("when s.modalidade::text = 'lancamento' then coalesce(lv.fracao, 1)");
  });

  it("não mantém nome solto quando a ponta não tem vínculo interno inequívoco", () => {
    expect(sql).toContain("when s.modalidade::text = 'padrao' then fc.nome else null");
    expect(sql).toContain(
      "when s.corretor_vendedor_id is not null then coalesce(pv.nome, s.corretor_vendedor) else fv.nome",
    );
  });
});
