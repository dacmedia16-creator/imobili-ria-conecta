import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  aquecerUmaRodada,
  chipNumero,
  codigoResultado,
  ENV_AQUECER_CHAVE,
  ENV_AQUECER_CHIP,
  ENV_AQUECER_FLAG,
  escolherCanalAquecer,
  urlRetornoAquecer,
  type DepsAquecer,
} from "./leads-aquecer";
import { canalZionTalk, ZIONTALK_SEND_URL } from "./leads-ia-canal";
import { enviarPendentes, receberReengajar, type DepsReengajar } from "./leads-ia-retorno.server";

// t_a2cae373: aquecer leads parados por chip ZionTalk SEPARADO. O banco (seleção dos 30 dias, opt-out, limite com rampa,
// freio automático, isolamento entre imobiliárias, mesma conversa) é provado na homologação por
// supabase/tests/leads_aquecer.sql (48 checagens numa transação desfeita). Aqui: o servidor, com a ZionTalk SIMULADA.
const MIG = readFileSync("supabase/migrations/20261125120000_leads_aquecer.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261125120000_leads_aquecer.rollback.sql", "utf8");
const SRC = readFileSync("src/lib/leads-aquecer.ts", "utf8");
const ROTA = readFileSync("src/routes/api/leads/aquecer.$token.ts", "utf8");

const CHAVE = "chave-ficticia-aquecer";
const ENV_REAL = {
  [ENV_AQUECER_FLAG]: "on",
  [ENV_AQUECER_CHAVE]: CHAVE,
  [ENV_AQUECER_CHIP]: "(15) 99999-0001",
};

function deps(lista: Array<Record<string, unknown>>, extra: Partial<DepsAquecer> = {}) {
  const preparar = vi.fn(async (_chip: string | null) => ({ data: lista, error: null }));
  const resultado = vi.fn(async (_id: string, _s: string, _e: string | null) => ({
    data: { ok: true, freio: null },
    error: null,
  }));
  const zion = vi.fn(
    async (_u: RequestInfo | URL, _i?: RequestInit) => new Response("", { status: 201 }),
  );
  const d: DepsAquecer = {
    env: {},
    fetchFn: zion as unknown as typeof fetch,
    preparar,
    resultado,
    ...extra,
  };
  return { d, preparar, resultado, zion };
}
const item = (real: boolean, id = "e1") => ({
  envio_id: id,
  lead_id: "l1",
  telefone: "5515999990011",
  texto: "Oi! Ainda está procurando?",
  modo_real: real,
});

describe("canal do aquecimento: separado e sem fallback", () => {
  it("sem flag/chave/chip = modo teste (nada sai)", () => {
    expect(escolherCanalAquecer({}).chip).toBeNull();
    expect(escolherCanalAquecer({ ...ENV_REAL, [ENV_AQUECER_FLAG]: "off" }).canal.nome).toBe(
      "teste",
    );
    expect(escolherCanalAquecer({ ...ENV_REAL, [ENV_AQUECER_CHAVE]: " " }).canal.nome).toBe(
      "teste",
    );
    expect(escolherCanalAquecer({ ...ENV_REAL, [ENV_AQUECER_CHIP]: "123" }).canal.nome).toBe(
      "teste",
    );
    const ok = escolherCanalAquecer(ENV_REAL);
    expect(ok.canal.nome).toBe("ziontalk");
    expect(ok.chip).toBe("15999990001");
  });

  it("nunca usa a chave do chip de atendimento, a do ADM, do Visita Prova nem do MAX", () => {
    const outros = {
      LEADS_IA_ENVIO_REAL: "on",
      ZIONTALK_LEADS_IA_API_KEY: "chave-atendimento",
      ZIONTALK_API_KEY: "chave-adm",
      ZIONTALK_MAX_API_KEY: "chave-max",
      VISITA_PROVA_NOTIFICATION_API_KEY: "chave-visita",
      [ENV_AQUECER_FLAG]: "on",
      [ENV_AQUECER_CHIP]: "15999990001",
    };
    expect(escolherCanalAquecer(outros).canal.nome).toBe("teste");
    // O código do aquecimento só lê as variáveis dele.
    for (const proibida of [
      "ZIONTALK_LEADS_IA_API_KEY",
      "ZIONTALK_API_KEY",
      "ZIONTALK_MAX_API_KEY",
      "VISITA_PROVA",
      "LEADS_IA_ENVIO_REAL",
    ])
      expect(SRC).not.toContain(proibida + '"');
  });

  it("chipNumero aceita DDD+número e +55, recusa lixo", () => {
    expect(chipNumero("+55 (15) 99999-0001")).toBe("15999990001");
    expect(chipNumero("1532221234")).toBe("1532221234");
    expect(chipNumero("0800")).toBeNull();
    expect(chipNumero(undefined)).toBeNull();
  });

  it("resultado vai ao banco só como código (nunca o corpo da ZionTalk)", () => {
    expect(codigoResultado({ status: "enviada" })).toEqual({ status: "enviada", erro: null });
    expect(codigoResultado({ status: "falhou", erro: "http_403", repetir: false })).toEqual({
      status: "falhou",
      erro: "http_403",
    });
    expect(
      codigoResultado({ status: "falhou", erro: "Telefone 1599… inválido", repetir: false }).erro,
    ).toBe("erro");
  });

  it("link do retorno do aquecimento é diferente do retorno de atendimento", () => {
    expect(urlRetornoAquecer("https://adm.exemplo/", "T".repeat(43))).toBe(
      `https://adm.exemplo/api/leads/aquecer/${"T".repeat(43)}`,
    );
    expect(ROTA).toContain('"/api/leads/aquecer/$token"');
    expect(ROTA).toContain("depsRetornoAquecerReais");
  });
});

describe("rodada do aquecimento (pg_cron a cada 5 min)", () => {
  it("modo teste: pede ao banco SEM chip, não chama a ZionTalk e devolve 'teste'", async () => {
    const m = deps([item(false)]);
    const r = await aquecerUmaRodada(m.d);
    expect(m.preparar).toHaveBeenCalledWith(null);
    expect(m.zion).not.toHaveBeenCalled();
    expect(m.resultado).toHaveBeenCalledWith("e1", "teste", null);
    expect(r).toMatchObject({ r: "ok", preparados: 1, teste: 1, enviados: 0 });
  });

  it("envio real: só quando o BANCO marcou o envio como real, pela chave do aquecimento", async () => {
    const m = deps([item(true, "e1"), item(false, "e2")], { env: ENV_REAL });
    const r = await aquecerUmaRodada(m.d);
    expect(m.preparar).toHaveBeenCalledWith("15999990001");
    expect(m.zion).toHaveBeenCalledTimes(1);
    const [url, init] = m.zion.mock.calls[0];
    expect(url).toBe(ZIONTALK_SEND_URL);
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa(`${CHAVE}:`)}`,
    );
    expect(m.resultado).toHaveBeenNthCalledWith(1, "e1", "enviada", null);
    expect(m.resultado).toHaveBeenNthCalledWith(2, "e2", "teste", null);
    expect(r).toMatchObject({ enviados: 1, teste: 1 });
  });

  it("modo teste nunca envia, mesmo se o banco marcar real (defesa dupla)", async () => {
    const m = deps([item(true)]);
    await aquecerUmaRodada(m.d);
    expect(m.zion).not.toHaveBeenCalled();
    expect(m.resultado).toHaveBeenCalledWith("e1", "teste", null);
  });

  it("falha do canal: grava 'falhou' com o código, não repete e repassa o freio do banco", async () => {
    const m = deps([item(true)], {
      env: ENV_REAL,
      resultado: vi.fn(async () => ({ data: { ok: true, freio: "erro_canal" }, error: null })),
    });
    m.d.fetchFn = vi.fn(
      async () => new Response("Unauthorized", { status: 403 }),
    ) as unknown as typeof fetch;
    const r = await aquecerUmaRodada(m.d);
    expect(m.d.resultado).toHaveBeenCalledWith("e1", "falhou", "http_403");
    expect(m.d.fetchFn).toHaveBeenCalledTimes(1);
    expect(r.freio).toEqual(["erro_canal"]);
  });

  it("erro no banco: não envia nada", async () => {
    const m = deps([], { preparar: vi.fn(async () => ({ data: null, error: { code: "42883" } })) });
    expect(await aquecerUmaRodada({ ...m.d, env: ENV_REAL })).toEqual({ r: "erro" });
    expect(m.zion).not.toHaveBeenCalled();
  });

  it("respostas da Nicole a leads retomados saem pelo chip do aquecimento (só com envio real)", async () => {
    const enviarPendentesLead = vi.fn(async () => 1);
    const pendentes = vi.fn(async () => ({ data: [{ lead_id: "l9" }], error: null }));
    const teste = deps([], { pendentes, enviarPendentesLead });
    await aquecerUmaRodada(teste.d);
    expect(pendentes).not.toHaveBeenCalled();
    const real = deps([], { env: ENV_REAL, pendentes, enviarPendentesLead });
    const r = await aquecerUmaRodada(real.d);
    expect(pendentes).toHaveBeenCalledWith("15999990001");
    expect((enviarPendentesLead.mock.calls[0] as unknown[])[1]).toMatchObject({ nome: "ziontalk" });
    expect(r.respostas).toBe(1);
  });

  it("roda dentro da rota do pg_cron (/api/leads/reengajar) e erro nele não muda a resposta", async () => {
    const SEG = "s".repeat(40);
    const preparar = vi.fn(async () => ({ data: null, error: { code: "XX000" } }));
    const d = {
      env: { LEADS_IA_REENGAJAR_SEGREDO: SEG },
      reengajarReservar: vi.fn(async () => ({ data: [], error: null })),
      reservar: vi.fn(),
      resultado: vi.fn(),
      aquecer: { preparar, resultado: vi.fn() },
    } as unknown as DepsReengajar;
    const r = await receberReengajar(
      new Request("https://x/api/leads/reengajar", {
        method: "POST",
        headers: { "x-leads-ia-segredo": SEG },
      }),
      d,
    );
    expect(r.status).toBe(200);
    expect(preparar).toHaveBeenCalledWith(null);
  });
});

describe("chip de atendimento × chip do aquecimento (enviarPendentes)", () => {
  const fila = () => {
    let f = [
      {
        msg_id: "m1",
        telefone: "5515999990011",
        texto: "Que bom! Procura casa ou apartamento?",
        primeira: false,
      },
    ];
    return vi.fn(async () => {
      const d = f;
      f = [];
      return { data: d, error: null };
    });
  };
  const ENV_ATEND = { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "chave-atendimento" };

  it("lead retomado pelo aquecimento NUNCA sai pelo chip de atendimento", async () => {
    const zion = vi.fn(async () => new Response("", { status: 201 }));
    for (const chip of ["aquecer", "aquecer_teste", "bloqueado"] as const) {
      const reservar = fila();
      const n = await enviarPendentes("l1", {
        env: ENV_ATEND,
        fetchFn: zion as unknown as typeof fetch,
        reservar,
        resultado: vi.fn(),
        chipDoLead: async () => chip,
      });
      expect(n).toBe(0);
      expect(reservar).not.toHaveBeenCalled();
    }
    expect(zion).not.toHaveBeenCalled();
  });

  it("chip do aquecimento só envia para lead retomado pelo aquecimento real", async () => {
    const zion = vi.fn(
      async (_u: RequestInfo | URL, _i?: RequestInit) => new Response("", { status: 201 }),
    );
    const canal = canalZionTalk(CHAVE, zion as unknown as typeof fetch);
    const atend = fila();
    expect(
      await enviarPendentes("l1", {
        env: {},
        reservar: atend,
        resultado: vi.fn(),
        chipDoLead: async () => "atendimento",
        canalAquecer: canal,
      }),
    ).toBe(0);
    expect(atend).not.toHaveBeenCalled();
    const ok = fila();
    expect(
      await enviarPendentes("l1", {
        env: {},
        reservar: ok,
        resultado: vi.fn(async () => undefined),
        chipDoLead: async () => "aquecer",
        canalAquecer: canal,
      }),
    ).toBe(1);
    expect((zion.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa(`${CHAVE}:`)}`,
    );
  });

  it("lead comum segue saindo pelo chip de atendimento como antes", async () => {
    const zion = vi.fn(
      async (_u: RequestInfo | URL, _i?: RequestInit) => new Response("", { status: 201 }),
    );
    const n = await enviarPendentes("l1", {
      env: ENV_ATEND,
      fetchFn: zion as unknown as typeof fetch,
      reservar: fila(),
      resultado: vi.fn(async () => undefined),
      chipDoLead: async () => "atendimento",
    });
    expect(n).toBe(1);
    expect((zion.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa("chave-atendimento:")}`,
    );
  });
});

describe("migration e rollback (texto)", () => {
  it("nasce desligado, com freio, rampa e chip separado do atendimento", () => {
    expect(MIG).toMatch(/aquecer_ativo boolean NOT NULL DEFAULT false/);
    expect(MIG).toMatch(/aquecer_dias integer NOT NULL DEFAULT 30/);
    expect(MIG).toMatch(/aquecer_limite_dia integer NOT NULL DEFAULT 15/);
    expect(MIG).toMatch(/lead_config_aquecer_chip_separado/);
    expect(MIG).toMatch(/aquecer_chip_numero IS DISTINCT FROM ia_canal_numero/);
    expect(MIG).not.toMatch(/UPDATE public\.lead_config SET aquecer_ativo = true/);
  });

  it("navegador não chama preparo/envio/retorno; tabelas fechadas", () => {
    expect(MIG).toMatch(
      /REVOKE ALL ON public\.lead_aquecer, public\.lead_aquecer_envios, public\.lead_aquecer_pausas FROM PUBLIC, anon, authenticated/,
    );
    expect(MIG).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.lead_aquecer_preparar\(text, timestamptz\)[^;]*TO service_role;/,
    );
  });

  it("rollback apaga tudo o que a migration cria e devolve lead_ia_liberado", () => {
    const fns = [
      ...MIG.matchAll(/CREATE OR REPLACE FUNCTION public\.(lead_aquecer_[a-z_]+)\(/g),
    ].map((m) => m[1]);
    expect(fns.length).toBeGreaterThan(20);
    for (const f of new Set(fns)) expect(RB).toContain(`DROP FUNCTION IF EXISTS public.${f}(`);
    for (const t of ["lead_aquecer_envios", "lead_aquecer_pausas", "lead_aquecer;"])
      expect(RB).toContain(`DROP TABLE IF EXISTS public.${t}`);
    const cols = [...MIG.matchAll(/ADD COLUMN IF NOT EXISTS (aquecer_[a-z_]+)/g)].map((m) => m[1]);
    for (const c of cols) expect(RB).toContain(`DROP COLUMN IF EXISTS ${c}`);
    // lead_ia_liberado não muda; o rollback devolve as 2 funções de saída sem nenhuma referência ao aquecimento.
    expect(MIG).not.toMatch(/FUNCTION public\.lead_ia_liberado/);
    expect(RB).toMatch(/CREATE OR REPLACE FUNCTION public\.lead_ia_status_saida/);
    expect(RB).toMatch(/CREATE OR REPLACE FUNCTION public\.lead_ia_envio_reservar/);
    const restaurado = RB.slice(
      RB.indexOf("CREATE OR REPLACE FUNCTION"),
      RB.indexOf("DROP FUNCTION"),
    );
    expect(restaurado).not.toMatch(/aquecer/);
  });

  it("chip de atendimento recusa no BANCO lead do aquecimento (vale para o botão Enviar do gestor)", () => {
    const f = MIG.slice(MIG.indexOf("FUNCTION public.lead_ia_envio_reservar("));
    expect(f.slice(0, 900)).toMatch(
      /lead_aquecer_chip_do_lead\(_lead\) <> 'atendimento' THEN RETURN/,
    );
  });
});

describe("respostas pelo chip do aquecimento (revisão)", () => {
  it("erro de canal ao responder chama o freio; sucesso não", async () => {
    const canal = canalZionTalk(
      CHAVE,
      (async () => new Response("", { status: 403 })) as unknown as typeof fetch,
    );
    const falhaCanal = vi.fn(async () => undefined);
    const reservar = vi.fn(async () => ({
      data: [{ msg_id: "m1", telefone: "+5515999990000", texto: "Oi", primeira: false }],
      error: null,
    }));
    const n = await enviarPendentes("l1", {
      env: {},
      reservar,
      resultado: vi.fn(async () => undefined),
      chipDoLead: async () => "aquecer",
      canalAquecer: canal,
      falhaCanal,
    });
    expect(n).toBe(0);
    expect(falhaCanal).toHaveBeenCalledWith("http_403");
  });

  it("reserva do aquecimento sem chip no servidor não chama o banco", async () => {
    const { depsEnvioAquecer } = await import("./leads-ia-retorno.server");
    const rpc = vi.fn();
    const d = depsEnvioAquecer({ rpc } as never, null);
    expect(await d.reservar("l1")).toEqual({ data: [], error: null });
    expect(rpc).not.toHaveBeenCalled();
    const d2 = depsEnvioAquecer(
      { rpc: vi.fn(async () => ({ data: [], error: null })) } as never,
      "15999990001",
    );
    await d2.reservar("l1");
  });
});
