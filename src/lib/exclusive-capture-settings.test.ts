import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { readExclusiveSetting, setExclusiveSetting } from "./exclusive-capture-settings";

describe("RPC de configurações", () => {
  beforeEach(() => rpc.mockReset());

  it("lê o estado real (sem converter erro em desligado)", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(readExclusiveSetting()).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("exclusive_capture_enabled");
    rpc.mockResolvedValueOnce({ data: null, error: new Error("sem conexão") });
    await expect(readExclusiveSetting()).rejects.toThrow("sem conexão");
  });

  it("desliga pela RPC mesmo com a flag desligada; nunca escreve na tabela pelo cliente", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(setExclusiveSetting(false)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("exclusive_capture_set_enabled", { _enabled: false });
  });

  it("não confirma sucesso quando a RPC falha ou diverge", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("acesso negado") });
    await expect(setExclusiveSetting(true)).rejects.toThrow("acesso negado");
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(setExclusiveSetting(true)).rejects.toThrow("Não foi possível confirmar");
  });
});
