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

  it("Administrador e Administrador principal fazem as etapas de gestor e de jurídico (t_3c10bab8)", () => {
    const principal = getSaleRoleFlags(["super_admin"], [], undefined);
    const admin = getSaleRoleFlags(["admin"], [], undefined);
    expect(principal.cobreGestorEJuridico).toBe(true);
    expect(admin.cobreGestorEJuridico).toBe(true);
    expect(REGRAS_AUSENCIA.join(" ")).toMatch(
      /o Administrador ou o Administrador principal faz sozinho as etapas de gestor/,
    );
    expect(REGRAS_AUSENCIA.join(" ")).not.toMatch(/não substitui o gestor/);
  });

  it("página do Administrador: os ❌ da venda viraram ✅ (aprovar, contrato, cancelar, registrar)", () => {
    const admin = REGRAS_PAPEIS.find((r) => r.papel === "admin")!;
    const principal = REGRAS_PAPEIS.find((r) => r.papel === "super_admin")!;
    const regras = (p: typeof admin, lado: "pode" | "naoPode") =>
      AREAS.flatMap((a) => p.areas[a.id][lado].map((i) => i.regra)).filter(Boolean);
    for (const regra of ["etapas_gestor", "etapas_juridico", "cancelar_venda", "registrar_venda"]) {
      expect(regras(admin, "pode"), regra).toContain(regra);
      expect(regras(admin, "naoPode"), regra).not.toContain(regra);
      expect(regras(principal, "pode"), regra).toContain(regra);
    }
    // O cancelamento descreve confirmação, motivo e histórico.
    expect(admin.areas.aprovacao.pode.map((i) => i.texto).join(" ")).toMatch(
      /motivo obrigatório.*histórico quem cancelou, quando e o motivo/,
    );
  });

  it("outros papéis continuam sem cancelar; só a plataforma concede Administrador principal", () => {
    for (const r of ALL_MANAGED_ROLES) expect(grantableRoles([r])).not.toContain("super_admin");
    expect(grantableRoles([], { isPlatformAdmin: true })).toContain("super_admin");
    expect(SO_PLATAFORMA.join(" ")).toMatch(/Dá ou tira o papel "Administrador principal"/);
    expect(podeCancelarVenda(false, "enviada_revisao")).toBe(false);
    expect(podeCancelarVenda(true, "enviada_revisao")).toBe(true);
    expect(podeCancelarVenda(true, "rascunho")).toBe(false);
    expect(SO_PLATAFORMA.join(" ")).toMatch(/Cancela venda/);
    for (const r of [
      "corretor",
      "gestor",
      "team_leader",
      "juridico",
      "financeiro",
      "lancamento",
      "staff",
    ])
      expect(REGRAS_CONFERIDAS.cancelar_venda(r as ManagedRole), r).toBe(false);
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

  it("aviso de assunto sensível: Administrador principal também (igual à migration t_a7be646a)", () => {
    const mig = ler("../../supabase/migrations/20261027100000_aviso_sensivel_admin_principal.sql");
    expect(mig).toMatch(/_motivo = 'sensivel' AND r\.role::text = 'super_admin'/);
    expect(mig).toMatch(/SELECT DISTINCT r\.user_id/);
    const leadsDe = (p: ManagedRole) =>
      REGRAS_PAPEIS.find((r) => r.papel === p)!
        .areas.leads.pode.map((i) => i.texto)
        .join(" ");
    for (const p of ["super_admin", "admin", "gestor"] as ManagedRole[])
      expect(leadsDe(p), p).toMatch(/assunto sensível/);
    for (const p of ["corretor", "team_leader"] as ManagedRole[])
      expect(leadsDe(p), p).not.toMatch(/assunto sensível/);
    expect(ATENDENTE_IA.join(" ")).toMatch(/Administrador principal também/);
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
