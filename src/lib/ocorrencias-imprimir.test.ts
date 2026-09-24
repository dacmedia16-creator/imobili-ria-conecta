import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  podeImprimirOcorrenciasConcluidas,
  podeVerOcorrenciasConcluidas,
} from "./ocorrencias-concluidas";

const route = readFileSync(
  new URL("../routes/_authenticated/ocorrencias-imprimir.tsx", import.meta.url),
  "utf8",
);
const list = readFileSync(
  new URL("../routes/_authenticated/ocorrencias-concluidas.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260924160000_impressao_ocorrencias_concluidas.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("contrato de impressão de ocorrências concluídas", () => {
  it("transmite somente vendas selecionadas e mantém documentos separados na ordem", () => {
    expect(list).toContain('selectedRows.map((row) => row.saleId).join(",")');
    expect(route).toContain("new Set(");
    expect(route).toContain("p_sale_ids: saleIds");
    expect(route).toContain("parsed.data.length !== saleIds.length");
    expect(route).toContain("doc.sale.id !== saleIds[index]");
    expect(route).toContain("doc.occ.sale_id !== saleIds[index]");
    expect(route).toContain('className={index > 0 ? "break-before-page');
    expect(route).toContain("window.print()");
  });

  it("usa o mesmo documento integral do detalhe, não consultas diretas sob RLS", () => {
    expect(route).toContain("<OccurrenceReportBody");
    for (const prop of ["commissions", "partners", "parties", "distribuicao"]) {
      expect(route).toContain(`${prop}={item.${prop}}`);
      expect(migration).toContain(`'${prop}'`);
    }
    expect(route).not.toMatch(
      /\.from\("(?:sales|occurrences|sale_parties|occurrence_commissions|occurrence_partners)"\)/,
    );
    expect(migration).not.toContain("pg_catalog.to_jsonb(s)");
  });

  it("separa leitura da listagem da impressão integral para gestor e team_leader", () => {
    for (const role of ["gestor", "team_leader"]) {
      expect(podeImprimirOcorrenciasConcluidas([role])).toBe(true);
      expect(podeVerOcorrenciasConcluidas([role])).toBe(true);
    }
    for (const role of [
      "corretor",
      "financeiro",
      "juridico",
      "lancamento",
      "admin",
      "super_admin",
    ]) {
      expect(podeImprimirOcorrenciasConcluidas([role])).toBe(false);
      expect(podeVerOcorrenciasConcluidas([role])).toBe(true);
    }
    expect(podeImprimirOcorrenciasConcluidas([])).toBe(false);
    expect(podeImprimirOcorrenciasConcluidas(["corretor", "gestor"])).toBe(true);
    expect(route).toContain("!podeImprimirOcorrenciasConcluidas(roles)");
    expect(list).toContain("{canPrint && (");
    expect(list).toContain("if (!canPrint)");
    expect(migration).toContain("ARRAY['gestor', 'team_leader']::public.app_role[]");
    expect(migration).not.toMatch(
      /'corretor'|'financeiro'|'juridico'|'lancamento'|'admin'|'super_admin'/,
    );
  });

  it("limita a RPC a perfil ativo e ocorrência concluída sem alterar RLS", () => {
    expect(migration).toContain("p.ativo IS TRUE");
    expect(migration).toContain("cardinality(p_sale_ids) > 50");
    expect(migration).toContain("o.status = 'concluida'");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.imprimir_ocorrencias_concluidas(uuid[]) FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.imprimir_ocorrencias_concluidas(uuid[]) TO authenticated",
    );
    expect(migration).not.toMatch(/(?:CREATE|ALTER|DROP) POLICY/i);
  });
});
