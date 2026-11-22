import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _zerarContadores,
  deveIgnorar,
  montarRelato,
  navegadorResumido,
  registrarErroFront,
} from "./erros-front";
import { receberErroFront } from "./erros-front.server";

const UA_CEL =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

describe("montarRelato", () => {
  it("monta relato mascarado, sem query e com navegador resumido", () => {
    const r = montarRelato(
      "janela",
      new Error("Falhou para maria@imob.com.br tel 15 99888-7777"),
      "/clientes/3f2b1c4d-1111-2222-3333-444455556666",
      UA_CEL,
    );
    expect(r).not.toBeNull();
    expect(r!.mensagem).toBe("Falhou para [email] tel [telefone]");
    expect(r!.rota).toBe("/clientes/:id");
    expect(r!.navegador).toBe("Chrome/celular");
    expect(JSON.stringify(r)).not.toMatch(/maria|99888|Mozilla/);
  });
  it("ignora ruído de extensão e Script error", () => {
    expect(montarRelato("janela", "Script error.", "/", UA_CEL)).toBeNull();
    expect(deveIgnorar("x", "at chrome-extension://abc/x.js")).toBe(true);
    expect(deveIgnorar("ResizeObserver loop limit exceeded")).toBe(true);
    expect(deveIgnorar("TypeError: x is undefined")).toBe(false);
  });
  it("reconhece navegadores", () => {
    expect(navegadorResumido("Mozilla/5.0 (iPhone) Version/17 Mobile Safari/604.1")).toBe(
      "Safari/celular",
    );
    expect(navegadorResumido("Mozilla/5.0 (Windows) Chrome/130 Safari/537 Edg/130")).toBe(
      "Edge/computador",
    );
  });
});

describe("registrarErroFront (navegador)", () => {
  const beacon = vi.fn((_url: string, _corpo?: Blob) => true);
  beforeEach(() => {
    _zerarContadores();
    beacon.mockClear();
    vi.stubGlobal("window", { location: { pathname: "/vendas/123456" } });
    vi.stubGlobal("navigator", { userAgent: UA_CEL, sendBeacon: beacon });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("envia por sendBeacon para /api/erros-front", () => {
    expect(registrarErroFront("tela", new Error("quebrou"))).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe("/api/erros-front");
  });
  it("não repete a mesma mensagem e para em 5 por página", () => {
    registrarErroFront("tela", new Error("igual"));
    registrarErroFront("tela", new Error("igual"));
    expect(beacon).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) registrarErroFront("tela", new Error(`erro ${i}`));
    expect(beacon).toHaveBeenCalledTimes(5);
  });
  it("fora do navegador não faz nada", () => {
    vi.stubGlobal("window", undefined);
    expect(registrarErroFront("tela", new Error("x"))).toBe(false);
  });
});

describe("receberErroFront (rota /api/erros-front)", () => {
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://app.somosunihub.com.br/api/erros-front", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    });

  it("grava 1 linha mascarada de novo no servidor e responde 204", async () => {
    const linhas: string[] = [];
    const corpo = JSON.stringify({
      origem: "janela",
      nome: "TypeError",
      mensagem: "cpf 123.456.789-09 token=abc",
      rota: "/convite/AbCdEfGhIjKlMnOpQrStUvWx?x=1",
      navegador: "Chrome/celular",
      extra: "campo que não deve passar",
    });
    const r = await receberErroFront(
      req(corpo, { origin: "https://app.somosunihub.com.br" }),
      (l) => linhas.push(l),
    );
    expect(r.status).toBe(204);
    expect(linhas).toHaveLength(1);
    const j = JSON.parse(linhas[0]);
    expect(j).toMatchObject({
      tipo: "erro",
      origem: "front",
      evento: "janela",
      rota: "/convite/:id",
    });
    expect(j.mensagem).toBe("cpf [cpf] token=[oculto]");
    expect(linhas[0]).not.toContain("campo que não deve passar");
  });
  it("recusa outra origem, corpo inválido e corpo grande", async () => {
    const nada = () => {};
    expect(
      (await receberErroFront(req("{}", { origin: "https://evil.example" }), nada)).status,
    ).toBe(403);
    expect((await receberErroFront(req("não é json"), nada)).status).toBe(400);
    expect((await receberErroFront(req("[1]"), nada)).status).toBe(400);
    expect((await receberErroFront(req(JSON.stringify({ mensagem: "" })), nada)).status).toBe(400);
    const grande = JSON.stringify({ mensagem: "x".repeat(9000) });
    expect((await receberErroFront(req(grande), nada)).status).toBe(413);
  });
});
