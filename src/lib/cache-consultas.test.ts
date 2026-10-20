import { describe, expect, it, vi } from "vitest";
import { criarCacheConsultas, ehErroDePermissao } from "./cache-consultas";

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
    const cache = criarCacheConsultas(60_000, { agora: () => agora });
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

  it("erro de permissão (42501/403) fica guardado pelo mesmo tempo do cache", async () => {
    let agora = 0;
    const cache = criarCacheConsultas(60_000, {
      agora: () => agora,
      guardarErro: ehErroDePermissao,
    });
    const negado = { code: "42501", message: "Acesso não autorizado" };
    const consulta = vi.fn<() => Promise<string>>().mockRejectedValue(negado);
    await expect(cache.buscar("k", consulta)).rejects.toBe(negado);
    agora = 59_999;
    await expect(cache.buscar("k", consulta)).rejects.toBe(negado);
    expect(consulta).toHaveBeenCalledTimes(1);
    agora = 60_000;
    await expect(cache.buscar("k", consulta)).rejects.toBe(negado);
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it("outros erros continuam sem cache mesmo com guardarErro configurado", async () => {
    const cache = criarCacheConsultas(60_000, { guardarErro: ehErroDePermissao });
    const consulta = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: "57014", message: "timeout" })
      .mockResolvedValueOnce("ok");
    await expect(cache.buscar("k", consulta)).rejects.toMatchObject({ code: "57014" });
    await expect(cache.buscar("k", consulta)).resolves.toBe("ok");
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it("ehErroDePermissao reconhece 42501 e status 403", () => {
    expect(ehErroDePermissao({ code: "42501" })).toBe(true);
    expect(ehErroDePermissao({ status: 403 })).toBe(true);
    expect(ehErroDePermissao({ code: "PGRST301" })).toBe(false);
    expect(ehErroDePermissao(new Error("falhou"))).toBe(false);
    expect(ehErroDePermissao(null)).toBe(false);
  });
});
