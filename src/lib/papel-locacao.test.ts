import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  destinoLocacao,
  ehSoLocacao,
  ENTRADA_LOCACAO,
  rotaPermitidaLocacao,
} from "./papel-locacao";
import { ROLE_LABEL } from "./auth";
import { ALL_MANAGED_ROLES, grantableRoles } from "./user-management-policy";

// Papel geral "Locação" (t_1fe07126). Denis 12/11/2026: o pessoal da locação vê só o que é da locação.
const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("ehSoLocacao", () => {
  it("só o papel locacao, sozinho", () => {
    expect(ehSoLocacao(["locacao"])).toBe(true);
    expect(ehSoLocacao(["locacao", "locacao"])).toBe(true);
  });
  it("Locação + Fotógrafo continua só-Locação (falha fechada, igual ao banco)", () => {
    expect(ehSoLocacao(["locacao", "fotografo"])).toBe(true);
    expect(ehSoLocacao(["fotografo"])).toBe(false);
  });
  it("com Corretor, Gestor ou outro papel deixa de ser só-Locação (vê tudo)", () => {
    for (const outro of [
      "corretor",
      "gestor",
      "team_leader",
      "admin",
      "super_admin",
      "financeiro",
      "staff",
    ])
      expect(ehSoLocacao(["locacao", outro]), outro).toBe(false);
    expect(ehSoLocacao(["corretor"])).toBe(false);
    expect(ehSoLocacao([])).toBe(false);
  });
});

describe("destinoLocacao (guarda de rota)", () => {
  it("acesso direto às telas bloqueadas volta ao Início", () => {
    for (const p of [
      "/vendas",
      "/vendas/nova",
      "/vendas/123",
      "/exclusividades",
      "/exclusividades/painel",
      "/mapa-captacoes",
      "/feedback",
      "/oportunidades",
      "/minha-carreira",
      "/minha-carreira/plano",
      "/vendas-por-regiao",
      "/ocorrencias-concluidas",
      "/ocorrencias-imprimir",
      "/producao-por-pessoa",
      "/visao-executiva",
      "/painel-equipe",
      "/financeiro",
      "/relatorios",
      "/comissoes-a-receber",
      "/agendar-fotos",
      "/fotografo",
      "/meus-leads",
      "/crm",
      "/propostas/1",
      "/admin/usuarios",
      "/equipe",
      "/",
    ])
      expect(destinoLocacao(["locacao"], p), p).toBe(ENTRADA_LOCACAO);
  });
  it("deixa abrir Início, Locação (lista, ficha e Sugestões e erros), salas, mural e a conta", () => {
    for (const p of [
      "/dashboard",
      "/locacoes",
      "/locacoes/",
      "/locacoes/abc",
      "/locacoes/sugestoes",
      "/reservas-salas",
      "/mural-conquistas",
      "/notificacoes",
      "/perfil",
      "/ajuda",
      "/ajuda/wiki",
    ])
      expect(destinoLocacao(["locacao"], p), p).toBeNull();
    expect(rotaPermitidaLocacao("/locacoesx")).toBe(false);
    expect(rotaPermitidaLocacao("/ajudante")).toBe(false);
  });
  it("não mexe em quem tem outro papel junto", () => {
    expect(destinoLocacao(["locacao", "corretor"], "/vendas")).toBeNull();
    expect(destinoLocacao(["locacao", "gestor"], "/vendas-por-regiao")).toBeNull();
    expect(destinoLocacao(["corretor"], "/vendas")).toBeNull();
    expect(destinoLocacao([], "/vendas")).toBeNull();
  });
  it("a guarda está ligada no layout das telas logadas", () => {
    const rota = ler("../routes/_authenticated/route.tsx");
    expect(rota).toMatch(/destinoLocacao\(access\.roles, location\.pathname\)/);
  });
});

describe("cadastro do papel Locação", () => {
  it("aparece na ficha do usuário com o rótulo Locação, ao lado de Fotógrafo", () => {
    expect(ROLE_LABEL.locacao).toBe("Locação");
    expect(ALL_MANAGED_ROLES).toContain("locacao");
    expect(ALL_MANAGED_ROLES.indexOf("locacao")).toBe(ALL_MANAGED_ROLES.indexOf("fotografo") + 1);
    for (const tela of ["admin.usuarios.tsx", "plataforma.usuarios.tsx"])
      expect(ler(`../routes/_authenticated/${tela}`), tela).toMatch(/"fotografo",\n\s+"locacao",/);
  });
  it("admin, administrador principal e plataforma concedem; gestor/TL não", () => {
    expect(grantableRoles(["admin"])).toContain("locacao");
    expect(grantableRoles(["super_admin"])).toContain("locacao");
    expect(grantableRoles([], { isPlatformAdmin: true })).toContain("locacao");
    expect(grantableRoles(["gestor"])).not.toContain("locacao");
    expect(grantableRoles(["team_leader"])).not.toContain("locacao");
  });
});

describe("banco: migration do papel Locação", () => {
  const mig = ler("../../supabase/migrations/20261122120100_papel_locacao.sql");
  it("tira o só-Locação de is_active_user e põe a barreira RESTRICTIVE nas tabelas", () => {
    expect(mig).toMatch(/IF public\.eh_so_locacao\(_user\) THEN RETURN false; END IF;/);
    expect(mig).toMatch(
      /CREATE POLICY zz_locacao_fora ON public\.%I AS RESTRICTIVE FOR ALL TO authenticated/,
    );
  });
  it("libera só a área da locação (módulo, salas, chamados e avisos)", () => {
    for (const fn of [
      "locacao_ctx",
      "locacao_criar",
      "list_room_occupancy",
      "support_ticket_create",
      "push_inscrever",
    ])
      expect(mig, fn).toMatch(new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?so_locacao_ativo`));
  });
  it("não mexe nos papéis internos da Locação (gestora/contratos/vistoria/financeiro)", () => {
    expect(mig).not.toMatch(
      /locacao_papeis_papel_check|locacao_papel_definir|locacao_tem_papel|locacao_pode_ver/,
    );
  });
  it("rollback restaura as 14 funções e apaga as 2 novas", () => {
    const rb = ler("../../docs/sql/rollback/20261122120100_papel_locacao.rollback.sql");
    expect((rb.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(14);
    expect(rb).toMatch(/DROP POLICY IF EXISTS zz_locacao_fora/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.eh_so_locacao\(uuid\)/);
    expect(rb).not.toMatch(/eh_so_locacao\(auth|so_locacao_ativo\(_/);
  });
});
