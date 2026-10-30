// Clicksign na VENDA: corretores lidos pelo servidor (t_bc726348). Antes, a edge chamava
// sale_corretores com a chave service_role e recebia lista vazia ("sem corretor com cadastro").
// Só leitura de arquivos e mock: sem rede, sem banco. O teste de banco (service_role sem JWT,
// isolamento de org, anon/authenticated sem EXECUTE) está em supabase/tests/clicksign_sale_corretores.sql.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { corretorIds } from "../../supabase/functions/clicksign-sale/core.ts";
import { buildSaleSigners } from "../../supabase/functions/_shared/clicksign-venda.ts";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const A = "3a550acf-0000-4000-8000-000000000001";
const B = "3a550acf-0000-4000-8000-000000000002";

describe("corretorIds", () => {
  it("aceita SETOF uuid como string ou objeto e remove vazios/duplicados", () => {
    expect(corretorIds([A, { clicksign_sale_corretores: B }, A, "", null])).toEqual([A, B]);
  });
  it("lista ausente vira vazio (sem quebrar)", () => {
    expect(corretorIds(null)).toEqual([]);
    expect(corretorIds(undefined)).toEqual([]);
  });
});

describe("edge clicksign-sale usa a função do servidor", () => {
  const index = read("supabase/functions/clicksign-sale/index.ts");
  it("chama clicksign_sale_corretores com org e venda (não mais sale_corretores)", () => {
    expect(index).toMatch(
      /admin\.rpc\("clicksign_sale_corretores", \{ _org: org, _sale_id: saleId \}\)/,
    );
    expect(index).not.toMatch(/rpc\("sale_corretores"/);
  });
});

describe("migration 20261030150000_clicksign_sale_corretores", () => {
  const sql = read("supabase/migrations/20261030150000_clicksign_sale_corretores.sql");
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  it("é aditiva: não mexe em sale_corretores", () => {
    expect(code).not.toMatch(/sale_corretores\(_sale_id/);
    expect(code).not.toMatch(/(ALTER|DROP|REPLACE)[^;]*\bpublic\.sale_corretores\b/i);
  });
  it("dona postgres, SECURITY DEFINER, search_path fixo e só service_role executa", () => {
    expect(code).toMatch(/SECURITY DEFINER SET search_path = ''/);
    expect(code).toMatch(/OWNER TO postgres/);
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.clicksign_sale_corretores\(uuid, uuid\) FROM PUBLIC, anon, authenticated/,
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.clicksign_sale_corretores\(uuid, uuid\) TO service_role;/,
    );
    expect(code).not.toMatch(/TO (authenticated|anon)/);
  });
  it("prende venda e extras à organização recebida", () => {
    expect(code).toMatch(/s\.organization_id = _org/);
    expect(code).toMatch(/e\.organization_id = _org/);
  });
});

describe("com o corretor devolvido, a venda deixa de cair em 'sem corretor com cadastro'", () => {
  it("monta o signatário do corretor", () => {
    const r = buildSaleSigners({
      parties: [
        { papel: "vendedor_1", nome: "Valter Vendedor", email: "valter@example.com" },
        { papel: "comprador_1", nome: "Bruno Comprador", email: "bruno@example.com" },
      ],
      corretores: [{ nome: "Renata Teste", email: "renata@example.com" }],
      imobiliaria: [{ nome: "Edson Imobiliaria", email: "edson@example.com" }],
      testemunhas: [
        { nome: "Tania Testemunha", email: "tania@example.com" },
        { nome: "Tiago Testemunha", email: "tiago@example.com" },
      ],
      extras: [],
    });
    expect(r.errors.join(" ")).not.toMatch(/sem corretor/);
    expect(r.signers.some((s) => s.email === "renata@example.com")).toBe(true);
  });
});
