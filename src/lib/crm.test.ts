import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  estadoProximo,
  filaDoDia,
  FUNIL,
  mensagemErroCrm,
  pedidoAoMover,
  resumoGestor,
  somarDias,
  validarProximo,
} from "./crm";
import { montarMenuLateral } from "./menu-lateral";
import type { Lead } from "./leads";

// Card t_188fb282. As regras reais (RLS, aceite, próximo contato) estão no banco e foram testadas em
// Postgres local (scripts/crm-test, 54 checagens). Aqui: lógica de tela e travas do texto da migration.
const MIG = readFileSync("supabase/migrations/20261029100000_crm_dois_funis.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261029100000_crm_dois_funis.rollback.sql", "utf8");

const HOJE = "2026-10-29";
let n = 0;
const lead = (p: Partial<Lead> = {}): Lead => ({
  id: `l${++n}`,
  nome: "Cliente",
  telefone: null,
  email: null,
  origem: "manual",
  mensagem: null,
  etapa: "em_atendimento",
  etapa_em: "2026-10-28T12:00:00Z",
  responsavel_id: "ana",
  atribuido_em: "2026-10-28T12:00:00Z",
  capture_id: null,
  captador_id: null,
  motivo_perda_id: null,
  motivo_perda_obs: null,
  created_at: "2026-10-28T12:00:00Z",
  updated_at: "2026-10-28T12:00:00Z",
  aceito_em: "2026-10-28T12:05:00Z",
  ultima_interacao_em: "2026-10-28T12:05:00Z",
  no_banco_desde: null,
  simulado: false,
  contato_liberado: true,
  funil: "venda",
  proximo_contato_em: null,
  proximo_contato_motivo: null,
  sale_id: null,
  capture_convertida_id: null,
  ...p,
});

describe("funis", () => {
  it("etapas e nomes aprovados na maquete", () => {
    expect(FUNIL.venda.etapas.map((e) => FUNIL.venda.label[e])).toEqual([
      "Novo",
      "Em contato",
      "Visita",
      "Proposta",
      "Fechado",
      "Perdido",
    ]);
    expect(FUNIL.captacao.etapas.map((e) => FUNIL.captacao.label[e])).toEqual([
      "Novo",
      "Em contato",
      "Avaliação",
      "Proposta de exclusividade",
      "Captado",
      "Perdido",
    ]);
  });
});

describe("próximo contato", () => {
  it("estado: sem, atrasado, hoje, ok, fim", () => {
    expect(estadoProximo(lead(), HOJE)).toBe("sem");
    expect(estadoProximo(lead({ proximo_contato_em: "2026-10-28" }), HOJE)).toBe("atrasado");
    expect(estadoProximo(lead({ proximo_contato_em: HOJE }), HOJE)).toBe("hoje");
    expect(estadoProximo(lead({ proximo_contato_em: "2026-11-02" }), HOJE)).toBe("ok");
    expect(estadoProximo(lead({ etapa: "ganho" }), HOJE)).toBe("fim");
  });
  it("validação igual à do banco", () => {
    expect(validarProximo("", "x", HOJE)).toMatch(/data e o motivo/);
    expect(validarProximo(HOJE, "  ", HOJE)).toMatch(/data e o motivo/);
    expect(validarProximo("2026-10-28", "ligar", HOJE)).toMatch(/passado/);
    expect(validarProximo(somarDias(HOJE, 367), "ligar", HOJE)).toMatch(/1 ano/);
    expect(validarProximo(HOJE, "x".repeat(201), HOJE)).toMatch(/200/);
    expect(validarProximo(somarDias(HOJE, 1), "ligar", HOJE)).toBeNull();
  });
});

describe("pedido ao soltar o cartão", () => {
  const o = { gestor: false, aguardandoAceite: false };
  it("etapa aberta pede próximo contato; perdido pede motivo; ganho pede fechar", () => {
    expect(pedidoAoMover(lead(), "proposta", o)).toBe("proximo");
    expect(pedidoAoMover(lead(), "perdido", o)).toBe("perda");
    expect(pedidoAoMover(lead(), "ganho", o)).toBe("fechar");
    expect(pedidoAoMover(lead(), "em_atendimento", o)).toBe("nada");
  });
  it("bloqueia etapa de outro funil, aguardando aceite e reabrir sem ser gestor", () => {
    expect(pedidoAoMover(lead(), "avaliacao", o)).toBe("bloqueado");
    expect(pedidoAoMover(lead({ funil: "captacao" }), "visita_agendada", o)).toBe("bloqueado");
    expect(pedidoAoMover(lead(), "proposta", { ...o, aguardandoAceite: true })).toBe("bloqueado");
    expect(pedidoAoMover(lead({ etapa: "perdido" }), "novo", o)).toBe("bloqueado");
    expect(pedidoAoMover(lead({ etapa: "perdido" }), "novo", { ...o, gestor: true })).toBe(
      "proximo",
    );
  });
});

describe("fila do dia", () => {
  it("ordem: aceite, atrasado, sem, hoje; só os meus; ignora ok e encerrados", () => {
    const ls = [
      lead({ nome: "hoje", proximo_contato_em: HOJE, proximo_contato_motivo: "x" }),
      lead({ nome: "ok", proximo_contato_em: "2026-11-05", proximo_contato_motivo: "x" }),
      lead({ nome: "sem" }),
      lead({ nome: "atrasado", proximo_contato_em: "2026-10-20", proximo_contato_motivo: "x" }),
      lead({ nome: "aceite", aceito_em: null }),
      lead({ nome: "outro", responsavel_id: "bia" }),
      lead({ nome: "fim", etapa: "ganho" }),
    ];
    expect(filaDoDia(ls, HOJE, "ana").map((i) => i.lead.nome)).toEqual([
      "aceite",
      "atrasado",
      "sem",
      "hoje",
    ]);
    expect(filaDoDia(ls, HOJE).map((i) => i.lead.nome)).toContain("outro");
  });
});

describe("visão do gestor", () => {
  it("conversão por corretor e por origem; parados", () => {
    const agora = new Date("2026-10-29T12:00:00Z");
    const ls = [
      lead({ responsavel_id: "ana", origem: "grupo_olx", sale_id: "s1", etapa: "ganho" }),
      lead({ responsavel_id: "ana", origem: "grupo_olx", proximo_contato_em: "2026-11-01", proximo_contato_motivo: "x" }),
      lead({
        responsavel_id: "bia",
        origem: "manual",
        funil: "captacao",
        capture_convertida_id: "c1",
        etapa: "ganho",
      }),
      lead({ responsavel_id: "bia", origem: "manual" }),
    ];
    const r = resumoGestor(ls, HOJE, (id) => (id === "ana" ? "Ana" : "Bia"), agora);
    expect(r.total).toBe(4);
    expect(r.convertidos).toBe(2);
    expect(r.pct).toBe(50);
    expect(r.porCorretor.find((x) => x.rotulo === "Ana")).toMatchObject({ leads: 2, venda: 1, pct: 50 });
    expect(r.porCorretor.find((x) => x.rotulo === "Bia")).toMatchObject({ captacao: 1 });
    expect(r.porOrigem.map((x) => x.chave).sort()).toEqual(["grupo_olx", "manual"]);
    expect(r.parados.map((p) => p.estado)).toEqual(["sem"]);
  });
});

describe("mensagens do banco", () => {
  it("traduz as recusas das RPCs crm_*", () => {
    expect(mensagemErroCrm("Informe a data e o motivo do proximo contato")).toMatch(/próximo contato/);
    expect(mensagemErroCrm("Captacao exclusiva desligada nesta imobiliaria")).toMatch(/desligada/);
    expect(mensagemErroCrm("Modulo CRM desligado nesta imobiliaria")).toMatch(/CRM está desligado/);
    expect(mensagemErroCrm("outra coisa")).toBeNull();
  });
});

describe("menu", () => {
  const base = {
    platformAdmin: false,
    exclusiveVisible: false,
    roomVisible: false,
    feedbackVisible: false,
  };
  const temCrm = (roles: string[], leadsVisible: boolean, crmVisible: boolean) =>
    montarMenuLateral({ ...base, roles, leadsVisible, crmVisible })
      .flatMap((g) => g.items)
      .some((i) => i.to === "/crm" && i.show);
  it("CRM só aparece com Leads e CRM ligados", () => {
    expect(temCrm(["corretor"], true, true)).toBe(true);
    expect(temCrm(["gestor"], true, true)).toBe(true);
    expect(temCrm(["corretor"], false, true)).toBe(false);
    expect(temCrm(["corretor"], true, false)).toBe(false);
  });
});

describe("migration e rollback (travas de texto)", () => {
  it("módulo nasce desligado e crm_enabled exige leads", () => {
    expect(MIG).toMatch(/SELECT o\.id, 'crm', false FROM public\.organizations/);
    expect(MIG).toMatch(/SELECT public\.leads_enabled\(\) AND/);
  });
  it("RPCs do CRM são SECURITY DEFINER com search_path vazio", () => {
    for (const f of ["crm_mover", "crm_proximo_contato", "crm_definir_funil", "crm_converter_venda", "crm_converter_captacao"]) {
      const bloco = MIG.split(`FUNCTION public.${f}(`)[1]?.slice(0, 400) ?? "";
      expect(bloco, f).toMatch(/SECURITY DEFINER SET search_path TO ''/);
    }
  });
  it("lead_mudar_etapa exige passar por crm_mover com o CRM ligado", () => {
    expect(MIG).toMatch(/current_setting\('app\.crm_mover', true\) IS DISTINCT FROM 'on'/);
  });
  it("rollback desfaz colunas, RPCs e o módulo", () => {
    expect(RB).toMatch(/DROP COLUMN IF EXISTS funil/);
    expect(RB).toMatch(/DROP FUNCTION IF EXISTS public\.crm_mover/);
    expect(RB).toMatch(/module = 'crm'/);
  });
});
