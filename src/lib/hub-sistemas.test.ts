import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getSession = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: () => getSession() } },
}));

import { aplicarSistemasLigados, sistemasLigados, type SistemaModulo } from "./hub-sistemas";

const SESSENTA = "https://conta/login?app=sessenta-dias-max";
const CARDS = [
  { id: "adm", href: "https://conta/login?app=adm-max" },
  { id: "estudo", href: "https://conta/login?app=estudo-mercado-max" },
  { id: "academia", href: "https://conta/login?app=academia-max" },
  { id: "60dias" },
  { id: "recruta" },
  { id: "locacao" },
  { id: "visita", href: "https://conta/login?app=visita-max" },
  { id: "especialistas", href: "/especialistas" },
  { id: "obah", href: "https://simulador.obahcredito.com.br/" },
];
const ids = (r: { id: string }[]) => r.map((c) => c.id);
const set = (...m: SistemaModulo[]) => new Set<SistemaModulo>(m);

const href = (r: { id: string; href?: string }[], id: string) => r.find((c) => c.id === id)?.href;

describe('Hub: sistema desligado fica "Em breve" sem link, nunca some (t_5ea3c841)', () => {
  it("todos ligados (plataforma ou Única): os 9 cartões, 60 Dias ganha link", () => {
    const r = aplicarSistemasLigados(
      CARDS,
      set("visita", "estudo", "academia", "sessenta"),
      SESSENTA,
    );
    expect(ids(r)).toEqual(ids(CARDS));
    expect(r.find((c) => c.id === "60dias")?.href).toBe(SESSENTA);
    expect(r.find((c) => c.id === "academia")?.href).toBe(CARDS[2].href);
  });

  it('só Visita e Estudo (RE/MAX sem Academia/60 Dias): Academia e 60 Dias ficam "Em breve" sem link, o resto igual', () => {
    const r = aplicarSistemasLigados(CARDS, set("visita", "estudo"), SESSENTA);
    expect(ids(r)).toEqual(ids(CARDS));
    expect(href(r, "academia")).toBeUndefined();
    expect(href(r, "60dias")).toBeUndefined();
    expect(href(r, "visita")).toBe(CARDS[6].href);
    expect(href(r, "estudo")).toBe(CARDS[1].href);
  });

  it("60 Dias desligado (caso da Única): o cartão continua, sem link; os outros 3 com link", () => {
    const r = aplicarSistemasLigados(CARDS, set("visita", "estudo", "academia"), SESSENTA);
    expect(ids(r)).toEqual(ids(CARDS));
    expect(href(r, "60dias")).toBeUndefined();
    expect(href(r, "academia")).toBe(CARDS[2].href);
  });

  it("Visita desligado: o cartão do Visita continua, sem link; nenhum cartão some", () => {
    const r = aplicarSistemasLigados(CARDS, set("estudo", "academia", "sessenta"), SESSENTA);
    expect(ids(r)).toEqual(ids(CARDS));
    expect(href(r, "visita")).toBeUndefined();
    expect(href(r, "60dias")).toBe(SESSENTA);
  });

  it("nada ligado (sem imobiliária ativa): os 4 sistemas ficam sem link; ADM, Especialistas, Obah e Em breve não mudam", () => {
    const r = aplicarSistemasLigados(CARDS, set(), SESSENTA);
    expect(ids(r)).toEqual(ids(CARDS));
    for (const id of ["visita", "estudo", "academia", "60dias"])
      expect(href(r, id)).toBeUndefined();
    for (const c of CARDS.filter((c) => !["visita", "estudo", "academia", "60dias"].includes(c.id)))
      expect(href(r, c.id)).toBe(c.href);
    expect(CARDS[6].href).toBeDefined(); // não altera a lista original
  });

  it("padrão seguro (null = sem login/erro): nenhum cartão some; igual a antes da etapa 1", () => {
    const r = aplicarSistemasLigados(CARDS, null, SESSENTA);
    expect(ids(r)).toEqual(ids(CARDS));
    expect(r.find((c) => c.id === "academia")?.href).toBeUndefined(); // "Em breve", como hoje sem login/erro
    expect(r.find((c) => c.id === "60dias")?.href).toBeUndefined();
    expect(r.find((c) => c.id === "visita")?.href).toBe(CARDS[6].href);
    expect(r.find((c) => c.id === "estudo")?.href).toBe(CARDS[1].href);
    expect(CARDS[2].href).toBeDefined(); // não altera a lista original
  });
});

describe("sistemasLigados(): leitura da chave", () => {
  beforeEach(() => {
    rpc.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ data: { session: { access_token: "x" } } });
  });

  it("lista da RPC vira conjunto; valores desconhecidos são ignorados", async () => {
    rpc.mockResolvedValueOnce({ data: ["estudo", "visita", "crm"], error: null });
    expect([...((await sistemasLigados()) ?? [])].sort()).toEqual(["estudo", "visita"]);
    expect(rpc).toHaveBeenCalledWith("sistemas_ligados");
  });

  it("lista vazia é resposta válida (não é erro)", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await sistemasLigados())?.size).toBe(0);
  });

  it("falha na leitura = null (padrão seguro): erro da RPC, exceção, resposta que não é lista", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } });
    expect(await sistemasLigados()).toBeNull();
    rpc.mockRejectedValueOnce(new Error("rede"));
    expect(await sistemasLigados()).toBeNull();
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await sistemasLigados()).toBeNull();
  });

  it("sem login = null, sem chamar a RPC", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await sistemasLigados()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("migration 20261105160000", () => {
  const sql = readFileSync("supabase/migrations/20261105160000_hub_sistemas_ligados.sql", "utf8");
  it("só leitura, plataforma vê os 4, fotógrafo sem Academia, sem acesso anon", () => {
    expect(sql).toMatch(/STABLE SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO ''/);
    expect(sql).toMatch(
      /is_platform_super_admin\(auth\.uid\(\)\) THEN ARRAY\['visita', 'estudo', 'academia', 'sessenta'\]/,
    );
    expect(sql).toMatch(/current_org_id\(\)/);
    expect(sql).toMatch(/eh_so_fotografo/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.sistemas_ligados\(\) FROM PUBLIC, anon/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER TABLE|DROP)\b/);
  });
});
