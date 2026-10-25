import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contarPorEtapa,
  ETAPAS,
  filtrarLeads,
  FILTRO_VAZIO,
  mensagemErroLead,
  ORIGENS,
  PAPEIS_ATENDIMENTO,
  podeAtenderLeads,
  podeVerPainelLeads,
  proximasEtapas,
  resumoPainel,
  SEM_RESPONSAVEL,
  textoEvento,
  validarNovoLead,
  type Lead,
  type NovoLeadForm,
} from "./leads";
import { montarMenuLateral, itensVisiveis } from "./menu-lateral";
import { ORGANIZATION_MODULES } from "./platform-organizations";

const MIG = readFileSync("supabase/migrations/20261025120000_leads_piloto.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261025120000_leads_piloto.rollback.sql", "utf8");

const lead = (p: Partial<Lead>): Lead => ({
  id: "l",
  nome: "Cliente",
  telefone: null,
  email: null,
  origem: "manual",
  mensagem: null,
  etapa: "novo",
  etapa_em: "2026-10-25T00:00:00Z",
  responsavel_id: null,
  atribuido_em: null,
  capture_id: null,
  captador_id: null,
  motivo_perda_id: null,
  motivo_perda_obs: null,
  created_at: "2026-10-25T00:00:00Z",
  updated_at: "2026-10-25T00:00:00Z",
  ...p,
});

const listaSql = (re: RegExp) =>
  [...(MIG.match(re)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe("leads: contrato tela x banco", () => {
  it("etapas e origens da tela são as mesmas das CHECKs da migration", () => {
    expect(listaSql(/etapa IN \(([^)]+)\)\),\n {2}etapa_em/)).toEqual([...ETAPAS]);
    expect(listaSql(/origem text NOT NULL CHECK \(origem IN \(([^)]+)\)\)/)).toEqual([...ORIGENS]);
  });

  it("papéis de atendimento iguais aos de lead_pode_ser_responsavel", () => {
    expect(listaSql(/r\.role::text IN \(([^)]+)\)/)).toEqual(PAPEIS_ATENDIMENTO);
  });

  it("módulo leads na lista do sistema, na CHECK e na RPC da plataforma; nasce desligado", () => {
    expect(ORGANIZATION_MODULES).toContain("leads");
    expect(MIG).toMatch(/'ranking_valores', 'leads'\)\);/);
    expect(MIG).toMatch(/SELECT o\.id, 'leads', false FROM public\.organizations o/);
  });

  it("tabelas novas com organization_id NOT NULL, RLS e trava do módulo", () => {
    for (const t of ["leads", "lead_eventos", "lead_motivos_perda", "lead_config"]) {
      expect(MIG).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(MIG).toContain(`CREATE POLICY org_isolation ON public.${t} AS RESTRICTIVE`);
      expect(MIG).toContain(`CREATE POLICY zz_mt_modulo_leads ON public.${t} AS RESTRICTIVE`);
    }
    expect(MIG).toMatch(
      /organization_id uuid NOT NULL REFERENCES public\.organizations\(id\),\n {2}nome text NOT NULL/,
    );
    // authenticated só lê; escrita só por RPC
    expect(MIG).toMatch(/GRANT SELECT ON public\.leads, public\.lead_eventos/);
    expect(MIG).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*TO authenticated/);
  });

  it("toda função nova é SECURITY DEFINER com search_path vazio", () => {
    const fns = [...MIG.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([^]*?AS \$\$/g)];
    expect(fns.length).toBeGreaterThan(10);
    for (const f of fns) expect(f[0], f[1]).toMatch(/SECURITY DEFINER SET search_path TO ''/);
  });

  it("nenhum envio de mensagem/rede na migration", () => {
    expect(MIG).not.toMatch(/net\.http|pg_net|ziontalk|whatsapp_send/i);
  });

  it("rollback desfaz cada tabela e função criada", () => {
    for (const t of ["leads", "lead_eventos", "lead_motivos_perda", "lead_config"])
      expect(RB).toContain(`DROP TABLE IF EXISTS public.${t};`);
    const criadas = [...MIG.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)]
      .map((m) => m[1])
      .filter((n) => n !== "platform_set_organization_module");
    for (const n of criadas)
      expect(RB, n).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${n}\\(`));
    expect(RB).toMatch(/'mural_conquistas', 'ranking_valores'\)\);/);
  });
});

describe("leads: regras de tela", () => {
  it("encerrado só reabre por gestor", () => {
    expect(proximasEtapas("ganho", false)).toEqual([]);
    expect(proximasEtapas("perdido", true)).toContain("novo");
    expect(proximasEtapas("novo", false)).not.toContain("novo");
  });

  it("filtros por etapa, responsável, sem dono e busca", () => {
    const ls = [
      lead({ id: "1", nome: "João Ávila", telefone: "15999990001", responsavel_id: "a" }),
      lead({
        id: "2",
        nome: "Maria",
        email: "m@x.invalid",
        etapa: "proposta",
        responsavel_id: "b",
      }),
      lead({ id: "3", nome: "Zé", telefone: "15999990003" }),
    ];
    expect(filtrarLeads(ls, { ...FILTRO_VAZIO, etapa: "proposta" }).map((l) => l.id)).toEqual([
      "2",
    ]);
    expect(filtrarLeads(ls, { ...FILTRO_VAZIO, responsavel: "a" }).map((l) => l.id)).toEqual(["1"]);
    expect(
      filtrarLeads(ls, { ...FILTRO_VAZIO, responsavel: SEM_RESPONSAVEL }).map((l) => l.id),
    ).toEqual(["3"]);
    expect(filtrarLeads(ls, { ...FILTRO_VAZIO, busca: "avila" }).map((l) => l.id)).toEqual(["1"]);
    expect(filtrarLeads(ls, { ...FILTRO_VAZIO, busca: "0003" }).map((l) => l.id)).toEqual(["3"]);
    expect(filtrarLeads(ls, { ...FILTRO_VAZIO, busca: "m@x" }).map((l) => l.id)).toEqual(["2"]);
  });

  it("resumo do painel", () => {
    const ls = [
      lead({ etapa: "ganho", responsavel_id: "a" }),
      lead({ etapa: "perdido", responsavel_id: "a" }),
      lead({ etapa: "perdido", responsavel_id: "a" }),
      lead({ etapa: "novo" }),
    ];
    expect(resumoPainel(ls)).toEqual({
      total: 4,
      semResponsavel: 1,
      abertos: 1,
      ganhos: 1,
      perdidos: 2,
      taxaGanho: 33,
    });
    expect(resumoPainel([]).taxaGanho).toBeNull();
    expect(contarPorEtapa(ls).perdido).toBe(2);
  });

  it("validação do novo lead", () => {
    const base: NovoLeadForm = {
      nome: "A",
      telefone: "",
      email: "",
      origem: "manual",
      mensagem: "",
      captureId: "",
      responsavelId: "",
    };
    expect(validarNovoLead(base)).toMatch(/telefone ou e-mail/);
    expect(validarNovoLead({ ...base, nome: " " })).toMatch(/nome/);
    expect(validarNovoLead({ ...base, telefone: "(15) 99999-0000" })).toBeNull();
    expect(validarNovoLead({ ...base, telefone: "123" })).toMatch(/Telefone/);
    expect(validarNovoLead({ ...base, email: "x@y" })).toMatch(/E-mail/);
  });

  it("linha do tempo e mensagens de erro em português", () => {
    const nome = (id: string | null) => (id === "a" ? "Ana" : "Bia");
    const ev = { id: "e", lead_id: "l", de: null, nota: null, autor_id: null, created_at: "" };
    expect(textoEvento({ ...ev, tipo: "etapa", de: "novo", para: "proposta" }, nome)).toBe(
      "Etapa: Novo → Proposta",
    );
    expect(textoEvento({ ...ev, tipo: "atribuido", para: "a" }, nome)).toBe("Responsável: Ana");
    expect(textoEvento({ ...ev, tipo: "atribuido", de: "a", para: "b" }, nome)).toMatch(
      /Ana → Bia/,
    );
    expect(mensagemErroLead("Modulo de leads desligado nesta imobiliaria")).toMatch(/desligado/);
    expect(mensagemErroLead("Informe o motivo da perda")).toMatch(/motivo/);
    expect(mensagemErroLead("xyz")).toMatch(/Tente de novo/);
  });
});

describe("leads: menu", () => {
  const ver = (roles: string[], leadsVisible?: boolean) =>
    itensVisiveis(
      montarMenuLateral({
        roles,
        platformAdmin: false,
        exclusiveVisible: false,
        roomVisible: false,
        feedbackVisible: false,
        leadsVisible,
      }),
    );

  it("módulo desligado ou ausente: nenhum item de leads para ninguém", () => {
    for (const r of ["corretor", "gestor", "admin", "super_admin", "team_leader", "financeiro"]) {
      expect(ver([r])).not.toContain("/meus-leads");
      expect(ver([r], false)).not.toContain("/painel-leads");
    }
  });

  it("módulo ligado: corretor vê Meus leads; painel só TL/gestor/admin", () => {
    expect(ver(["corretor"], true)).toContain("/meus-leads");
    expect(ver(["corretor"], true)).not.toContain("/painel-leads");
    for (const r of ["team_leader", "gestor", "admin", "super_admin"])
      expect(ver([r], true)).toContain("/painel-leads");
    expect(ver(["financeiro"], true)).not.toContain("/meus-leads");
    expect(podeAtenderLeads(["juridico"])).toBe(false);
    expect(podeVerPainelLeads(["corretor"])).toBe(false);
  });
});
