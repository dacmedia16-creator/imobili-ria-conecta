import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261013130000_impressao_data_assinatura_oficial.sql",
    import.meta.url,
  ),
  "utf8",
);
const body = readFileSync(
  new URL("../components/vendas/OccurrenceReportBody.tsx", import.meta.url),
  "utf8",
);

describe("impressão da ocorrência usa a data oficial da venda", () => {
  it("regra única: Lançamento = data da venda; padrão = último contrato_assinado em SP", () => {
    expect(migration).toContain("public.data_assinatura_oficial(_sale_id uuid)");
    expect(migration).toContain("max(h.created_at) AT TIME ZONE 'America/Sao_Paulo'");
    expect(migration).toContain("h.para::text = 'contrato_assinado'");
    expect(migration).toContain(
      "COALESCE(public.data_assinatura_oficial(s.id), o.data_assinatura)",
    );
    expect(migration).not.toMatch(/(?:CREATE|ALTER|DROP) POLICY/i);
  });
  it("relatório exibe a data oficial e só cai na data digitada se a consulta falhar", () => {
    expect(body).toContain('rpc("data_assinatura_oficial"');
    expect(body).toContain("dateBR(dataAssinaturaOficial ?? occ?.data_assinatura)");
  });
});
