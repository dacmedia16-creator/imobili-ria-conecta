import { describe, expect, it, vi } from "vitest";
import { receberTesteAvisos } from "./avisos-teste.server";

const SEG = "s".repeat(40);
const req = (seg?: string, method = "POST") =>
  new Request("https://x/api/avisos-exclusividade/teste", {
    method,
    headers: seg ? { "x-avisos-teste-segredo": seg } : {},
    body: method === "POST" ? JSON.stringify({ telefone: "5511999999999" }) : undefined,
  });

describe("teste de WhatsApp dos avisos (t_5f295777)", () => {
  it("sem segredo no servidor = desligado (404), não envia", async () => {
    const whatsapp = vi.fn();
    const r = await receberTesteAvisos(req(SEG), { env: { ZIONTALK_API_KEY: "k", AVISOS_TESTE_TELEFONE: "15999990000" }, whatsapp });
    expect(r.status).toBe(404);
    expect(whatsapp).not.toHaveBeenCalled();
  });
  it("segredo curto ou errado = 404", async () => {
    const whatsapp = vi.fn();
    const env = { ZIONTALK_API_KEY: "k", AVISOS_TESTE_TELEFONE: "15999990000" };
    expect((await receberTesteAvisos(req("x"), { env: { ...env, AVISOS_TESTE_SEGREDO: "curto" }, whatsapp })).status).toBe(404);
    expect((await receberTesteAvisos(req("y".repeat(40)), { env: { ...env, AVISOS_TESTE_SEGREDO: SEG }, whatsapp })).status).toBe(404);
    expect(whatsapp).not.toHaveBeenCalled();
  });
  it("envia 1 mensagem só para o número do secret (ignora o corpo) pela ZIONTALK_API_KEY", async () => {
    const whatsapp = vi.fn().mockResolvedValue(true);
    const r = await receberTesteAvisos(req(SEG), {
      env: { ZIONTALK_API_KEY: "chave-adm", AVISOS_TESTE_TELEFONE: "15999990000", AVISOS_TESTE_SEGREDO: SEG },
      whatsapp,
    });
    expect(r.status).toBe(200);
    expect(whatsapp).toHaveBeenCalledTimes(1);
    expect(whatsapp.mock.calls[0][0]).toBe("chave-adm");
    expect(whatsapp.mock.calls[0][1]).toBe("5515999990000");
    expect(whatsapp.mock.calls[0][2]).toMatch(/^\*TESTE ADM MAX/);
    expect(whatsapp.mock.calls[0][2]).toMatch(/^[\x00-\x7E]*$/);
  });
  it("sem telefone ou chave = 503; GET = 405", async () => {
    const whatsapp = vi.fn();
    expect((await receberTesteAvisos(req(SEG), { env: { AVISOS_TESTE_SEGREDO: SEG, ZIONTALK_API_KEY: "k" }, whatsapp })).status).toBe(503);
    expect((await receberTesteAvisos(req(SEG, "GET"), { env: {}, whatsapp })).status).toBe(405);
    expect(whatsapp).not.toHaveBeenCalled();
  });
});
