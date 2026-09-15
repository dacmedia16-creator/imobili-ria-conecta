import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260915193000_normaliza_comissao_orfa_ao_devolver.sql",
);

describe("devolução ao gestor — normalização antes da sincronização", () => {
  it("limpa somente indicadores/líderes sem vínculo e preserva participantes vinculados", () => {
    const source = readFileSync(MIGRATION, "utf8");

    expect(source).toContain("new.status::text = 'ocorrencia_devolvida_gestor'");
    expect(source).toContain("indicador_captador_id is null");
    expect(source).toContain("indicador_vendedor_id is null");
    expect(source).toContain("lider_captador_id is null");
    expect(source).toContain("lider_vendedor_id is null");
    expect(source).toContain("valor_comissao_lider_captador = case");
    expect(source).toContain("valor_comissao_lider_vendedor = case");
    expect(source).toContain("set aceita_financeiro = false");
    expect(source).toContain("update public.occurrences");
    expect(source).not.toContain("valor_comissao_captador = null");
    expect(source).not.toContain("valor_comissao_vendedor = null");
  });
});
