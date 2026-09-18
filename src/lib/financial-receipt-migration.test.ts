import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260918160000_obriga_dados_recebimento_e_corrige_periodo.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

describe("trava de dados financeiros da ocorrência", () => {
  it("valida previsão completa e recebimento atômico", () => {
    expect(migration).toContain(
      "create or replace function public.validar_dados_financeiros_ocorrencia()",
    );
    expect(migration).toContain("before insert or update on public.occurrences");
    expect(migration).toContain("data e valor recebido juntos");
    expect(migration).toContain("sem previsão completa (data, valor e forma)");
    expect(migration).toContain("informe ao menos uma previsão de recebimento completa");
  });

  it("não transforma a correção histórica em backfill destrutivo", () => {
    expect(migration).toContain("registros históricos incompletos continuam consultáveis");
    expect(migration).toContain("if not (v_exigir_previsao or v_financeiro_alterado)");
  });
});
