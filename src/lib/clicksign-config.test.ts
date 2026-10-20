// Tela "Assinatura digital" (t_7508c6b6) — só mock: nenhuma rede, nenhuma chave real, e-mails
// fictícios (example.com). Cobre a edge (core), as regras da tela e os papéis.
import { describe, expect, it, vi } from "vitest";
import {
  cleanSecret,
  connectionFailure,
  handleConfig,
  parseSave,
  type ConfigDeps,
} from "../../supabase/functions/clicksign-config/core.ts";
import { ClicksignError } from "../../supabase/functions/_shared/clicksign.ts";
import {
  auditoriaTexto,
  estaLigada,
  parseAllowlist,
  parseDeadline,
  podeLigar,
  requisitosParaLigar,
  type ClicksignConfig,
} from "./clicksign-config";
import { montarMenuLateral, itensVisiveis } from "./menu-lateral";

const ORG_A = "00000000-0000-4000-8000-000000000001";
const SIGNER = "33333333-3333-4333-8333-333333333333";
const FAKE_TOKEN = "chave-ficticia-de-teste-0001";
const SLUG = "a".repeat(36);

const baseView = () => ({
  enabled: false,
  sale_enabled: false,
  test_mode: true,
  allowlist_count: 0,
  deadline_days: 30,
  signer_ids: [] as string[],
  valid_signers: 0,
  token: { configured: false, set_at: null },
  webhook: { configured: false, set_at: null, slug: SLUG },
  connection: { ok: null, checked_at: null },
  candidates: [],
  audit: [],
});

/** Deps falsas: o "banco" é um objeto em memória; o fetch falso registra cada chamada. */
function deps(over: Partial<ConfigDeps> = {}, fetchStatus = 200) {
  const state = { view: baseView(), secrets: {} as Record<string, string>, tests: [] as unknown[] };
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    return new Response(
      JSON.stringify(fetchStatus < 300 ? { data: [] } : { errors: [{ detail: "x" }] }),
      {
        status: fetchStatus,
      },
    );
  });
  const d: ConfigDeps = {
    actorId: "u1",
    fetch,
    authorize: vi.fn(async () => ORG_A),
    view: vi.fn(async () => state.view as unknown as Record<string, unknown>),
    storeSecret: vi.fn(async (_o, kind, value) => {
      state.secrets[kind] = value;
      if (kind === "access_token")
        state.view.token = { configured: true, set_at: "2026-10-19T22:00:00Z" } as never;
    }),
    save: vi.fn(async () => {}),
    token: vi.fn(async () => state.secrets.access_token ?? null),
    recordTest: vi.fn(async (_o, ok, code) => {
      state.tests.push({ ok, code });
    }),
    setEnabled: vi.fn(async () => {}),
    webhookUrl: (s) => `https://projeto.example.com/functions/v1/clicksign-webhook/${s}`,
    ...over,
  };
  return { d, state, calls, fetch };
}

describe("clicksign-config (edge) — papéis e isolamento", () => {
  it("quem não é super_admin recebe 403 e nada é lido nem gravado", async () => {
    for (const action of ["view", "save_secret", "save", "test", "set_enabled"]) {
      const { d, fetch } = deps({
        authorize: vi.fn(async () => Promise.reject(new Error("42501"))),
      });
      const res = await handleConfig(d, {
        action,
        kind: "access_token",
        value: FAKE_TOKEN,
        on: true,
        test_mode: false,
      });
      expect(res.status).toBe(403);
      expect(d.view).not.toHaveBeenCalled();
      expect(d.storeSecret).not.toHaveBeenCalled();
      expect(d.save).not.toHaveBeenCalled();
      expect(d.setEnabled).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("a org vem do authorize, nunca do corpo (organization_id no corpo é ignorado)", async () => {
    const { d } = deps();
    await handleConfig(d, {
      action: "set_enabled",
      on: false,
      organization_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(d.setEnabled).toHaveBeenCalledWith(ORG_A, false);
  });

  it("ação desconhecida → 400 antes de autorizar", async () => {
    const { d } = deps();
    expect((await handleConfig(d, { action: "apagar_tudo" })).status).toBe(400);
    expect(d.authorize).not.toHaveBeenCalled();
  });
});

describe("clicksign-config (edge) — chave nunca volta", () => {
  it("salvar a chave devolve só 'configurada' e a data", async () => {
    const { d } = deps();
    const res = await handleConfig(d, {
      action: "save_secret",
      kind: "access_token",
      value: `  ${FAKE_TOKEN}  `,
    });
    expect(res.status).toBe(200);
    expect(d.storeSecret).toHaveBeenCalledWith(ORG_A, "access_token", FAKE_TOKEN);
    const txt = JSON.stringify(res.body);
    expect(txt).not.toContain(FAKE_TOKEN);
    expect(txt).not.toContain(FAKE_TOKEN.slice(-6));
    expect((res.body.config as ClicksignConfig).token).toEqual({
      configured: true,
      set_at: "2026-10-19T22:00:00Z",
    });
    expect((res.body.config as ClicksignConfig).webhook_url).toBe(
      `https://projeto.example.com/functions/v1/clicksign-webhook/${SLUG}`,
    );
  });

  it("chave curta, com espaço ou tipo inválido é recusada sem gravar", async () => {
    const { d } = deps();
    for (const body of [
      { action: "save_secret", kind: "access_token", value: "curta" },
      { action: "save_secret", kind: "access_token", value: "tem espaco no meio 123456" },
      { action: "save_secret", kind: "outra", value: FAKE_TOKEN },
    ]) {
      expect((await handleConfig(d, body)).status).toBe(400);
    }
    expect(d.storeSecret).not.toHaveBeenCalled();
    expect(cleanSecret("x".repeat(513))).toBeNull();
    expect(cleanSecret(" " + "x".repeat(20) + " ")).toBe("x".repeat(20));
  });
});

describe("clicksign-config (edge) — teste de conexão só leitura", () => {
  it("ok: faz 1 GET /envelopes?page[size]=1 com a chave salva e registra ok", async () => {
    const { d, calls, state, fetch } = deps();
    state.secrets.access_token = FAKE_TOKEN;
    const res = await handleConfig(d, { action: "test" });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["GET https://app.clicksign.com/api/v3/envelopes?page[size]=1"]);
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(FAKE_TOKEN);
    expect(res.body.test).toMatchObject({ ok: true });
    expect(state.tests).toEqual([{ ok: true, code: null }]);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_TOKEN);
  });

  it("chave recusada (401): mensagem clara e código curto na auditoria", async () => {
    const { d, state } = deps({}, 401);
    state.secrets.access_token = FAKE_TOKEN;
    const res = await handleConfig(d, { action: "test" });
    expect(res.body.test).toMatchObject({ ok: false, code: "chave_recusada" });
    expect(String((res.body.test as { message: string }).message)).toMatch(/recusou a chave/);
    expect(state.tests).toEqual([{ ok: false, code: "chave_recusada" }]);
  });

  it("sem chave salva: não chama a Clicksign", async () => {
    const { d, fetch } = deps();
    expect((await handleConfig(d, { action: "test" })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(d.recordTest).not.toHaveBeenCalled();
  });

  it("traduz falhas", () => {
    expect(connectionFailure(new ClicksignError("t", 403, "")).code).toBe("chave_recusada");
    expect(connectionFailure(new ClicksignError("t", 503, "")).code).toBe("clicksign_indisponivel");
    expect(connectionFailure(new ClicksignError("t", 429, "")).code).toBe("limite");
    expect(connectionFailure(new ClicksignError("t", 404, "")).code).toBe("http_404");
    expect(connectionFailure(new TypeError("network")).code).toBe("sem_resposta");
  });
});

describe("clicksign-config (edge) — salvar e ligar", () => {
  it("valida prazo, signatários e allowlist", () => {
    expect(parseSave({ deadline_days: 0 })).toMatchObject({ ok: false });
    expect(parseSave({ deadline_days: 91 })).toMatchObject({ ok: false });
    expect(parseSave({ deadline_days: 15 })).toEqual({ ok: true, value: { deadlineDays: 15 } });
    expect(parseSave({ signer_ids: ["nao-uuid"] })).toMatchObject({ ok: false });
    expect(parseSave({ signer_ids: [SIGNER, SIGNER] })).toEqual({
      ok: true,
      value: { signerIds: [SIGNER] },
    });
    expect(parseSave({ allowlist: ["A@Example.com", "a@example.com "] })).toEqual({
      ok: true,
      value: { allowlist: ["a@example.com"] },
    });
    expect(parseSave({ allowlist: ["sem-arroba"] })).toMatchObject({ ok: false });
    expect(parseSave({ test_mode: "sim" })).toMatchObject({ ok: false });
    expect(parseSave({})).toMatchObject({ ok: false });
  });

  it("mensagem do banco ao ligar sem requisitos chega à tela", async () => {
    const { d } = deps({
      setEnabled: vi.fn(async () =>
        Promise.reject(new Error("Para ligar falta: teste de conexão aprovado")),
      ),
    });
    const res = await handleConfig(d, { action: "set_enabled", on: true });
    expect(res).toEqual({
      status: 400,
      body: { error: "Para ligar falta: teste de conexão aprovado" },
    });
  });

  it("erro interno do banco não vaza detalhes", async () => {
    const { d } = deps({
      save: vi.fn(async () => Promise.reject(new Error("relation x does not exist"))),
    });
    const res = await handleConfig(d, { action: "save", deadline_days: 10 });
    expect(res.body.error).toBe("Não foi possível salvar. Nada foi alterado.");
  });
});

describe("tela — regras", () => {
  const cfg = (o: Partial<ClicksignConfig> = {}): ClicksignConfig => ({
    ...(baseView() as unknown as ClicksignConfig),
    webhook_url: null,
    ...o,
  });
  it("ligar só com chave, webhook, signatário e teste aprovado", () => {
    expect(podeLigar(cfg())).toBe(false);
    expect(requisitosParaLigar(cfg()).filter((r) => !r.ok)).toHaveLength(4);
    const pronto = cfg({
      token: { configured: true, set_at: "x" },
      webhook: { configured: true, set_at: "x", slug: SLUG },
      valid_signers: 1,
      connection: { ok: true, checked_at: "x" },
    });
    expect(podeLigar(pronto)).toBe(true);
    expect(podeLigar({ ...pronto, connection: { ok: false, checked_at: "x" } })).toBe(false);
    expect(podeLigar({ ...pronto, valid_signers: 0 })).toBe(false);
  });
  it("ligada = captação E venda", () => {
    expect(estaLigada(cfg({ enabled: true, sale_enabled: false }))).toBe(false);
    expect(estaLigada(cfg({ enabled: true, sale_enabled: true }))).toBe(true);
  });
  it("allowlist e prazo", () => {
    expect(parseAllowlist("a@example.com; B@example.com\nruim, a@example.com")).toEqual({
      emails: ["a@example.com", "b@example.com"],
      invalid: ["ruim"],
    });
    expect(parseDeadline("30")).toBe(30);
    expect(parseDeadline("0")).toBeNull();
    expect(parseDeadline("100")).toBeNull();
    expect(parseDeadline("1.5")).toBeNull();
  });
  it("auditoria em português, sem valor secreto", () => {
    const a = (action: string, detail: Record<string, unknown>) =>
      auditoriaTexto({ action: action as never, detail, created_at: "x", actor: "Fulano" });
    expect(a("chave_api", { operacao: "trocou" })).toBe("Trocou a chave de API");
    expect(a("teste_conexao", { ok: false, codigo: "chave_recusada" })).toBe(
      "Testou a conexão: falhou (chave_recusada)",
    );
    expect(a("configuracao", { modo_teste: false, prazo_dias: 15 })).toBe(
      "Alterou a configuração: modo teste desligado, prazo 15 dias",
    );
  });
});

describe("menu — só super_admin vê 'Assinatura digital'", () => {
  const papeis = [
    "corretor",
    "gestor",
    "team_leader",
    "juridico",
    "financeiro",
    "admin",
    "lancamento",
  ];
  const visivel = (roles: string[], platformAdmin = false) =>
    itensVisiveis(
      montarMenuLateral({
        roles: roles as never,
        platformAdmin,
        exclusiveVisible: true,
        roomVisible: true,
        feedbackVisible: true,
      } as never),
    ).includes("/admin/assinatura-digital");
  it.each(papeis)("%s não vê", (p) => expect(visivel([p])).toBe(false));
  it("admin + gestor juntos não veem", () => expect(visivel(["admin", "gestor"])).toBe(false));
  it("dono da plataforma fora da imobiliária não vê (precisa entrar na imobiliária)", () =>
    expect(visivel([], true)).toBe(false));
  it("super_admin vê", () => expect(visivel(["super_admin"])).toBe(true));
});
