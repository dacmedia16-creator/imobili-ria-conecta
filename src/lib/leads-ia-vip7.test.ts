import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  enviarAvisosCorretor,
  primeiraAutoUmaVez,
  receberReengajar,
} from "./leads-ia-retorno.server";

// t_ccaa41c0 (Denis 30/10): Nicole liberada para leads reais na ZZ, como "VIP7 Imóveis", lead só ao corretor na passagem.
const MIG = readFileSync("supabase/migrations/20261030220000_leads_ia_vip7_liberacao.sql", "utf8");
const RB = readFileSync(
  "docs/sql/rollback/20261030220000_leads_ia_vip7_liberacao.rollback.sql",
  "utf8",
);
const ZZ = readFileSync("docs/sql/dados/20261030_zz_nicole_vip7.sql", "utf8");
const ENV = { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "k" };
const fn = (nome: string) => {
  const i = MIG.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(i, nome).toBeGreaterThanOrEqual(0);
  return MIG.slice(i, MIG.indexOf("END $function$", i));
};

describe("migration: liberação por imobiliária, desligada por padrão", () => {
  it("colunas novas nascem no comportamento antigo (lista, sem auto, sem passagem, sem aviso)", () => {
    expect(MIG).toMatch(/ia_envio_modo text NOT NULL DEFAULT 'lista'/);
    expect(MIG).toMatch(/ia_primeira_auto boolean NOT NULL DEFAULT false/);
    expect(MIG).toMatch(/ia_aviso_corretor_whats boolean NOT NULL DEFAULT false/);
    expect(MIG).toMatch(/ia_corretor_passagem_id uuid REFERENCES public\.profiles\(id\)/);
    expect(MIG).toMatch(/ia_reengajar_h0 integer/);
  });
  it("modo 'todos' exige data de corte e só libera leads criados a partir dela", () => {
    expect(MIG).toMatch(/ia_envio_modo = 'lista' OR ia_envio_desde IS NOT NULL/);
    expect(fn("lead_ia_liberado")).toMatch(/_l\.created_at >= _c\.ia_envio_desde/);
  });
  it("as 6 travas de envio usam a mesma regra (nenhuma compara a lista direto)", () => {
    for (const n of [
      "lead_ia_iniciar",
      "lead_ia_status_saida",
      "lead_ia_envio_reservar",
      "lead_ia_reengajar_reservar",
      "lead_ia_toque15_elegivel",
    ]) {
      expect(fn(n), n).toMatch(/lead_ia_liberado\(/);
      expect(fn(n), n).not.toMatch(/&& _?c\.ia_envio_allowlist/);
    }
    // respostas: fora da lista só passa no modo 'todos' e se o lead da conversa estiver liberado
    expect(fn("lead_ia_retorno_receber")).toMatch(/AND _c\.ia_envio_modo <> 'todos' THEN/);
    expect(fn("lead_ia_retorno_receber")).toMatch(
      /NOT public\.lead_ia_liberado\(_c, \(SELECT l FROM public\.leads l WHERE l\.id = _cv\.lead_id\)\)/,
    );
  });
  it("nome de apresentação (ia_org_nome) em 1ª mensagem, respostas e toque de 15 min", () => {
    expect(fn("lead_ia_org_nome")).toMatch(/nullif\(btrim\(\(SELECT c\.ia_org_nome/);
    for (const n of [
      "lead_ia_iniciar",
      "lead_ia_primeira_atualizar",
      "lead_ia_registrar_cliente",
      "lead_ia_toque15_candidatas",
    ])
      expect(fn(n), n).toMatch(/lead_ia_org_nome\(/);
  });
  it("modo passagem: lead não vai a ninguém antes da passagem; depois do prazo vai ao banco (sem rodízio)", () => {
    const d = fn("lead_distribuir");
    expect(d).toMatch(/cv\.estado = 'passada'\) THEN\s+RETURN _l\.responsavel_id;/);
    expect(d).toMatch(
      /IF _c\.ia_corretor_passagem_id IS NOT NULL AND _c\.ia_ativa THEN\s+_alvo := NULL;/,
    );
  });
  it("passagem atribui ao corretor, 1 aviso por lead (único) e sem telefone/e-mail do cliente", () => {
    const p = fn("lead_ia_passar");
    expect(p).toMatch(/SET responsavel_id = _c\.ia_corretor_passagem_id, atribuido_em = now\(\)/);
    expect(p).toMatch(/ON CONFLICT \(lead_id, evento\) DO NOTHING/);
    expect(p).not.toMatch(/_l\.telefone|_l\.email/);
    expect(MIG).toMatch(/UNIQUE \(lead_id, evento\)/);
  });
  it("aviso: corretor sem telefone = sem_telefone (só sino); nunca repete", () => {
    expect(fn("lead_avisos_corretor_reservar")).toMatch(/SET status = 'sem_telefone'/);
    expect(fn("lead_avisos_corretor_resultado")).toMatch(/status = 'enviando'/);
  });
  it("1ª mensagem automática: a qualquer hora (sem janela), só leads liberados; webhook dispara na hora", () => {
    const f = fn("lead_ia_primeira_auto_proximo");
    expect(f).not.toMatch(/lead_ia_toque15_horario/);
    expect(readFileSync("src/routes/api/leads/grupo-olx.$token.ts", "utf8")).toMatch(
      /dispararPrimeiraAuto\(request\)/,
    );
    expect(f).toMatch(/lead_ia_liberado\(c, l\)/);
    expect(f).toMatch(/cv\.primeira_enviada_em IS NULL/);
  });
  it("cadência sem resposta: h0 (3 h), h1 (24 h) e h2 sem resposta (48 h) contam da 1ª mensagem; conta no limite do dia", () => {
    const r = fn("lead_ia_reengajar_reservar");
    expect(r).toMatch(
      /cv\.primeira_enviada_em <= now\(\) - make_interval\(hours => c\.ia_reengajar_h0\)/,
    );
    expect(r).toMatch(/coalesce\(c\.ia_reengajar_h2_sem_resposta, c\.ia_reengajar_h2\)/);
    expect(r).toMatch(/x\.reengaje_0_em AT TIME ZONE/);
    expect(fn("lead_ia_toque15_hoje")).toMatch(/x\.reengaje_0_em AT TIME ZONE/);
  });
  it("funções novas só para o servidor (service_role)", () => {
    for (const n of [
      "lead_ia_primeira_auto_proximo()",
      "lead_avisos_corretor_reservar(uuid)",
      "lead_avisos_corretor_resultado(uuid, boolean)",
    ]) {
      expect(MIG).toContain(`REVOKE ALL ON FUNCTION public.${n} FROM PUBLIC, anon, authenticated;`);
      expect(MIG).toContain(`GRANT EXECUTE ON FUNCTION public.${n} TO service_role;`);
    }
    expect(MIG).toMatch(
      /REVOKE ALL ON public\.lead_avisos_corretor FROM PUBLIC, anon, authenticated;/,
    );
  });
});

describe("config da ZZ e rollback em 1 passo", () => {
  it("só a ZZ, nome VIP7, corretor da passagem, limite 30, 3/24/48 h", () => {
    expect(ZZ).toMatch(/'ZZ Teste Provisionamento'/);
    expect(ZZ).toMatch(/ia_org_nome = 'VIP7 Imóveis'/);
    expect(ZZ).toMatch(/ia_envio_limite_dia = 30/);
    expect(ZZ).toMatch(/ia_reengajar_h0 = 3, ia_reengajar_h2_sem_resposta = 48/);
    expect(ZZ).toMatch(/_desde constant timestamptz := '2026-10-30 00:00:00-03'/);
  });
  it("rollback: 1 UPDATE só na ZZ voltando tudo ao modo lista/manual", () => {
    expect(RB.match(/^UPDATE /gm)).toHaveLength(1);
    expect(RB).toMatch(/ia_envio_modo = 'lista'.*ia_primeira_auto = false/s);
    expect(RB).toMatch(/ia_corretor_passagem_id = NULL, ia_aviso_corretor_whats = false/);
    expect(RB).toMatch(/WHERE organization_id = 'eb0a260a-db2f-4cbf-b031-f0c2aebb407c'/);
  });
});

describe("servidor: 1ª mensagem automática e aviso ao corretor", () => {
  const zion = () => vi.fn(async () => new Response("", { status: 201 }));
  it("aviso: envia pelo canal da IA e marca o resultado", async () => {
    const z = zion();
    const avisoResultado = vi.fn(async () => undefined);
    const n = await enviarAvisosCorretor("l1", {
      env: ENV,
      fetchFn: z as unknown as typeof fetch,
      avisoResultado,
      avisosReservar: vi.fn(async () => ({
        data: [
          {
            aviso_id: "a1",
            telefone: "15999990000",
            texto: "VIP7 Imóveis: a Nicole passou o cliente Ana para você.",
          },
        ],
        error: null,
      })),
    });
    expect(n).toBe(1);
    expect(z).toHaveBeenCalledOnce();
    expect(avisoResultado).toHaveBeenCalledWith("a1", true);
  });
  it("aviso: envio real desligado não reserva nada", async () => {
    const avisosReservar = vi.fn(async () => ({ data: [], error: null }));
    expect(
      await enviarAvisosCorretor(null, { env: {}, avisosReservar, avisoResultado: vi.fn() }),
    ).toBe(0);
    expect(avisosReservar).not.toHaveBeenCalled();
  });
  it("aviso: ZionTalk falhou = 'falhou' (sem repetir)", async () => {
    const avisoResultado = vi.fn(async () => undefined);
    await enviarAvisosCorretor("l1", {
      env: ENV,
      fetchFn: vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch,
      avisoResultado,
      avisosReservar: vi.fn(async () => ({
        data: [{ aviso_id: "a1", telefone: "15999990000", texto: "x" }],
        error: null,
      })),
    });
    expect(avisoResultado).toHaveBeenCalledWith("a1", false);
  });
  it("1ª automática: 1 lead por chamada, pelo caminho de sempre (reservar no banco)", async () => {
    const reservar = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            msg_id: "m1",
            telefone: "15999990000",
            texto: "Oi! Aqui é a Nicole, da VIP7 Imóveis.",
            primeira: true,
          },
        ],
        error: null,
      })
      .mockResolvedValue({ data: [], error: null });
    const r = await primeiraAutoUmaVez({
      env: ENV,
      fetchFn: zion() as unknown as typeof fetch,
      reservar,
      resultado: vi.fn(async () => undefined),
      primeiraProximo: vi.fn(async () => ({ data: [{ lead_id: "l1" }], error: null })),
    });
    expect(r.r).toBe("enviada");
    expect(reservar).toHaveBeenCalledWith("l1");
  });
  it("1ª automática: envio real desligado não consulta o banco", async () => {
    const primeiraProximo = vi.fn(async () => ({ data: [{ lead_id: "l1" }], error: null }));
    expect(
      (
        await primeiraAutoUmaVez({
          env: {},
          reservar: vi.fn(),
          resultado: vi.fn(),
          primeiraProximo,
        })
      ).r,
    ).toBe("nada");
    expect(primeiraProximo).not.toHaveBeenCalled();
  });
  it("rota do pg_cron chama também a 1ª automática e os avisos; erro neles não muda a resposta", async () => {
    const SEG = "S".repeat(40);
    const primeiraProximo = vi.fn(async () => ({ data: null, error: { code: "PGRST202" } }));
    const avisosReservar = vi.fn(async () => ({ data: null, error: { code: "PGRST202" } }));
    const res = await receberReengajar(
      new Request("https://app/api/leads/reengajar", {
        method: "POST",
        headers: { "x-leads-ia-segredo": SEG },
      }),
      {
        env: { ...ENV, LEADS_IA_REENGAJAR_SEGREDO: SEG },
        fetchFn: zion() as unknown as typeof fetch,
        reengajarReservar: vi.fn(async () => ({ data: [], error: null })),
        reservar: vi.fn(),
        resultado: vi.fn(),
        primeiraProximo,
        avisos: { avisosReservar, avisoResultado: vi.fn() },
      },
    );
    expect(res.status).toBe(200);
    expect(primeiraProximo).toHaveBeenCalledOnce();
    expect(avisosReservar).toHaveBeenCalledWith(null);
  });
});
