import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import { academiaEnabled, aplicarModuloAcademia } from "./academia-module";
import { ORGANIZATION_MODULES, ORGANIZATION_MODULE_LABELS } from "./platform-organizations";

const CARDS = [
  { id: "adm", href: "https://conta/login?app=adm-max" },
  { id: "academia", href: "https://conta/login?app=academia-max" },
  { id: "60dias" },
];

describe("módulo Academia no hub (t_e21b37b6)", () => {
  it("ligada: card da Academia mantém o link", () => {
    const r = aplicarModuloAcademia(CARDS, true);
    expect(r.find((c) => c.id === "academia")?.href).toContain("app=academia-max");
  });

  it("desligada: card continua aparecendo, mas sem link (Em breve); os outros não mudam", () => {
    const r = aplicarModuloAcademia(CARDS, false);
    expect(r).toHaveLength(3);
    expect(r.find((c) => c.id === "academia")?.href).toBeUndefined();
    expect(r.find((c) => c.id === "adm")?.href).toBe(CARDS[0].href);
    expect(CARDS[1].href).toBeDefined(); // não altera a lista original
  });

  it("academiaEnabled: só true quando a RPC devolve true; erro ou exceção = desligada", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await academiaEnabled()).toBe(true);
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await academiaEnabled()).toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await academiaEnabled()).toBe(false);
    rpc.mockRejectedValueOnce(new Error("rede"));
    expect(await academiaEnabled()).toBe(false);
    expect(rpc).toHaveBeenCalledWith("academia_enabled");
  });

  it("toggle em Plataforma › Imobiliárias com o label certo", () => {
    expect(ORGANIZATION_MODULES).toContain("academia");
    expect(ORGANIZATION_MODULE_LABELS.academia).toBe("Academia Única MAX");
  });

  it("migration: CHECK + lista da RPC + seed só na Única com ON CONFLICT DO NOTHING", () => {
    const sql = readFileSync("supabase/migrations/20261102150000_academia_modulo.sql", "utf8");
    expect(sql.match(/'academia'\)\)/g)?.length).toBe(1);
    expect(sql).toMatch(/_module NOT IN \([^)]*'academia'\)/);
    expect(sql).toMatch(/o\.slug = 'unica-escolha'/);
    expect(sql).toMatch(/ON CONFLICT \(organization_id, module\) DO NOTHING/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.academia_enabled\(\) FROM PUBLIC, anon/);
  });
});
