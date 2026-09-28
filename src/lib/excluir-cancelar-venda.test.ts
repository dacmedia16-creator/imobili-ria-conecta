import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AppRole } from "@/lib/auth";
import { canDeleteSale } from "@/lib/permissions";
import { podeCancelarVenda } from "@/lib/sale-permissions";
import type { SaleStatus } from "@/lib/status";

// Regra de Denis (28/09/2026): excluir só em rascunho (criador, líder da equipe, admin, super_admin);
// cancelar só depois do rascunho e só o dono da plataforma.

const CRIADOR = "criador";
const MEMBRO_EQUIPE = CRIADOR;
const hasAnyDe = (roles: AppRole[]) => (want: AppRole[]) => want.some((r) => roles.includes(r));

const ETAPAS: SaleStatus[] = [
  "rascunho",
  "enviada_revisao",
  "devolvida_ajuste",
  "aprovada_gestor",
  "em_elaboracao_contrato",
  "contrato_conferencia_gestor",
  "contrato_conferencia_corretor",
  "contrato_ok_corretor",
  "aguardando_assinatura",
  "contrato_assinado",
  "ocorrencia_pendente",
  "ocorrencia_analise_financeiro",
  "ocorrencia_devolvida_gestor",
  "ocorrencia_concluida",
];

type Perfil = { nome: string; userId: string; roles: AppRole[]; equipe: Set<string> };
const PERFIS: Record<string, Perfil> = {
  criador: { nome: "criador (corretor)", userId: CRIADOR, roles: ["corretor"], equipe: new Set() },
  gestorEquipe: {
    nome: "gestor da equipe",
    userId: "g",
    roles: ["gestor"],
    equipe: new Set([MEMBRO_EQUIPE]),
  },
  tlEquipe: {
    nome: "team leader da equipe",
    userId: "tl",
    roles: ["team_leader"],
    equipe: new Set([MEMBRO_EQUIPE]),
  },
  admin: { nome: "admin", userId: "ad", roles: ["admin"], equipe: new Set() },
  superAdmin: { nome: "super_admin", userId: "sa", roles: ["super_admin"], equipe: new Set() },
  gestorOutra: {
    nome: "gestor de outra equipe",
    userId: "g2",
    roles: ["gestor"],
    equipe: new Set(["x"]),
  },
  participante: {
    nome: "participante que não criou",
    userId: "p",
    roles: ["corretor"],
    equipe: new Set(),
  },
  financeiro: { nome: "financeiro", userId: "f", roles: ["financeiro"], equipe: new Set() },
  juridico: { nome: "jurídico", userId: "j", roles: ["juridico"], equipe: new Set() },
  staff: { nome: "staff", userId: "s", roles: ["staff"], equipe: new Set() },
};
const PODEM_EXCLUIR = ["criador", "gestorEquipe", "tlEquipe", "admin", "superAdmin"];

describe("excluir venda: perfil × etapa", () => {
  for (const [chave, p] of Object.entries(PERFIS)) {
    for (const status of ETAPAS) {
      const esperado = status === "rascunho" && PODEM_EXCLUIR.includes(chave);
      it(`${p.nome} em ${status}: ${esperado ? "exclui" : "NÃO exclui"}`, () => {
        const sale = { id: "v", corretor_id: CRIADOR, status };
        expect(canDeleteSale(p.userId, hasAnyDe(p.roles), sale, p.equipe)).toBe(esperado);
      });
    }
  }
  it("sem usuário ou sem status conhecido: não exclui", () => {
    expect(
      canDeleteSale(
        null,
        hasAnyDe(["admin"]),
        { id: "v", corretor_id: CRIADOR, status: "rascunho" },
        new Set(),
      ),
    ).toBe(false);
    expect(
      canDeleteSale("ad", hasAnyDe(["admin"]), { id: "v", corretor_id: CRIADOR }, new Set()),
    ).toBe(false);
  });
});

describe("cancelar venda: só o dono da plataforma, depois do rascunho", () => {
  for (const status of ETAPAS) {
    const esperado = status !== "rascunho";
    it(`dono da plataforma em ${status}: ${esperado ? "cancela" : "NÃO cancela"}`, () => {
      expect(podeCancelarVenda(true, status)).toBe(esperado);
    });
    it(`qualquer outro perfil (admin, super_admin, gestor, team leader...) em ${status}: NÃO cancela`, () => {
      expect(podeCancelarVenda(false, status)).toBe(false);
    });
  }
  it("venda já cancelada ou arquivada não mostra o botão", () => {
    expect(podeCancelarVenda(true, "cancelada")).toBe(false);
    expect(podeCancelarVenda(true, "arquivada")).toBe(false);
  });
});

describe("migration 20260929090000_excluir_cancelar_venda", () => {
  const up = readFileSync(
    new URL("../../supabase/migrations/20260929090000_excluir_cancelar_venda.sql", import.meta.url),
    "utf8",
  );
  const down = readFileSync(
    new URL(
      "../../docs/sql/rollback/20260929090000_excluir_cancelar_venda.rollback.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const policy = up.slice(
    up.indexOf("CREATE POLICY delete_sales_por_papel"),
    up.indexOf("-- Cancelar:"),
  );

  it("excluir: só rascunho; sem financeiro; admin/super_admin, criador e líder da equipe", () => {
    expect(policy).toContain("status = 'rascunho'::public.sale_status");
    expect(policy).not.toContain("devolvida_ajuste");
    expect(policy).not.toContain("financeiro");
    expect(policy).toContain("ARRAY['super_admin','admin']");
    expect(policy).toContain("corretor_id = (SELECT auth.uid())");
    expect(policy).toContain("public.is_lead_of((SELECT auth.uid()), corretor_id)");
  });
  it("cancelar: checado antes do atalho de admin/super_admin, só dono da plataforma e fora do rascunho", () => {
    const iCancel = up.indexOf("if to_status = 'cancelada' then");
    const iAdmin = up.indexOf(
      "if public.has_any_role(actor, array['admin','super_admin']::app_role[]) then return new; end if;",
    );
    expect(iCancel).toBeGreaterThan(0);
    expect(iAdmin).toBeGreaterThan(iCancel);
    expect(up).toContain("public.is_platform_super_admin(actor)");
    expect(up).toContain("if from_status = 'rascunho' then");
  });
  it("platform_admins com o mesmo esquema da fase 1a e sem acesso direto de anon/authenticated", () => {
    expect(up).toContain("user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(up).toContain("REVOKE ALL ON public.platform_admins FROM PUBLIC, anon, authenticated");
    expect(up).toContain(
      "REVOKE ALL ON FUNCTION public.is_platform_super_admin(uuid) FROM PUBLIC, anon",
    );
  });
  it("não altera dados de vendas nem outras funções", () => {
    expect(up).not.toMatch(/\b(update public\.|delete from|insert into|truncate)\b/i);
    const replaced = [...up.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)/g)].map((m) => m[1]);
    expect(replaced).toEqual(["public.validate_sale_status_transition"]);
  });
  it("rollback literal restaura a policy e o trigger implantados e remove o que foi criado", () => {
    expect(down).toContain("'devolvida_ajuste'::sale_status, 'enviada_revisao'::sale_status");
    expect(down).toContain("'financeiro'::app_role");
    expect(down).not.toContain("is_platform_super_admin(actor)");
    expect(down).toContain("DROP FUNCTION public.is_platform_super_admin(uuid);");
    expect(down).toContain("DROP TABLE public.platform_admins;");
  });
});
