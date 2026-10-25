import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aguardandoMeuAceite,
  CONFIG_PADRAO,
  duracaoTxt,
  mensagemErroLead,
  pareceRobo,
  prazoDoLead,
  textoEvento,
  textoPrazo,
  validarConfig,
  validarFormPublico,
  FORM_TEMPO_MINIMO_MS,
  FORM_TOKEN_RE,
  type Lead,
  type LeadEvento,
} from "./leads";

// Card t_9a8dccc7 (P2 entrada + P3 distribuição). As regras reais estão no banco e foram testadas em
// PostgreSQL descartável; aqui ficam a lógica de tela e travas do texto da migration.
const MIG = readFileSync("supabase/migrations/20261025150000_leads_p2p3_distribuicao.sql", "utf8");
const RB = readFileSync(
  "docs/sql/rollback/20261025150000_leads_p2p3_distribuicao.rollback.sql",
  "utf8",
);

const H = 3_600_000;
const D = 24 * H;
const agora = new Date("2026-10-25T12:00:00Z");
const iso = (ms: number) => new Date(agora.getTime() + ms).toISOString();

const lead = (p: Partial<Lead>): Lead => ({
  id: "l",
  nome: "Cliente",
  telefone: null,
  email: "a@b.co",
  origem: "manual",
  mensagem: null,
  etapa: "novo",
  etapa_em: iso(0),
  responsavel_id: "c1",
  atribuido_em: iso(0),
  capture_id: null,
  captador_id: null,
  motivo_perda_id: null,
  motivo_perda_obs: null,
  created_at: iso(0),
  updated_at: iso(0),
  aceito_em: null,
  ultima_interacao_em: null,
  no_banco_desde: null,
  simulado: false,
  contato_liberado: true,
  ...p,
});

describe("prazos do lead (24 h / 7 d / 30 d)", () => {
  const c = CONFIG_PADRAO;
  it("sem aceite: prazo de aceite de 24 h a partir da atribuição", () => {
    const p = prazoDoLead(lead({ atribuido_em: iso(-23 * H) }), c, agora);
    expect(p.tipo).toBe("aceite");
    expect(textoPrazo(p)).toBe("Aceitar em 1 h");
    expect(textoPrazo(prazoDoLead(lead({ atribuido_em: iso(-25 * H) }), c, agora))).toBe(
      "Aceitar vencido",
    );
  });
  it("aceito sem interação: 7 dias para a 1ª", () => {
    const p = prazoDoLead(lead({ aceito_em: iso(-2 * D) }), c, agora);
    expect(p.tipo).toBe("primeira_interacao");
    expect(textoPrazo(p)).toBe("1ª interação em 5 dias");
  });
  it("com interação: 30 dias desde a última", () => {
    const p = prazoDoLead(
      lead({ aceito_em: iso(-40 * D), ultima_interacao_em: iso(-10 * D) }),
      c,
      agora,
    );
    expect(p.tipo).toBe("sem_interacao");
    expect(textoPrazo(p)).toBe("Próxima interação em 20 dias");
  });
  it("ganho/perdido não contam prazo; banco e sem dono não mostram contagem", () => {
    expect(prazoDoLead(lead({ etapa: "ganho", atribuido_em: iso(-90 * D) }), c, agora).tipo).toBe(
      "encerrado",
    );
    expect(textoPrazo(prazoDoLead(lead({ etapa: "perdido" }), c, agora))).toBeNull();
    expect(
      textoPrazo(prazoDoLead(lead({ responsavel_id: null, no_banco_desde: iso(0) }), c, agora)),
    ).toBe("No banco da imobiliária");
    expect(textoPrazo(prazoDoLead(lead({ responsavel_id: null }), c, agora))).toBeNull();
  });
  it("prazos configuráveis", () => {
    const p = prazoDoLead(
      lead({ aceito_em: iso(-2 * D) }),
      { ...c, prazo_primeira_interacao_dias: 3 },
      agora,
    );
    expect(textoPrazo(p)).toBe("1ª interação em 24 h");
  });
  it("duracaoTxt", () => {
    expect(duracaoTxt(1440 * 60_000)).toBe("24 h");
    expect(duracaoTxt(30 * 60_000)).toBe("30 min");
    expect(duracaoTxt(7 * D)).toBe("7 dias");
  });
});

describe("aceite", () => {
  it("só o responsável, sem aceite e com lead aberto", () => {
    expect(aguardandoMeuAceite(lead({}), "c1")).toBe(true);
    expect(aguardandoMeuAceite(lead({}), "c2")).toBe(false);
    expect(aguardandoMeuAceite(lead({ aceito_em: iso(0) }), "c1")).toBe(false);
    expect(aguardandoMeuAceite(lead({ etapa: "ganho" }), "c1")).toBe(false);
    expect(aguardandoMeuAceite(lead({}), undefined)).toBe(false);
  });
});

describe("configuração", () => {
  it("limites iguais aos CHECKs do banco", () => {
    expect(validarConfig(CONFIG_PADRAO)).toBeNull();
    expect(validarConfig({ ...CONFIG_PADRAO, prazo_aceite_min: 1441 })).toMatch(/aceite/);
    expect(validarConfig({ ...CONFIG_PADRAO, prazo_primeira_interacao_dias: 0 })).toMatch(/1ª/);
    expect(validarConfig({ ...CONFIG_PADRAO, prazo_sem_interacao_dias: 366 })).toMatch(
      /sem interação/,
    );
    expect(MIG).toMatch(/prazo_primeira_interacao_dias BETWEEN 1 AND 90/);
    expect(MIG).toMatch(/prazo_sem_interacao_dias BETWEEN 1 AND 365/);
  });
});

describe("formulário público (LGPD + anti-spam)", () => {
  const ok = {
    nome: "Ana",
    telefone: "15 99999-0000",
    email: "",
    mensagem: "",
    consentimento: true,
    site: "",
  };
  it("exige consentimento e contato", () => {
    expect(validarFormPublico(ok)).toBeNull();
    expect(validarFormPublico({ ...ok, consentimento: false })).toMatch(/LGPD/);
    expect(validarFormPublico({ ...ok, telefone: "" })).toMatch(/telefone ou e-mail/);
  });
  it("armadilha e tempo mínimo pegam robô", () => {
    expect(pareceRobo({ site: "" }, 0, FORM_TEMPO_MINIMO_MS + 1)).toBe(false);
    expect(pareceRobo({ site: "http://spam" }, 0, 60_000)).toBe(true);
    expect(pareceRobo({ site: "" }, 0, 500)).toBe(true);
  });
  it("token do link tem o formato do banco", () => {
    expect(FORM_TOKEN_RE.test("a".repeat(32))).toBe(true);
    expect(FORM_TOKEN_RE.test("curto")).toBe(false);
    expect(MIG).toMatch(/form_token ~ '\^\[A-Za-z0-9_-\]\{32,64\}\$'/);
  });
  it("só o servidor chama o banco; IP só em hash", () => {
    expect(MIG).toMatch(
      /lead_form_enviar\(text, text, text, text, text, uuid, text, text\)\s+TO service_role/,
    );
    expect(MIG).toMatch(
      /FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.lead_form_info/,
    );
    expect(MIG).toMatch(/ip_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  });
});

describe("linha do tempo e mensagens", () => {
  const ev = (p: Partial<LeadEvento>): LeadEvento => ({
    id: "e",
    lead_id: "l",
    tipo: "nota",
    de: null,
    para: null,
    nota: null,
    autor_id: null,
    created_at: iso(0),
    ...p,
  });
  const nome = (id: string | null) => (id ? `N:${id}` : "—");
  it("eventos novos", () => {
    expect(textoEvento(ev({ tipo: "aceite", para: "c1" }), nome)).toBe("Lead aceito por N:c1");
    expect(textoEvento(ev({ tipo: "ligacao" }), nome)).toBe("Ligação registrada");
    expect(textoEvento(ev({ tipo: "devolvido_banco" }), nome)).toMatch(/banco/);
    expect(textoEvento(ev({ tipo: "redistribuido", de: "banco", para: "c2" }), nome)).toBe(
      "Saiu do banco para N:c2",
    );
    expect(textoEvento(ev({ tipo: "redistribuido", de: "c1", para: "c2" }), nome)).toBe(
      "Passado de N:c1 para N:c2",
    );
  });
  it("erros do banco em português", () => {
    expect(mensagemErroLead("Aceite o lead antes de atender")).toMatch(/Aceite o lead/);
    expect(mensagemErroLead("Lead nao esta mais no banco")).toMatch(/já pegou/);
    expect(mensagemErroLead("Apenas administrador altera a configuracao")).toMatch(/administrador/);
  });
});

describe("migration P2/P3", () => {
  it("tarefa agendada a cada 5 min e idempotente (SKIP LOCKED)", () => {
    expect(MIG).toMatch(/cron\.schedule\('leads-prazos', '\*\/5 \* \* \* \*'/);
    expect(MIG).toMatch(/FOR UPDATE OF l SKIP LOCKED/);
    expect(MIG).toMatch(/m\.module = 'leads' AND m\.enabled/);
  });
  it("tarefa e peças internas fora do alcance do app", () => {
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.leads_processar_prazos\(\) FROM PUBLIC, anon, authenticated/,
    );
    expect(MIG).toMatch(
      /public\.lead_distribuir\(uuid, uuid, text, uuid\),[\s\S]*?FROM PUBLIC, anon, authenticated/,
    );
  });
  it("avisos só no sino; nenhum envio externo", () => {
    expect(MIG).toMatch(/INSERT INTO public\.notifications/);
    expect(MIG).not.toMatch(/net\.http_post|ziontalk|send-email/i);
  });
  it("ganho/perdido fora do processamento", () => {
    expect(MIG).toMatch(
      /WHERE l\.etapa NOT IN \('ganho', 'perdido'\) AND l\.no_banco_desde IS NULL/,
    );
  });
  it("rollback desfaz o que a migration cria e mantém os leads do P1", () => {
    for (const f of [
      "leads_processar_prazos",
      "lead_distribuir",
      "lead_pegar",
      "lead_simular",
      "lead_form_enviar",
    ])
      expect(RB).toContain(`DROP FUNCTION IF EXISTS public.${f}(`);
    expect(RB).toMatch(/cron\.unschedule/);
    expect(RB).toMatch(/DROP TABLE IF EXISTS public\.lead_form_tentativas/);
    expect(RB).not.toMatch(/DROP TABLE IF EXISTS public\.leads;/);
    expect(RB).toMatch(/CHECK \(tipo IN \('criado', 'etapa', 'atribuido', 'nota', 'vinculo'\)\)/);
  });
});
