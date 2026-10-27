import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  ATENDENTE_IA,
  AREAS,
  REGRAS_AUSENCIA,
  REGRAS_CONFERIDAS,
  REGRAS_OBRIGATORIAS,
  REGRAS_PAPEIS,
  SO_PLATAFORMA,
  menuComum,
  menuDoPapel,
  podeVerRegrasPapeis,
  type RegraId,
} from "./regras-papeis";
import { ALL_MANAGED_ROLES, grantableRoles, type ManagedRole } from "./user-management-policy";
import { getSaleRoleFlags, podeCancelarVenda } from "./sale-permissions";
import type { AppRole } from "./auth";

// A tela "Regras de papéis" (t_37becd0c) só descreve. Estes testes falham se o texto divergir das
// funções de permissão reais — quem mudar uma permissão precisa atualizar src/lib/regras-papeis.ts.

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("Regras de papéis — cobertura", () => {
  it("descreve exatamente os papéis atribuíveis pela imobiliária, sem o Coordenador", () => {
    const papeis = REGRAS_PAPEIS.map((r) => r.papel);
    expect(new Set(papeis).size).toBe(papeis.length);
    expect([...papeis].sort()).toEqual([...ALL_MANAGED_ROLES].sort());
    expect(papeis).not.toContain("coordenador" as ManagedRole);
  });

  it("todo papel tem resumo de uma frase e algo escrito em cada área", () => {
    for (const r of REGRAS_PAPEIS) {
      expect(r.resumo.length, r.papel).toBeGreaterThan(20);
      expect(r.resumo.length, r.papel).toBeLessThan(240);
      for (const a of AREAS) {
        const d = r.areas[a.id];
        expect(d.pode.length + d.naoPode.length, `${r.papel}/${a.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("todo papel responde às regras principais (em 'pode' ou em 'não pode')", () => {
    for (const r of REGRAS_PAPEIS) {
      const citadas = new Set(
        AREAS.flatMap((a) => [...r.areas[a.id].pode, ...r.areas[a.id].naoPode])
          .map((i) => i.regra)
          .filter(Boolean),
      );
      for (const regra of REGRAS_OBRIGATORIAS)
        expect(citadas.has(regra), `${r.papel}: ${regra}`).toBe(true);
    }
  });
});

describe("Regras de papéis — texto igual às permissões reais", () => {
  it("cada frase ligada a uma regra está no lado certo (pode / não pode)", () => {
    const divergencias: string[] = [];
    for (const r of REGRAS_PAPEIS) {
      for (const a of AREAS) {
        const d = r.areas[a.id];
        const conferir = (lado: "pode" | "naoPode") => {
          for (const item of d[lado]) {
            if (!item.regra) continue;
            const real = REGRAS_CONFERIDAS[item.regra as RegraId](r.papel);
            if (real !== (lado === "pode"))
              divergencias.push(`${r.papel}/${a.id}/${item.regra}: tela=${lado} sistema=${real}`);
          }
        };
        conferir("pode");
        conferir("naoPode");
      }
    }
    expect(divergencias).toEqual([]);
  });

  it("Administrador principal faz as etapas de gestor e de jurídico; o Administrador não", () => {
    const principal = getSaleRoleFlags(["super_admin"], [], undefined);
    const admin = getSaleRoleFlags(["admin"], [], undefined);
    expect(principal.isAdminPrincipal).toBe(true);
    expect(admin.isAdminPrincipal || admin.isGestor || admin.isJuridico).toBe(false);
    expect(REGRAS_AUSENCIA.join(" ")).toMatch(
      /Administrador principal faz sozinho as etapas de gestor/,
    );
  });

  it('só a plataforma concede "Administrador principal" e cancela venda', () => {
    for (const r of ALL_MANAGED_ROLES) expect(grantableRoles([r])).not.toContain("super_admin");
    expect(grantableRoles([], { isPlatformAdmin: true })).toContain("super_admin");
    expect(SO_PLATAFORMA.join(" ")).toMatch(/Dá ou tira o papel "Administrador principal"/);
    expect(podeCancelarVenda(false, "enviada_revisao")).toBe(false);
    expect(podeCancelarVenda(true, "enviada_revisao")).toBe(true);
    expect(podeCancelarVenda(true, "rascunho")).toBe(false);
    expect(SO_PLATAFORMA.join(" ")).toMatch(/Cancela venda/);
  });

  it("menu: Usuários só para admin, administrador principal, gestor e team leader", () => {
    for (const r of ALL_MANAGED_ROLES) {
      const temUsuarios = menuDoPapel(r).includes("Usuários");
      expect(temUsuarios, r).toBe(["admin", "super_admin", "gestor", "team_leader"].includes(r));
    }
    expect(menuComum()).toEqual(
      expect.arrayContaining([
        "Início",
        "Vendas",
        "Notificações",
        "Meu acesso",
        "Wiki MAX (guias)",
      ]),
    );
  });

  it("bloco da atendente de IA cita o aceite antes de ver a conversa", () => {
    expect(ATENDENTE_IA.join(" ")).toMatch(/depois de aceitar/);
  });
});

describe("Regras de papéis — acesso e só leitura", () => {
  it("só administradores (da imobiliária ou da plataforma no contexto) veem a tela", () => {
    const todos: AppRole[] = [...(ALL_MANAGED_ROLES as AppRole[])];
    for (const r of todos)
      expect(podeVerRegrasPapeis([r]), r).toBe(r === "admin" || r === "super_admin");
  });

  it("a rota usa a mesma regra no beforeLoad e não grava nada", () => {
    const rota = ler("../routes/_authenticated/admin.regras-papeis.tsx");
    expect(rota).toContain("requireRoles(context.auth, podeVerRegrasPapeis)");
    expect(rota).not.toMatch(/supabase|\.rpc\(|useServerFn|fetch\(/);
  });

  it("o botão em Usuários e perfis segue a mesma regra", () => {
    const usuarios = ler("../routes/_authenticated/admin.usuarios.tsx");
    expect(usuarios).toContain("podeVerRegrasPapeis(myRoles) && (");
    expect(usuarios).toContain('<Link to="/admin/regras-papeis">');
  });
});
