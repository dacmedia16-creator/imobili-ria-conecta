import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// t_b855dbb8 (Denis 24/11): "o CRM tem que ser individual". Salvador (gestor) via no Funil de Venda
// os leads da Lilian e da Andreia, porque o CRM lia a tabela leads só pela RLS (gestor/admin veem a
// imobiliária inteira — regra do painel Leads). Dublê do banco com a mesma visão da RLS de um gestor:
// devolve TODOS os leads da imobiliária e respeita o filtro .eq() que a tela pedir.
const GESTOR = "u-gestor";
const LILIAN = "u-lilian";
const ANDREIA = "u-andreia";
const LEADS = [
  { id: "l1", nome: "Lead do gestor", responsavel_id: GESTOR },
  { id: "l2", nome: "Lead da Lilian", responsavel_id: LILIAN },
  { id: "l3", nome: "Lead da Andreia", responsavel_id: ANDREIA },
  { id: "l4", nome: "Lead no banco", responsavel_id: null },
];
const filtros: [string, unknown][] = [];

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const eqs: [string, unknown][] = [];
    const q = {
      select: () => q,
      order: () => q,
      eq: (col: string, v: unknown) => {
        eqs.push([col, v]);
        filtros.push([col, v]);
        return q;
      },
      limit: async () => ({
        data: LEADS.filter((l) => eqs.every(([c, v]) => (l as Record<string, unknown>)[c] === v)),
        error: null,
      }),
    };
    return q;
  };
  return {
    supabase: {
      from: () => consulta(),
      rpc: async () => ({ data: [], error: null }),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

import { listarLeadsCrm } from "./crm-db";

beforeEach(() => {
  filtros.length = 0;
});

describe("CRM individual (t_b855dbb8)", () => {
  it("gestor vê no CRM só os leads em que é o responsável, mesmo que a RLS libere a imobiliária", async () => {
    const leads = await listarLeadsCrm(GESTOR);
    expect(leads.map((l) => l.nome)).toEqual(["Lead do gestor"]);
    expect(filtros).toContainEqual(["responsavel_id", GESTOR]);
  });

  it("sem usuário logado não lista nada (não cai na visão ampla da RLS)", async () => {
    expect(await listarLeadsCrm(undefined)).toEqual([]);
    expect(await listarLeadsCrm("")).toEqual([]);
  });

  it("tela do CRM: passa o usuário logado, não tem aba 'Visão do gestor' nem dono no cartão", () => {
    const tela = readFileSync("src/components/crm/CrmPagina.tsx", "utf8");
    expect(tela).toMatch(/const meuId = user\?\.id;/);
    expect(tela).toMatch(/listarLeadsCrm\(meuId\)/);
    expect(tela).not.toMatch(/Visão do gestor/);
    expect(tela).not.toMatch(/mostrarDono=\{veEquipe\}/);
  });
});

describe("painel Leads por equipe (t_b855dbb8, Denis 24/11)", () => {
  const mig = readFileSync("supabase/migrations/20270103120000_leads_gestor_ve_equipe.sql", "utf8");
  const rb = readFileSync(
    "docs/sql/rollback/20270103120000_leads_gestor_ve_equipe.rollback.sql",
    "utf8",
  );
  const policy = mig.slice(mig.indexOf("CREATE POLICY leads_read"));

  it("só admin/super_admin veem a imobiliária inteira; gestor deixa de ver tudo", () => {
    expect(mig).toMatch(/FUNCTION public\.leads_admin\(\)[\s\S]*'admin'[\s\S]*'super_admin'/);
    expect(policy.slice(0, 400)).toMatch(/USING \(\(SELECT public\.leads_admin\(\)\)/);
    // gestor só entra para lead SEM responsável (distribuir) — nunca a imobiliária inteira
    expect(policy.slice(0, 400)).toMatch(
      /responsavel_id IS NULL AND \(SELECT public\.leads_gestor\(\)\)/,
    );
  });

  it("gestor vê a equipe pelo mesmo vínculo do Team Leader", () => {
    expect(mig).toMatch(
      /has_role\(auth\.uid\(\), 'team_leader'::public\.app_role\)\s*OR public\.has_role\(auth\.uid\(\), 'gestor'::public\.app_role\)\)\s*AND public\.leads_team_or_parent/,
    );
  });

  it("RPCs que liam o lead pela regra antiga usam a regra nova", () => {
    for (const fn of ["lead_contatos", "lead_ia_pode_ver", "lead_pega", "proposta_criar"])
      expect(mig).toMatch(new RegExp(`FUNCTION public\\.${fn}\\(`));
    expect(mig.match(/leads_ve_responsavel\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.leads_ve_responsavel/);
  });
});
