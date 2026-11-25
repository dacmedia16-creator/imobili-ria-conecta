import { describe, expect, it, vi } from "vitest";
import { consultarTodasLinhas } from "@/lib/consulta-paginada";

// t_205ec8f5: em 24/11 o gestor recebeu 57014 (statement timeout de 8 s) numa página do pacote
// financeiro e a tela inteira caiu no "Tentar de novo". Um pico isolado não pode derrubar a carga:
// a mesma página é repetida UMA vez. Qualquer outro erro (ou um 2º timeout) continua falhando,
// para nunca publicar um total incompleto (zero falso).
const TIMEOUT = { code: "57014", message: "canceling statement due to statement timeout" };

function paginas(
  respostas: Array<{ data: number[] | null; error: unknown; count: number | null }>,
) {
  const fn = vi.fn(async (_a: number, _b: number) => {
    const r = respostas.shift();
    if (!r) throw new Error("página extra não esperada");
    return r as { data: number[] | null; error: { message: string } | null; count: number | null };
  });
  return fn;
}

describe("consultarTodasLinhas — nova tentativa em statement timeout", () => {
  it("repete uma vez a página que falhou com 57014 e devolve as linhas", async () => {
    const pagina = paginas([
      { data: null, error: TIMEOUT, count: null },
      { data: [1, 2], error: null, count: 2 },
    ]);
    await expect(consultarTodasLinhas("comissões", pagina, 500)).resolves.toEqual([1, 2]);
    expect(pagina).toHaveBeenCalledTimes(2);
    expect(pagina.mock.calls[1]).toEqual([0, 499]); // a MESMA página
  });

  it("repete só a página que falhou, não as anteriores", async () => {
    const pagina = paginas([
      { data: [1, 2], error: null, count: 3 },
      { data: null, error: TIMEOUT, count: null },
      { data: [3], error: null, count: 3 },
    ]);
    await expect(consultarTodasLinhas("parcerias", pagina, 2)).resolves.toEqual([1, 2, 3]);
    expect(pagina.mock.calls.map((c) => c[0])).toEqual([0, 2, 2]);
  });

  it("dois timeouts seguidos na mesma página: falha (sem zero falso, sem laço infinito)", async () => {
    const pagina = paginas([
      { data: null, error: TIMEOUT, count: null },
      { data: null, error: TIMEOUT, count: null },
    ]);
    await expect(consultarTodasLinhas("comissões", pagina)).rejects.toThrow(
      /Dados financeiros incompletos \(comissões\)/,
    );
    expect(pagina).toHaveBeenCalledTimes(2);
  });

  it("outro erro (ex.: permissão) não é repetido", async () => {
    const pagina = paginas([
      { data: null, error: { code: "42501", message: "permission denied" }, count: null },
    ]);
    await expect(consultarTodasLinhas("comissões", pagina)).rejects.toThrow(/permission denied/);
    expect(pagina).toHaveBeenCalledTimes(1);
  });
});
