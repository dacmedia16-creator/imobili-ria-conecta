import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260902203000_sincronizacao_final_ocorrencia.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

describe("contrato da sincronização final da ocorrência", () => {
  it("centraliza venda, pagamento, comissões e parceria antes do Financeiro", () => {
    expect(sql).toContain("sincronizar_ocorrencia_antes_financeiro");
    expect(sql).toContain("from public.sale_payment");
    expect(sql).toContain("sync_occurrence_commissions");
    expect(sql).toContain("occurrence_partners");
    expect(sql).toContain("trg_sales_sync_antes_financeiro");
    expect(sql).toContain("before update of status on public.sales");
  });

  it("atua somente antes do Financeiro e preserva os dados bancários da ocorrência", () => {
    expect(sql).toContain("ocorrencia_pendente");
    expect(sql).toContain("ocorrencia_devolvida_gestor");
    expect(sql).toContain("ocorrencia_analise_financeiro");
    expect(sql).not.toMatch(/update public\.occurrence_partners[\s\S]*?set[\s\S]*?banco\s*=/);
  });

  it("fecha as duas janelas de falha parcial identificadas na auditoria", () => {
    expect(sql).toContain("trg_sale_payment_sync_ocorrencia");
    expect(sql).toContain("trg_sale_commission_extras_sync_ocorrencia");
    expect(sql).toContain("after insert or update or delete");
  });
});
