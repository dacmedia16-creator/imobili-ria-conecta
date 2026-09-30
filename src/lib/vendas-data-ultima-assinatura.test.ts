import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Tela Vendas: venda padrão entra na data da ÚLTIMA assinatura (último contrato_assinado em SP),
// igual a vendas_comerciais_validas() (Denis, 27/09/2026; correção autorizada em 29/09/2026).
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const norm = (s: string) => s.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
// Suspensa (30/09/2026): revertida na produção por timeout para gestor/team leader; fica fora de
// supabase/migrations para nenhum `db push` ou script reaplicá-la até existir a versão otimizada.
const up = ler("docs/sql/suspensas/20260929180000_vendas_data_ultima_assinatura.sql");
const down = ler("docs/sql/rollback/20260929180000_vendas_data_ultima_assinatura.rollback.sql");
const tela = ler("src/routes/_authenticated/vendas.index.tsx");

function funcoes(sql: string) {
  const blocos = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\n\$function\$\n;/g) ?? [];
  return blocos.map(norm);
}

describe("migration 20260929180000 — data da venda pela última assinatura", () => {
  it("substitui só as duas RPCs da tela Vendas, com a mesma assinatura e retorno", () => {
    const [lista, fila] = funcoes(up);
    expect(funcoes(up)).toHaveLength(2);
    const assinatura =
      "(_page integer default 0, _page_size integer default 10, _status text default null::text, _statuses text[] default null::text[], _desde date default null::date, _ate date default null::date, _q text default null::text, _corretor_ids uuid[] default null::uuid[]) returns jsonb";
    expect(lista).toContain(
      `create or replace function public.list_vendas_comerciais_paginadas${assinatura}`,
    );
    expect(fila).toContain(
      `create or replace function public.list_vendas_comerciais_paginadas_fila${assinatura}`,
    );
    // sem DML, sem DROP, sem mudança de ACL
    expect(norm(up)).not.toMatch(/\b(insert|update|delete|drop|grant|revoke|alter)\b/);
  });

  it("venda padrão usa o último contrato_assinado em São Paulo antes do fallback", () => {
    for (const f of funcoes(up)) {
      expect(f).toContain(
        "select h.sale_id, (max(h.created_at) at time zone 'america/sao_paulo')::date as data_assinatura from public.sale_status_history h where h.para::text = 'contrato_assinado' group by h.sale_id",
      );
      expect(f).toMatch(
        /coalesce\( ?u\.data_assinatura, a\.data_assinatura, s\.data_assinatura, \(s\.created_at at time zone 'america\/sao_paulo'\)::date ?\)/,
      );
      expect(f).toContain("left join ultimas_assinaturas u on u.sale_id = s.id");
      // Lançamento não muda
      expect(f).toMatch(
        /when s\.modalidade::text = 'lancamento' then coalesce\( ?s\.data_assinatura, \(s\.created_at at time zone 'america\/sao_paulo'\)::date ?\)/,
      );
    }
  });

  it("rollback literal restaura a regra anterior (max de occurrences.data_assinatura primeiro)", () => {
    const [lista, fila] = funcoes(down);
    expect(funcoes(down)).toHaveLength(2);
    for (const f of [lista, fila]) {
      expect(f).not.toContain("ultimas_assinaturas");
      expect(f).toMatch(/coalesce\( ?a\.data_assinatura, s\.data_assinatura,/);
    }
    // Fora do trecho da data, up e rollback são idênticos (nada mais foi alterado)
    const semData = (f: string) =>
      f
        .replace(/, ultimas_assinaturas as \(.*?group by h\.sale_id \)/, "")
        .replace("u.data_assinatura, ", "")
        .replace(" left join ultimas_assinaturas u on u.sale_id = s.id", "");
    expect(funcoes(up).map(semData)).toEqual([lista, fila]);
  });
});

describe("tela Vendas — rótulo da 2ª linha", () => {
  it("deixa claro que não segue o filtro de status e que o VGV exclui parceiros", () => {
    expect(tela).toContain("(todos os status; não segue o filtro de status)");
    expect(tela).toContain("de VGV atribuído à REMAX (sem a parte de parceiros)");
    expect(tela).toContain("no total (sem canceladas)");
  });
});
