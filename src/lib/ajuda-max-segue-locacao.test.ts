// Ajuda MAX acompanha a Locação (t_8fd40b23; decisão de Denis em 11/11/2026).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MODULOS_LIGADOS_POR_PADRAO,
  ORGANIZATION_MODULE_LABELS,
  ORGANIZATION_MODULES,
  moduloLigado,
} from "@/lib/platform-organizations";
import { INVITE_MODULES_OFF } from "@/lib/org-invites";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIG = ler("../../supabase/migrations/20261118120000_ajuda_max_segue_locacao.sql");
const RB = ler("../../supabase/rollback/20261118120000_ajuda_max_segue_locacao.sql");
const MIG_ORIGINAL = ler("../../supabase/migrations/20261116120000_ajuda_max_locacao.sql");
const SERVER = ler("./platform-organizations.server.ts");
const TELA = ler("../routes/_authenticated/plataforma.imobiliarias.tsx");

const corpoFuncao = (sql: string) => {
  const i = sql.indexOf("CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_enabled()");
  return sql.slice(i, sql.indexOf("$$;", i) + 3);
};

const A = "org-a";
const NOVA = "org-nova";

describe("tela Módulos: o Ajuda MAX nasce ligado e a linha só desliga", () => {
  it("Locação ligada e sem linha do Ajuda MAX → interruptor ligado", () => {
    const rows = [{ organization_id: A, module: "locacao", enabled: true }];
    expect(moduloLigado(rows, A, "ajuda_max_locacao")).toBe(true);
  });
  it("linha enabled=false → desligado", () => {
    const rows = [
      { organization_id: A, module: "locacao", enabled: true },
      { organization_id: A, module: "ajuda_max_locacao", enabled: false },
    ];
    expect(moduloLigado(rows, A, "ajuda_max_locacao")).toBe(false);
  });
  it("linha enabled=true (Conferência hoje) continua ligado", () => {
    const rows = [{ organization_id: A, module: "ajuda_max_locacao", enabled: true }];
    expect(moduloLigado(rows, A, "ajuda_max_locacao")).toBe(true);
  });
  it("linha de OUTRA imobiliária não afeta esta", () => {
    const rows = [{ organization_id: "org-b", module: "ajuda_max_locacao", enabled: false }];
    expect(moduloLigado(rows, A, "ajuda_max_locacao")).toBe(true);
  });
  it("os demais módulos continuam desligados sem linha (nada muda fora do Ajuda MAX)", () => {
    expect(MODULOS_LIGADOS_POR_PADRAO).toEqual(["ajuda_max_locacao"]);
    for (const m of ORGANIZATION_MODULES.filter((x) => x !== "ajuda_max_locacao"))
      expect(moduloLigado([], A, m)).toBe(false);
    expect(moduloLigado([], A, "locacao")).toBe(false);
  });
  it("imobiliária nova: convite não grava a linha; balão só vem com a Locação (que nasce desligada)", () => {
    expect(INVITE_MODULES_OFF).toContain("ajuda_max_locacao");
    expect(INVITE_MODULES_OFF).toContain("locacao");
    expect(moduloLigado([], NOVA, "ajuda_max_locacao")).toBe(true);
    expect(moduloLigado([], NOVA, "locacao")).toBe(false);
    // Depois que a plataforma liga a Locação, nenhum passo extra é necessário.
    const depois = [{ organization_id: NOVA, module: "locacao", enabled: true }];
    expect(moduloLigado(depois, NOVA, "locacao")).toBe(true);
    expect(moduloLigado(depois, NOVA, "ajuda_max_locacao")).toBe(true);
  });
  it("lista da tela usa a mesma regra e o rótulo explica o padrão", () => {
    expect(SERVER).toMatch(/moduloLigado\(moduleRows, id, m\)/);
    expect(ORGANIZATION_MODULE_LABELS.ajuda_max_locacao).toMatch(/acompanha a Locação/);
    expect(TELA).toMatch(/aparece quando a Locação for ligada/);
  });
});

describe("migration 20261118120000", () => {
  it("muda só ajuda_max_locacao_enabled: Locação E nenhuma linha enabled=false", () => {
    const f = corpoFuncao(MIG);
    expect(f).toMatch(/public\.locacao_enabled\(\) AND NOT EXISTS/);
    expect(f).toMatch(/m\.organization_id = public\.current_org_id\(\)/);
    expect(f).toMatch(/m\.module = 'ajuda_max_locacao' AND NOT m\.enabled/);
    expect(f).toMatch(/coalesce\(/); // falha fechada: NULL vira false
    expect(f).toMatch(/SECURITY DEFINER SET search_path TO ''/);
    const criadas = [...MIG.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_.]+)/g)].map((x) => x[1]);
    expect(criadas).toEqual(["public.ajuda_max_locacao_enabled"]);
    expect(MIG).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b\s+(INTO|public\.|FROM)/i);
    expect(MIG).not.toMatch(/organization_modules_module_check|platform_set_organization_module/);
  });
  it("grants iguais aos de antes (sem anon)", () => {
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.ajuda_max_locacao_enabled\(\) FROM PUBLIC, anon;/,
    );
    expect(MIG).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ajuda_max_locacao_enabled\(\) TO authenticated, service_role;/,
    );
  });
  it("rollback devolve exatamente o corpo da 20261116120000 e não apaga linhas", () => {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(norm(corpoFuncao(RB))).toBe(norm(corpoFuncao(MIG_ORIGINAL)));
    expect(RB).not.toMatch(/\bDELETE\b|\bDROP\b/);
  });
});
