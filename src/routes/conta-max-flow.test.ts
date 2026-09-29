import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryContaMaxLogin, startContaMaxBridge, type ContaMaxErrorCode } from "./conta-max-flow";

const tokens = { access_token: "access-secret", refresh_token: "refresh-secret" };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const setup = (overrides: Partial<Parameters<typeof startContaMaxBridge>[0]> = {}) => {
  const onError = vi.fn();
  const navigate = vi.fn(async () => {});
  const setSession = vi.fn(async () => ({ error: null }));
  const invoke = vi.fn(async () => ({ data: tokens, error: null }));
  const stop = startContaMaxBridge({
    ticket: "private-ticket",
    returnTo: null,
    invoke,
    setSession,
    navigate,
    onError,
    ...overrides,
  });
  return { onError, navigate, setSession, invoke, stop };
};
const check = (onError: ReturnType<typeof vi.fn>, code: ContaMaxErrorCode) => {
  expect(onError).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledWith({ code, message: expect.any(String), at: expect.any(Date) });
  const failure = onError.mock.calls[0][0];
  expect(JSON.stringify(failure)).not.toMatch(/private-ticket|access-secret|refresh-secret|@/);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ponte Conta MAX", () => {
  it("encerra a espera da ponte após 15 s e ignora resposta tardia", async () => {
    const pending = deferred<{ data: typeof tokens; error: null }>();
    const flow = setup({ invoke: () => pending.promise });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(flow.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    check(flow.onError, "TIMEOUT_PONTE");
    expect(flow.onError.mock.calls[0][0].at).toEqual(new Date("2026-09-29T12:00:15Z"));
    pending.resolve({ data: tokens, error: null });
    await Promise.resolve();
    expect(flow.setSession).not.toHaveBeenCalled();
    expect(flow.navigate).not.toHaveBeenCalled();
  });

  it("distingue espera da criação de sessão e não navega após expirar", async () => {
    const pending = deferred<{ error: null }>();
    const flow = setup({ setSession: () => pending.promise });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15_000);
    check(flow.onError, "TIMEOUT_SESSAO");
    pending.resolve({ error: null });
    await Promise.resolve();
    expect(flow.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["SEM_TICKET", { ticket: null }],
    ["PONTE_401", { invoke: async () => ({ data: null, error: { context: { status: 401 } } }) }],
    ["PONTE_ERRO", { invoke: async () => ({ data: null, error: { context: { status: 503 } } }) }],
    [
      "SEM_TOKEN",
      { invoke: async () => ({ data: { access_token: "access-secret" }, error: null }) },
    ],
    ["SESSAO_ERRO", { setSession: async () => ({ error: new Error("private-ticket") }) }],
  ] as const)("informa %s sem dados sensíveis", async (code, overrides) => {
    const flow = setup(overrides);
    await Promise.resolve();
    await Promise.resolve();
    check(flow.onError, code);
    expect(flow.navigate).not.toHaveBeenCalled();
  });

  it("converte rejeições da ponte e sessão em códigos e cessa a espera", async () => {
    const ponte = setup({
      invoke: async () => {
        throw new Error("private-ticket");
      },
    });
    await Promise.resolve();
    check(ponte.onError, "PONTE_ERRO");
    const sessao = setup({
      setSession: async () => {
        throw new Error("access-secret");
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    check(sessao.onError, "SESSAO_ERRO");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ponte.onError).toHaveBeenCalledOnce();
    expect(sessao.onError).toHaveBeenCalledOnce();
  });

  it("mantém o destino permitido e cancela timer ao concluir ou desmontar", async () => {
    const success = setup({ returnTo: "/reservas-salas" });
    await Promise.resolve();
    await Promise.resolve();
    expect(success.navigate).toHaveBeenCalledWith("/reservas-salas");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(success.onError).not.toHaveBeenCalled();
    const blocked = setup({ returnTo: "https://evil.invalid" });
    blocked.stop();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(blocked.navigate).not.toHaveBeenCalled();
    expect(blocked.onError).not.toHaveBeenCalled();
  });
});

describe("Tentar de novo", () => {
  it("remove somente a sessão local, não espera signOut travado e recomeça na Conta MAX", () => {
    const storage = { removeItem: vi.fn() };
    const signOut = vi.fn(() => new Promise<void>(() => {}));
    const replace = vi.fn();
    retryContaMaxLogin({
      supabaseUrl: "https://example.supabase.co",
      homolog: false,
      returnTo: "/reservas-salas",
      storage,
      signOut,
      replace,
    });
    expect(storage.removeItem).toHaveBeenCalledWith("sb-example-auth-token");
    expect(signOut).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledOnce();
    const url = new URL(replace.mock.calls[0][0]);
    expect(url.searchParams.get("app")).toBe("adm-max");
    expect(url.searchParams.get("return_to")).toBe("/reservas-salas");
    expect(url.searchParams.has("ticket")).toBe(false);
  });

  it("reinicia homologação em seu próprio app, sem aceitar destino arbitrário", () => {
    const replace = vi.fn();
    retryContaMaxLogin({
      supabaseUrl: undefined,
      homolog: true,
      returnTo: "https://evil.invalid",
      storage: { removeItem: vi.fn() },
      signOut: async () => {},
      replace,
    });
    const url = new URL(replace.mock.calls[0][0]);
    expect(url.searchParams.get("app")).toBe("adm-max-homolog");
    expect(url.searchParams.has("return_to")).toBe(false);
  });
});
