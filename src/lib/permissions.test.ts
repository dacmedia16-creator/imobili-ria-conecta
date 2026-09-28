import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { canDeleteSale } from "./permissions";
import type { AppRole } from "@/lib/auth";

// Decisão de Denis (28/09/2026): excluir venda SOMENTE em rascunho, por quem pode editá-la;
// nas demais etapas, só cancelar. O banco (policy delete_sales_por_papel, fase 2e) é a fonte da
// verdade; a tela só esconde o botão de quem seria recusado.
const DONO = "dono";
const OUTRO = "outro";
const as = (roles: AppRole[]) => (want: AppRole[]) => want.some((r) => roles.includes(r));
const venda = (status?: string) => ({ id: "v1", corretor_id: DONO, status });
const equipe = new Set([DONO]);

describe("canDeleteSale — só rascunho", () => {
  it("rascunho: dono, líder da equipe, financeiro, admin e super_admin veem Excluir", () => {
    expect(canDeleteSale(DONO, as(["corretor"]), venda("rascunho"), new Set())).toBe(true);
    expect(canDeleteSale(OUTRO, as(["gestor"]), venda("rascunho"), equipe)).toBe(true);
    expect(canDeleteSale(OUTRO, as(["team_leader"]), venda("rascunho"), equipe)).toBe(true);
    for (const r of ["financeiro", "admin", "super_admin"] as AppRole[])
      expect(canDeleteSale(OUTRO, as([r]), venda("rascunho"), new Set())).toBe(true);
  });

  it("rascunho: líder de outra equipe, staff e jurídico não veem Excluir", () => {
    expect(canDeleteSale(OUTRO, as(["gestor"]), venda("rascunho"), new Set())).toBe(false);
    expect(canDeleteSale(OUTRO, as(["team_leader"]), venda("rascunho"), new Set())).toBe(false);
    expect(canDeleteSale(OUTRO, as(["staff"]), venda("rascunho"), new Set())).toBe(false);
    expect(canDeleteSale(OUTRO, as(["juridico"]), venda("rascunho"), new Set())).toBe(false);
  });

  it.each(["devolvida_ajuste", "enviada_revisao", "aprovada_gestor", "ocorrencia_concluida"])(
    "%s: ninguém vê Excluir (só Cancelar)",
    (status) => {
      expect(canDeleteSale(DONO, as(["corretor"]), venda(status), new Set())).toBe(false);
      expect(canDeleteSale(OUTRO, as(["gestor"]), venda(status), equipe)).toBe(false);
      for (const r of ["financeiro", "admin", "super_admin"] as AppRole[])
        expect(canDeleteSale(OUTRO, as([r]), venda(status), new Set())).toBe(false);
    },
  );

  it("status desconhecido ou sem usuário: falha fechada", () => {
    expect(canDeleteSale(DONO, as(["admin"]), venda(undefined), new Set())).toBe(false);
    expect(canDeleteSale(null, as(["admin"]), venda("rascunho"), new Set())).toBe(false);
  });

  it("listas e detalhe da venda carregam o status usado pela regra", () => {
    const lista = readFileSync(
      new URL("../routes/_authenticated/vendas.index.tsx", import.meta.url),
      "utf8",
    );
    expect(lista).toMatch(/\|\s*"status"/);
  });
});

describe("reserva de sala — texto da tela alinhado (team leader = gestor)", () => {
  const tela = readFileSync(
    new URL("../routes/_authenticated/reservas-salas.tsx", import.meta.url),
    "utf8",
  );
  it("não promete mais escopo só da equipe para líderes", () => {
    expect(tela).not.toContain("líderes podem cancelar a própria equipe");
    expect(tela).not.toContain("líderes, a própria equipe");
    expect(tela).toContain("team leaders");
  });
});
