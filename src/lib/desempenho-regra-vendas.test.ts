import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260901183500_alinha_desempenho_contrato_assinado.sql", import.meta.url),
  "utf8",
);

describe("regra de vendas do resumo Desempenho", () => {
  it("conta a venda desde contrato assinado e mantém os estágios posteriores", () => {
    for (const status of [
      "contrato_assinado",
      "ocorrencia_pendente",
      "ocorrencia_analise_financeiro",
      "ocorrencia_devolvida_gestor",
      "ocorrencia_concluida",
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
  });

  it("usa o primeiro evento de confirmação para não duplicar nem trocar o mês da venda", () => {
    expect(migration).toContain("select distinct on (h.sale_id)");
    expect(migration).toContain("order by h.sale_id, h.created_at asc");
  });

  it("não volta a exigir exclusivamente análise financeira", () => {
    expect(migration).not.toContain("where h.para::text = 'ocorrencia_analise_financeiro'");
  });
});
