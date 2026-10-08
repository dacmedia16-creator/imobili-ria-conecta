import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const chamadas: { metodo: string; args: unknown[] }[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "is", "eq", "order"]) {
    builder[m] = (...args: unknown[]) => {
      chamadas.push({ metodo: m, args });
      return builder;
    };
  }
  builder.range = (...args: unknown[]) => {
    chamadas.push({ metodo: "range", args });
    return Promise.resolve({ data: [{ id: "a" }, { id: "b" }], error: null });
  };
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return { supabase: { from: () => builder, rpc } };
});

import { supabase } from "@/integrations/supabase/client";
import { MIDIA_OPTIONS } from "@/lib/status";
import { fetchVendasComerciaisPaginadas } from "@/lib/vendas-comerciais-query";
import {
  MIDIA_FILTER_OPTIONS,
  SEM_MIDIA_FILTER,
  fetchSaleIdsPorMidia,
  filtrarPorSaleIds,
  midiaFilterParam,
  midiaFilterValido,
} from "@/lib/vendas-midia-filtro";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const norm = (s: string) => s.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

describe("filtro de Mídia — opções e valores", () => {
  it("usa as opções de MIDIA_OPTIONS + 'Sem mídia'", () => {
    expect(MIDIA_FILTER_OPTIONS.slice(0, -1)).toEqual(MIDIA_OPTIONS);
    expect(MIDIA_FILTER_OPTIONS.at(-1)).toEqual({ key: SEM_MIDIA_FILTER, label: "Sem mídia" });
  });

  it("aceita só valores conhecidos vindos da URL ou do armazenamento", () => {
    expect(midiaFilterValido("todas")).toBe(true);
    expect(midiaFilterValido("Instagram")).toBe(true);
    expect(midiaFilterValido(SEM_MIDIA_FILTER)).toBe(true);
    expect(midiaFilterValido("Qualquer")).toBe(false);
    expect(midiaFilterValido(null)).toBe(false);
    expect(midiaFilterValido(undefined)).toBe(false);
  });

  it("'todas' não envia filtro; demais valores vão como estão", () => {
    expect(midiaFilterParam("todas")).toBeUndefined();
    expect(midiaFilterParam("Placa")).toBe("Placa");
    expect(midiaFilterParam(SEM_MIDIA_FILTER)).toBe(SEM_MIDIA_FILTER);
  });

  it("filtrarPorSaleIds restringe só quando há filtro", () => {
    const rows = [{ saleId: "a" }, { saleId: "b" }, { saleId: "c" }];
    expect(filtrarPorSaleIds(rows, null)).toBe(rows);
    expect(filtrarPorSaleIds(rows, new Set(["b"]))).toEqual([{ saleId: "b" }]);
  });
});

describe("filtro de Mídia — consultas", () => {
  it("RPC recebe _midia só quando há filtro (sem filtro, chamada igual à de hoje)", async () => {
    const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
    await fetchVendasComerciaisPaginadas({ page: 0, pageSize: 10 });
    expect(rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty("_midia");
    await fetchVendasComerciaisPaginadas({ page: 0, pageSize: 10, midia: "Portal" });
    expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({ _midia: "Portal" });
    await fetchVendasComerciaisPaginadas({
      page: 0,
      pageSize: 10,
      soMinhaVez: true,
      midia: "Placa",
    });
    expect(rpc.mock.calls.at(-1)?.[0]).toBe("list_vendas_comerciais_paginadas_fila");
    expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({ _midia: "Placa" });
  });

  it("IDs por mídia: 'todas' não consulta; 'Sem mídia' usa IS NULL; mídia usa igualdade", async () => {
    chamadas.length = 0;
    expect(await fetchSaleIdsPorMidia("todas")).toBeNull();
    expect(chamadas).toHaveLength(0);
    expect(await fetchSaleIdsPorMidia(SEM_MIDIA_FILTER)).toEqual(new Set(["a", "b"]));
    expect(chamadas.find((c) => c.metodo === "is")?.args).toEqual(["midia", null]);
    chamadas.length = 0;
    await fetchSaleIdsPorMidia("Instagram");
    expect(chamadas.find((c) => c.metodo === "eq")?.args).toEqual(["midia", "Instagram"]);
  });
});

describe("migration 20261008140000 — filtro de Mídia nas RPCs da tela Vendas", () => {
  const up = ler("supabase/migrations/20261008140000_filtro_midia_lista_vendas.sql");
  const down = ler("docs/sql/rollback/20261008140000_filtro_midia_lista_vendas.rollback.sql");

  it("as duas RPCs ganham _midia com padrão NULL e o filtro antes da paginação", () => {
    const sql = norm(up);
    for (const nome of [
      "list_vendas_comerciais_paginadas",
      "list_vendas_comerciais_paginadas_fila",
    ]) {
      expect(sql).toContain(
        `create or replace function public.${nome}(_page integer default 0, _page_size integer default 10, _status text default null::text, _statuses text[] default null::text[], _desde date default null::date, _ate date default null::date, _q text default null::text, _corretor_ids uuid[] default null::uuid[], _midia text default null::text)`,
      );
    }
    expect(sql.match(/_midia = '__sem_midia__' and s\.midia is null/g)).toHaveLength(2);
    expect(sql.match(/or s\.midia = _midia/g)).toHaveLength(2);
    // continua security invoker e sem DML
    expect(sql).not.toContain("security definer");
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/);
  });

  it("não deixa duas versões da RPC e mantém a mesma ACL (sem anon)", () => {
    const sql = norm(up);
    expect(sql).toContain(
      "drop function if exists public.list_vendas_comerciais_paginadas(integer, integer, text, text[], date, date, text, uuid[])",
    );
    expect(sql).toContain(
      "drop function if exists public.list_vendas_comerciais_paginadas_fila(integer, integer, text, text[], date, date, text, uuid[])",
    );
    expect(sql).toContain(
      "revoke all on function public.list_vendas_comerciais_paginadas(integer, integer, text, text[], date, date, text, uuid[], text) from public, anon",
    );
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\banon\b/);
  });

  it("rollback volta às assinaturas antigas, sem _midia", () => {
    const sql = norm(down);
    expect(sql).not.toContain("_midia text");
    expect(sql).toContain(
      "drop function if exists public.list_vendas_comerciais_paginadas(integer, integer, text, text[], date, date, text, uuid[], text)",
    );
    expect(sql).toContain(
      "grant execute on function public.list_vendas_comerciais_paginadas(integer, integer, text, text[], date, date, text, uuid[]) to authenticated, service_role",
    );
  });

  it("tela Vendas liga o filtro à consulta, à URL e ao cartão de efetivadas", () => {
    const tela = ler("src/routes/_authenticated/vendas.index.tsx");
    expect(tela).toContain('aria-label="Mídia"');
    expect(tela).toContain("filters.midia = midiaFilterParam(midiaFilter)");
    expect(tela).toContain('params.set("midia", midiaFilter)');
    expect(tela).toContain("fetchSaleIdsPorMidia(midiaFilter)");
  });
});
