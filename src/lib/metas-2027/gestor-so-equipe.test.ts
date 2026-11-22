// @vitest-environment jsdom
/**
 * Gestor só na PRÓPRIA equipe (cartão t_82b66d41; Denis 22/11/2026, "3 sim / 4 sim").
 * Mesma regra do Painel da Equipe: admin/super_admin = imobiliária toda; gestor e TL = só a equipe que lideram.
 * - Metas 2027 · Equipes: gestor sem a opção "todas as equipes"; gestor sem equipe vê aviso claro (não painel zerado).
 * - Metas 2027 · Imobiliária: só admin/dono (menu, rota e tela).
 * - Banco (migrations 20261219120000/130000): a regra mora nas RPCs; aqui conferimos o texto das migrations e dos
 *   rollbacks (a prova com dados roda em supabase/tests/run-gestor-so-equipe-metas-pacto-1a1.sh).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { podeAcessarPainelImobiliaria } from "./acesso";
import { itensVisiveis, montarMenuLateral, type MenuContexto } from "@/lib/menu-lateral";

const rpc = vi.fn();
function cadeia() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "is", "or", "gte", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: null, error: null });
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => cadeia() },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "quem-ve" }, roles: ["gestor"] }) }));

import { PainelMetasGestor } from "@/components/metas-2027/PainelMetasGestor";

const REAL_VAZIO = { captacoes_ligadas: true, vendas: [], captacoes: [] };
function responder(planos: unknown) {
  rpc.mockImplementation((fn: string) => {
    if (fn === "metas_equipe_planos") return Promise.resolve({ data: planos, error: null });
    if (fn === "metas_equipe_realizado") return Promise.resolve({ data: REAL_VAZIO, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}
afterEach(() => {
  cleanup();
  rpc.mockReset();
});

describe("Metas 2027 · Equipes: gestor só com a própria equipe", () => {
  it("gestor com 2 equipes (o banco manda todas=false): aba 'Todas as minhas', nunca 'Todas'", async () => {
    responder({
      todas: false,
      modulo_plano: true,
      equipes: [
        { id: "g1", nome: "Equipe do Gestor", lider_id: "quem-ve", lider_nome: "Gestor" },
        { id: "g2", nome: "Equipe Filha", lider_id: null, lider_nome: null },
      ],
      pessoas: [
        { user_id: "a", nome: "Ana", team_id: "g1", papeis: ["corretor"], tem_plano: false },
        { user_id: "d", nome: "Duda", team_id: "g2", papeis: ["corretor"], tem_plano: false },
      ],
    });
    render(createElement(PainelMetasGestor));
    expect((await screen.findByTestId("escopo")).textContent).toMatch(
      /só a\(s\) equipe\(s\) que lidera/,
    );
    expect(screen.getByRole("tab", { name: "Todas as minhas" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Todas" })).toBeNull();
    expect(screen.queryByText(/todas as equipes da imobiliária/)).toBeNull();
  });

  it("gestor sem equipe (o banco manda lista vazia): aviso claro, sem painel zerado", async () => {
    responder({ todas: false, modulo_plano: true, equipes: [], pessoas: [] });
    render(createElement(PainelMetasGestor));
    expect((await screen.findByTestId("sem-equipe")).textContent).toMatch(
      /Você ainda não lidera nenhuma equipe/,
    );
    expect(screen.queryByTestId("grupo-total")).toBeNull();
  });
});

describe("Metas 2027 · Imobiliária e Minha imobiliária: só admin e dono", () => {
  const base: MenuContexto = {
    roles: [],
    platformAdmin: false,
    exclusiveVisible: true,
    roomVisible: true,
    feedbackVisible: true,
  } as MenuContexto;
  const menu = (roles: string[]) => itensVisiveis(montarMenuLateral({ ...base, roles }));

  it("acesso e menu: admin/super_admin sim; gestor, TL e corretor não", () => {
    expect(podeAcessarPainelImobiliaria(["admin"])).toBe(true);
    expect(podeAcessarPainelImobiliaria(["super_admin"])).toBe(true);
    expect(podeAcessarPainelImobiliaria(["gestor"])).toBe(false);
    expect(podeAcessarPainelImobiliaria(["team_leader"])).toBe(false);
    expect(podeAcessarPainelImobiliaria(["corretor"])).toBe(false);
    expect(menu(["admin"])).toContain("/painel-metas-imobiliaria");
    expect(menu(["gestor"])).not.toContain("/painel-metas-imobiliaria");
    expect(menu(["gestor"])).toContain("/painel-metas");
    expect(menu(["gestor"])).not.toContain("/minha-imobiliaria");
    expect(menu(["admin"])).toContain("/minha-imobiliaria");
  });
});

describe("banco: migrations e rollbacks (a prova com dados é a suíte SQL)", () => {
  const mig1 = readFileSync(
    "supabase/migrations/20261219120000_gestor_so_equipe_metas_pacto_1a1.sql",
    "utf8",
  );
  const mig2 = readFileSync(
    "supabase/migrations/20261219130000_metas_imobiliaria_so_admin.sql",
    "utf8",
  );
  const rb1 = readFileSync(
    "supabase/rollback/20261219120000_gestor_so_equipe_metas_pacto_1a1.sql",
    "utf8",
  );
  const corpo = (sql: string, fn: string) => {
    const i = sql.indexOf(`FUNCTION public.${fn}(`);
    expect(i).toBeGreaterThan(-1);
    return sql.slice(i, sql.indexOf("$function$;", i));
  };

  it("metas_equipe_broker sem gestor; metas_equipe_times põe o gestor no caminho do TL", () => {
    expect(corpo(mig1, "metas_equipe_broker")).not.toMatch(/'gestor'/);
    expect(corpo(mig1, "metas_equipe_times")).toMatch(/r\.role IN \('gestor', 'team_leader'\)/);
  });

  it("assinar, reabrir e Inteligência de gestão: visão ampla só com meu_plano_ve_imobiliaria (admin/dono)", () => {
    const assinar = corpo(mig1, "carreira_plano_assinar_broker");
    expect(assinar).toMatch(/meu_plano_ve_imobiliaria\(_me\)/);
    expect(assinar).toMatch(/meu_plano_lider_ve\(_corretor\)/);
    expect(corpo(mig1, "carreira_plano_reabrir")).toMatch(
      /_papel IN \('gestor', 'team_leader'\) AND NOT EXISTS/,
    );
    expect(corpo(mig1, "gestao_pode_ver")).toMatch(
      /IF public\.meu_plano_ve_imobiliaria\(_me\) THEN RETURN true/,
    );
    expect(corpo(mig1, "gestao_pode_ver")).not.toMatch(/meu_plano_eh_broker/);
    expect(corpo(mig1, "gestao_farol_dados")).toMatch(
      /_broker := public\.meu_plano_ve_imobiliaria\(_me\)/,
    );
  });

  it("Metas 2027 · Imobiliária: bruta e estoque só admin/super_admin", () => {
    for (const fn of ["metas_comissao_quebra", "metas_imobiliaria_estoque"]) {
      expect(corpo(mig2, fn)).toMatch(/metas_direcao_papel\(ARRAY\['admin', 'super_admin'\]/);
      // Só a checagem de permissão (a divisão da comissão por papel também cita 'gestor').
      expect(corpo(mig2, fn)).not.toMatch(/metas_direcao_papel\(ARRAY\[[^\]]*'gestor'/);
    }
  });

  it("rollback devolve a regra antiga (gestor com a imobiliária toda)", () => {
    expect(corpo(rb1, "gestao_pode_ver")).toMatch(
      /IF public\.meu_plano_eh_broker\(_me\) THEN RETURN true/,
    );
    expect(corpo(rb1, "metas_equipe_broker")).toMatch(/'gestor'/);
  });
});
