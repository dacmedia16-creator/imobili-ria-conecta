// Avisos de status da Clicksign (t_f8dc8b99) — só mock: nenhuma rede, nenhum WhatsApp/e-mail real.
import { describe, expect, it, vi } from "vitest";
import { hmacSha256Hex, sha256Hex } from "../../supabase/functions/_shared/clicksign.ts";
import {
  handleWebhook,
  signerEmailSha,
  type WebhookDeps,
} from "../../supabase/functions/clicksign-webhook/core.ts";
import {
  runClicksignAvisos,
  textoWhatsClicksign,
  type AvisosDb,
  type PendenteWhats,
} from "./clicksign-avisos.server";
import { whatsappText } from "./room-reservation-reminders";

const ORG = "22222222-2222-4222-8222-222222222222";
const CAP = "11111111-1111-4111-8111-111111111111";
const SALE = "99999999-9999-4999-8999-999999999999";
const URL_APP = "https://app.example.com";

describe("webhook: evento sign → aviso só no sino", () => {
  const SLUG = "a".repeat(32);
  const SECRET = "segredo-webhook";
  const DOCKEY = "66666666-6666-4666-8666-666666666666";
  const env = { id: "row-1", envelope_key: "e", document_key: DOCKEY, capture_id: CAP, organization_id: ORG };
  function deps(opts: { seen?: boolean; envelope?: boolean; notice?: () => Promise<number> } = {}) {
    const d: WebhookDeps = {
      fetch: vi.fn(async () => new Response("nao deveria chamar", { status: 500 })),
      findOrg: vi.fn(async () => ({ organizationId: ORG, secret: SECRET, token: "tok-fake" })),
      recordEvent: vi.fn(async () => ({ id: 42, fresh: !opts.seen })),
      finishEvent: vi.fn(async () => undefined),
      findEnvelope: vi.fn(async () => (opts.envelope === false ? null : env)),
      updateEnvelope: vi.fn(async () => undefined),
      storePdf: vi.fn(async () => "x"),
      attachSigned: vi.fn(async () => "attached"),
      removeObject: vi.fn(async () => undefined),
      signNotice: vi.fn(opts.notice ?? (async () => 3)),
    };
    return d;
  }
  async function signed(payload: unknown) {
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    return { raw, hmac: `sha256=${await hmacSha256Hex(SECRET, raw)}` };
  }
  const sign = {
    event: { name: "sign", data: { signer: { email: "  Ana@Example.com ", name: "Ana" } } },
    document: { key: DOCKEY },
  };

  it("manda o sha256 do e-mail normalizado (nunca o e-mail) e o id do evento", async () => {
    const d = deps();
    const s = await signed(sign);
    const r = await handleWebhook(d, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r).toMatchObject({ status: 200, body: { result: "noted:sign:3" } });
    const sha = await sha256Hex("ana@example.com");
    expect(d.signNotice).toHaveBeenCalledWith("row-1", sha, 42);
    expect(JSON.stringify((d.signNotice as any).mock.calls)).not.toMatch(/@/);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.attachSigned).not.toHaveBeenCalled();
  });
  it("payload sem e-mail: sha nulo (o banco usa o id do evento)", async () => {
    expect(await signerEmailSha({ event: { name: "sign" } })).toBeNull();
    expect(await signerEmailSha({ event: { data: { signer: { email: "sem-arroba" } } } })).toBeNull();
    const d = deps();
    const s = await signed({ event: { name: "sign" }, document: { key: DOCKEY } });
    await handleWebhook(d, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(d.signNotice).toHaveBeenCalledWith("row-1", null, 42);
  });
  it("reentrega do mesmo evento (duplicado) não chama o aviso", async () => {
    const d = deps({ seen: true });
    const s = await signed(sign);
    const r = await handleWebhook(d, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r.body).toMatchObject({ duplicate: true });
    expect(d.signNotice).not.toHaveBeenCalled();
  });
  it("documento de outro sistema: ignorado, sem aviso", async () => {
    const d = deps({ envelope: false });
    const s = await signed(sign);
    const r = await handleWebhook(d, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r.body.result).toBe("ignored:unknown_document");
    expect(d.signNotice).not.toHaveBeenCalled();
  });
  it("falha no aviso não derruba o webhook (200, sem reenvio da Clicksign)", async () => {
    const d = deps({ notice: async () => Promise.reject(new Error("x")) });
    const s = await signed(sign);
    const r = await handleWebhook(d, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r).toMatchObject({ status: 200, body: { result: "noted:sign:aviso_falhou" } });
  });
  it("outros eventos intermediários não geram aviso de assinatura", async () => {
    const d = deps();
    const s = await signed({ event: { name: "add_signer" }, document: { key: DOCKEY } });
    const r = await handleWebhook(d, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r.body.result).toBe("noted:add_signer");
    expect(d.signNotice).not.toHaveBeenCalled();
  });
});

function pend(p: Partial<PendenteWhats> = {}): PendenteWhats {
  return {
    id: 1,
    evento: "enviado",
    origem: "captacao",
    ref_id: CAP,
    rotulo: "Captação #11111111",
    prazo: "28/10/2026",
    env_status: "running",
    telefone: "(15) 99999-0000",
    ativo: true,
    quer_whatsapp: true,
    is_test: false,
    ...p,
  };
}
function db(lista: PendenteWhats[], lembrete: () => Promise<number> = async () => 0) {
  const marcas: Array<[number, string, string | undefined]> = [];
  const d: AvisosDb = {
    lembretePrazo: vi.fn(lembrete),
    pendentes: vi.fn(async () => lista),
    marcar: vi.fn(async (id, res, erro) => {
      marcas.push([id, res, erro]);
    }),
  };
  return { d, marcas };
}

describe("rotina de WhatsApp (fila) — envio sempre mockado", () => {
  it("envia para o telefone normalizado, em ASCII, e marca ok", async () => {
    const { d, marcas } = db([pend()]);
    const send = vi.fn(async () => true);
    const r = await runClicksignAvisos(d, send, URL_APP);
    expect(r).toEqual({ lembretes: 0, enviados: 1, ignorados: 0, falhas: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const [fone, msg] = send.mock.calls[0] as unknown as [string, string];
    expect(fone).toBe("5515999990000");
    // eslint-disable-next-line no-control-regex
    expect(msg).toMatch(/^[\x00-\x7E]*$/);
    expect(msg).toContain(`${URL_APP}/exclusividades/${CAP}`);
    expect(marcas).toEqual([[1, "ok", undefined]]);
  });
  it("sem telefone, perfil inativo ou WhatsApp desligado: ignora sem enviar", async () => {
    const { d, marcas } = db([
      pend({ id: 1, telefone: null }),
      pend({ id: 2, ativo: false }),
      pend({ id: 3, quer_whatsapp: false }),
      pend({ id: 4, telefone: "123" }),
    ]);
    const send = vi.fn(async () => true);
    const r = await runClicksignAvisos(d, send, URL_APP);
    expect(send).not.toHaveBeenCalled();
    expect(r.ignorados).toBe(4);
    expect(marcas.every(([, res, e]) => res === "ignorado" && e === "sem_whatsapp")).toBe(true);
  });
  it("prazo perto de vencer com envelope já fechado/cancelado: não envia", async () => {
    const { d, marcas } = db([
      pend({ id: 1, evento: "prazo_perto", env_status: "closed" }),
      pend({ id: 2, evento: "prazo_perto", env_status: "canceled" }),
    ]);
    const send = vi.fn(async () => true);
    await runClicksignAvisos(d, send, URL_APP);
    expect(send).not.toHaveBeenCalled();
    expect(marcas).toEqual([
      [1, "ignorado", "prazo_resolvido"],
      [2, "ignorado", "prazo_resolvido"],
    ]);
  });
  it("mesmo telefone + mesmo evento na mesma captação: envia uma vez só", async () => {
    const { d, marcas } = db([pend({ id: 1 }), pend({ id: 2 })]);
    const send = vi.fn(async () => true);
    const r = await runClicksignAvisos(d, send, URL_APP);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ enviados: 1, ignorados: 1 });
    expect(marcas[1]).toEqual([2, "ignorado", "duplicado"]);
  });
  it("falha do ZionTalk conta tentativa e não para a fila", async () => {
    const { d, marcas } = db([pend({ id: 1 }), pend({ id: 2, ref_id: SALE, origem: "venda" })]);
    const send = vi
      .fn<(p: string, m: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValueOnce(false);
    const r = await runClicksignAvisos(d, send, URL_APP);
    expect(r.falhas).toBe(2);
    expect(marcas).toEqual([
      [1, "erro", "ziontalk_request_failed"],
      [2, "erro", "ziontalk_send_failed"],
    ]);
  });
  it("lembrete de prazo com erro não impede o envio da fila", async () => {
    const { d } = db([pend()], async () => Promise.reject(new Error("db")));
    const send = vi.fn(async () => true);
    const r = await runClicksignAvisos(d, send, URL_APP);
    expect(r).toMatchObject({ lembretes: 0, enviados: 1 });
  });
});

describe("texto das 4 mensagens (sem CPF, e-mail ou nome de cliente)", () => {
  const eventos = ["enviado", "finalizado", "recusado", "prazo_perto"] as const;
  it.each(eventos)("%s: título, rótulo e link; nada pessoal", (evento) => {
    const t = textoWhatsClicksign(pend({ evento }), URL_APP);
    expect(t).toContain("Captação #11111111");
    expect(t).toContain(`Acesse: ${URL_APP}/exclusividades/${CAP}`);
    expect(t).not.toMatch(/@|\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });
  it("finalizado da captação avisa que o gestor precisa aprovar; venda não", () => {
    expect(textoWhatsClicksign(pend({ evento: "finalizado" }), URL_APP)).toContain(
      "O gestor precisa aprovar a captação.",
    );
    const v = textoWhatsClicksign(
      pend({ evento: "finalizado", origem: "venda", ref_id: SALE, rotulo: "Venda ABC123" }),
      URL_APP,
    );
    expect(v).not.toContain("gestor precisa aprovar");
    expect(v).toContain(`${URL_APP}/vendas/${SALE}`);
  });
  it("modo teste marca (TESTE) no título", () => {
    expect(textoWhatsClicksign(pend({ is_test: true }), URL_APP)).toMatch(/^\*Contrato enviado para assinatura\* \(TESTE\)/);
  });
  it("texto final em ASCII para o ZionTalk", () => {
    const t = whatsappText(textoWhatsClicksign(pend({ evento: "prazo_perto" }), URL_APP));
    expect(t).toContain("Prazo da assinatura perto de vencer");
    expect(t).toContain("Captacao #11111111");
  });
});
