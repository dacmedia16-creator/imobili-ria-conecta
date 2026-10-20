import { describe, expect, it, vi } from "vitest";
import { criarCacheConsultas } from "./cache-consultas";

describe("cache curto de consultas", () => {
  it("chamadas simultâneas com a mesma chave reaproveitam a mesma requisição", async () => {
    const cache = criarCacheConsultas(60_000);
    const consulta = vi.fn(async () => 42);
    const [a, b] = await Promise.all([cache.buscar("k", consulta), cache.buscar("k", consulta)]);
    expect([a, b]).toEqual([42, 42]);
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("busca de novo depois da validade e depois de limpar", async () => {
    let agora = 0;
    const cache = criarCacheConsultas(60_000, () => agora);
    const consulta = vi.fn(async () => "ok");
    await cache.buscar("k", consulta);
    agora = 59_999;
    await cache.buscar("k", consulta);
    expect(consulta).toHaveBeenCalledTimes(1);
    agora = 60_000;
    await cache.buscar("k", consulta);
    expect(consulta).toHaveBeenCalledTimes(2);
    cache.limpar();
    await cache.buscar("k", consulta);
    expect(consulta).toHaveBeenCalledTimes(3);
  });

  it("erro não fica guardado: a próxima chamada tenta de novo", async () => {
    const cache = criarCacheConsultas(60_000);
    const consulta = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("falhou"))
      .mockResolvedValueOnce("ok");
    await expect(cache.buscar("k", consulta)).rejects.toThrow("falhou");
    await expect(cache.buscar("k", consulta)).resolves.toBe("ok");
    expect(consulta).toHaveBeenCalledTimes(2);
  });
});
