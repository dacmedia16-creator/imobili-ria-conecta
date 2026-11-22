import { describe, expect, it } from "vitest";
import { janelaDoDiaAnterior, montarResumo, type DadosResumo } from "./resumo-erros";

const base: DadosResumo = {
  dia: "2026-11-21",
  worker: [
    { status: "success", httpStatus: 200, pedidos: 777, erros: 0 },
    { status: "success", httpStatus: 404, pedidos: 1096, erros: 0 },
    { status: "clientDisconnected", httpStatus: 404, pedidos: 299, erros: 0 },
  ],
  funcoes: [{ funcao: "clicksign-webhook", status: 200, chamadas: 64 }],
  api: [],
  logsErroFuncoes: [],
  falhasDeLeitura: [],
};

describe("montarResumo", () => {
  it("dia sem erro não gera mensagem (sem relatório vazio)", () => {
    expect(montarResumo(base)).toBeNull();
  });

  it("4xx e cliente que desconectou não contam como erro", () => {
    expect(
      montarResumo({
        ...base,
        worker: [...base.worker, { status: "success", httpStatus: 406, pedidos: 2, erros: 0 }],
      }),
    ).toBeNull();
  });

  it("5xx do Worker e exceção aparecem com contagem", () => {
    const t = montarResumo({
      ...base,
      worker: [
        ...base.worker,
        { status: "success", httpStatus: 500, pedidos: 3, erros: 0 },
        { status: "scriptThrewException", httpStatus: 500, pedidos: 2, erros: 2 },
        { status: "exceededCpu", httpStatus: 0, pedidos: 1, erros: 1 },
      ],
    })!;
    expect(t).toContain("erros de 21/11/2026");
    expect(t).toContain("Site (Worker): 6 com erro de 2178 pedidos");
    expect(t).toContain("• HTTP 500: 5");
    expect(t).toContain("• exceededCpu: 1");
  });

  it("falhas de Edge Function, log de erro e 5xx da API aparecem", () => {
    const t = montarResumo({
      ...base,
      funcoes: [
        ...base.funcoes,
        { funcao: "clicksign-send", status: 500, chamadas: 4 },
        { funcao: "clicksign-send", status: 503, chamadas: 1 },
      ],
      logsErroFuncoes: [{ funcao: "sync-satelites", quantidade: 7 }],
      api: [{ servico: "rest", status: 502, pedidos: 2 }],
    })!;
    expect(t).toContain("Edge Functions com falha (5xx): 5");
    expect(t).toContain("• clicksign-send (500): 4");
    expect(t).toContain("registraram erro no log: 7");
    expect(t).toContain("API do banco (Supabase) com 5xx: 2");
    expect(t).not.toContain("Site (Worker)");
  });

  it("fonte que não pôde ser lida gera aviso mesmo sem erro", () => {
    const t = montarResumo({
      ...base,
      falhasDeLeitura: ["Analytics do Worker (Cloudflare HTTP 403)"],
    })!;
    expect(t).toContain("Não consegui ler: Analytics do Worker (Cloudflare HTTP 403)");
  });
});

describe("janelaDoDiaAnterior", () => {
  it("dia anterior inteiro em Brasília", () => {
    // 22/11 08:00 em Brasília = 11:00 UTC
    expect(janelaDoDiaAnterior(new Date("2026-11-22T11:00:00Z"))).toEqual({
      dia: "2026-11-21",
      inicio: "2026-11-21T03:00:00Z",
      fim: "2026-11-22T03:00:00Z",
    });
  });
  it("logo após meia-noite UTC ainda é o dia anterior em Brasília", () => {
    // 22/11 01:00 UTC = 21/11 22:00 em Brasília -> resume 20/11
    expect(janelaDoDiaAnterior(new Date("2026-11-22T01:00:00Z")).dia).toBe("2026-11-20");
  });
});
