import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enviarAvisosCorretor,
  enviarPendentes,
  responderCorretor,
} from "./leads-ia-retorno.server";

// t_637c2c20 (Denis 26/11): o aviso de lead AO CORRETOR sai pelo MESMO WhatsApp dos avisos de status de venda
// (ZIONTALK_API_KEY), não pelo chip da IA (ZIONTALK_LEADS_IA_API_KEY). As mensagens COM O LEAD continuam no chip
// da IA, senão a resposta do cliente não volta para a IA. Nenhuma mensagem real sai: fetch é sempre simulado.
const CHAVE_VENDAS = "chave-vendas";
const CHAVE_IA = "chave-ia";
const ENV = {
  LEADS_IA_ENVIO_REAL: "on",
  ZIONTALK_LEADS_IA_API_KEY: CHAVE_IA,
  ZIONTALK_API_KEY: CHAVE_VENDAS,
};
const basic = (k: string) => `Basic ${btoa(`${k}:`)}`;
const auth = (init?: RequestInit) => new Headers(init?.headers).get("Authorization");
const aviso = (texto = "Única Escolha: novo lead do C2S para você.") => ({
  data: [{ aviso_id: "a1", telefone: "15999990000", texto }],
  error: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("aviso de lead ao corretor: canal dos avisos de vendas", () => {
  it("sai com ZIONTALK_API_KEY (avisos de vendas), nunca com a chave do chip da IA", async () => {
    const global = vi.fn(
      async (_u: unknown, _i?: RequestInit) => new Response("", { status: 201 }),
    );
    vi.stubGlobal("fetch", global);
    const fetchIa = vi.fn(async () => new Response("", { status: 201 }));
    const avisoResultado = vi.fn(async () => undefined);
    const n = await enviarAvisosCorretor(null, {
      env: ENV,
      fetchFn: fetchIa as unknown as typeof fetch,
      avisosReservar: async () => aviso(),
      avisoResultado,
    });
    expect(n).toBe(1);
    expect(fetchIa).not.toHaveBeenCalled();
    expect(global).toHaveBeenCalledOnce();
    expect(auth(global.mock.calls[0][1])).toBe(basic(CHAVE_VENDAS));
    expect(auth(global.mock.calls[0][1])).not.toBe(basic(CHAVE_IA));
    const corpo = new URLSearchParams(String(global.mock.calls[0][1]?.body));
    expect(corpo.get("mobile_phone")).toBe("5515999990000");
    // mesmo tratamento dos avisos de venda: sem acento (a ZionTalk desse canal recusa acentuação)
    expect(corpo.get("msg")).toBe("Unica Escolha: novo lead do C2S para voce.");
    expect(avisoResultado).toHaveBeenCalledWith("a1", true);
  });

  it("sem ZIONTALK_API_KEY: nada sai e nada é reservado (fica pendente), sem cair no chip da IA", async () => {
    const global = vi.fn(async () => new Response("", { status: 201 }));
    vi.stubGlobal("fetch", global);
    const fetchIa = vi.fn(async () => new Response("", { status: 201 }));
    const avisosReservar = vi.fn(async () => aviso());
    const n = await enviarAvisosCorretor(null, {
      env: {
        LEADS_IA_ENVIO_REAL: "on",
        ZIONTALK_LEADS_IA_API_KEY: CHAVE_IA,
        ZIONTALK_MAX_API_KEY: "x",
      },
      fetchFn: fetchIa as unknown as typeof fetch,
      avisosReservar,
      avisoResultado: vi.fn(),
    });
    expect(n).toBe(0);
    expect(avisosReservar).not.toHaveBeenCalled();
    expect(fetchIa).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });

  it("falhou (HTTP 500 ou rede) = marca 'falhou' e não repete", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const global = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockRejectedValueOnce(new TypeError("rede"));
    vi.stubGlobal("fetch", global);
    const avisoResultado = vi.fn(async () => undefined);
    const n = await enviarAvisosCorretor(null, {
      env: ENV,
      avisosReservar: async () => ({
        data: [
          { aviso_id: "a1", telefone: "5515999990000", texto: "x" },
          { aviso_id: "a2", telefone: "5515999990000", texto: "y" },
        ],
        error: null,
      }),
      avisoResultado,
    });
    expect(n).toBe(0);
    expect(global).toHaveBeenCalledTimes(2);
    expect(avisoResultado).toHaveBeenNthCalledWith(1, "a1", false);
    expect(avisoResultado).toHaveBeenNthCalledWith(2, "a2", false);
  });
});

describe("mensagens COM O LEAD continuam no chip da IA", () => {
  it("resposta/1ª mensagem ao lead (enviarPendentes) usa ZIONTALK_LEADS_IA_API_KEY, nunca a chave de vendas", async () => {
    const global = vi.fn(async () => new Response("", { status: 201 }));
    vi.stubGlobal("fetch", global);
    const fetchIa = vi.fn(
      async (_u: unknown, _i?: RequestInit) => new Response("", { status: 201 }),
    );
    const reservar = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            msg_id: "m1",
            telefone: "5515999990000",
            texto: "Oi, aqui é a Nicole.",
            primeira: false,
          },
        ],
        error: null,
      })
      .mockResolvedValue({ data: [], error: null });
    const n = await enviarPendentes("l1", {
      env: ENV,
      fetchFn: fetchIa as unknown as typeof fetch,
      reservar,
      resultado: vi.fn(async () => undefined),
    });
    expect(n).toBe(1);
    expect(global).not.toHaveBeenCalled();
    expect(fetchIa).toHaveBeenCalledOnce();
    expect(auth(fetchIa.mock.calls[0][1])).toBe(basic(CHAVE_IA));
  });

  it("resposta ao 'ACEITO' (chegou no chip da IA) volta pelo mesmo chip da IA", async () => {
    const global = vi.fn(async () => new Response("", { status: 201 }));
    vi.stubGlobal("fetch", global);
    const fetchIa = vi.fn(
      async (_u: unknown, _i?: RequestInit) => new Response("", { status: 201 }),
    );
    const ok = await responderCorretor("5515999990000", "r1", "Lead aceito", {
      env: ENV,
      fetchFn: fetchIa as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
    expect(global).not.toHaveBeenCalled();
    expect(auth(fetchIa.mock.calls[0][1])).toBe(basic(CHAVE_IA));
  });
});
