import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260911120000_preserva_correcao_ocorrencia_devolvida.sql",
  ),
  "utf8",
);
const syncMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260902203000_sincronizacao_final_ocorrencia.sql"),
  "utf8",
);

describe("reenvio de ocorrência devolvida", () => {
  it("não sobrescreve a correção da Ocorrência ao reenviar para o Financeiro", () => {
    expect(migration).toMatch(
      /new\.status::text\s*=\s*'ocorrencia_analise_financeiro'[\s\S]*old\.status::text\s+is distinct from new\.status::text[\s\S]*old\.status::text\s+<>\s+'ocorrencia_devolvida_gestor'/,
    );
    expect(migration).toContain("perform public.sincronizar_ocorrencia_antes_financeiro(old.id);");
  });

  it("continua sincronizando alterações feitas na Resumo enquanto a venda está devolvida", () => {
    expect(syncMigration).toContain("'ocorrencia_devolvida_gestor'");
    expect(syncMigration).toContain("prev_recebimento_valor = v_sale.previsao_recebimento_valor");
  });
});
