// @vitest-environment jsdom
// Salvamento automático da captação (igual às Vendas) + envio ao gestor depois do autosave
// (pedido de Denis 19/10, t_487ca876).
import { useCallback, useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_BROKER_INVALIDO, useCaptureAutosave } from "./useCaptureAutosave";
import { emptyForm, type CaptureForm } from "@/lib/exclusive-captures";

const CPF_OK = "529.982.247-25";
const DELAY = 1200;

type Persist = (f: CaptureForm, cpf: string, creci: string) => Promise<void>;

function harness(persist: Persist, initial: { enabled?: boolean } = {}) {
  return renderHook(() => {
    const [form, setForm] = useState<CaptureForm>(() => emptyForm());
    const [dirty, setDirty] = useState(false);
    const [cpf, setCpf] = useState(CPF_OK);
    const [creci, setCreci] = useState("12345-F");
    const [enabled, setEnabled] = useState(initial.enabled ?? true);
    const onSaved = useCallback(() => setDirty(false), []);
    const auto = useCaptureAutosave({
      enabled,
      dirty,
      form,
      cpf,
      creci,
      savedCpf: CPF_OK,
      savedCreci: "12345-F",
      persist,
      onSaved,
    });
    const marcarPlano = (ids: string[]) => {
      setForm((f) => ({ ...f, dossie: ids }));
      setDirty(true);
    };
    const digitar = (nome: string) => {
      setForm((f) => ({ ...f, proprietario_1: { ...f.proprietario_1, nome_completo: nome } }));
      setDirty(true);
    };
    // Preenchimento da IA: a página grava direto e deixa dirty=false (não é edição pendente).
    const iaPreencheu = (nome: string) => {
      setForm((f) => ({ ...f, proprietario_1: { ...f.proprietario_1, nome_completo: nome } }));
      setDirty(false);
    };
    return { auto, form, dirty, marcarPlano, digitar, iaPreencheu, setCpf, setCreci, setEnabled };
  });
}

const flushPromises = () => act(async () => {});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("captação: salvamento automático", () => {
  it("marcar o Plano de Marketing salva sozinho e zera as alterações pendentes", async () => {
    const persist = vi.fn<Persist>().mockResolvedValue();
    const { result } = harness(persist);
    act(() => result.current.marcarPlano(["acao-1"]));
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].dossie).toEqual(["acao-1"]);
    expect(result.current.dirty).toBe(false);
    expect(result.current.auto.saved).toBe(true);
    expect(result.current.auto.error).toBeNull();
  });

  it("não salva no meio da digitação: espera parar e grava só o valor final", async () => {
    const persist = vi.fn<Persist>().mockResolvedValue();
    const { result } = harness(persist);
    for (const nome of ["M", "Ma", "Mar", "Maria"]) {
      act(() => result.current.digitar(nome));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    }
    expect(persist).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].proprietario_1.nome_completo).toBe("Maria");
  });

  it("edição feita durante um save não se perde: continua pendente e salva de novo", async () => {
    let resolve!: () => void;
    const persist = vi
      .fn<Persist>()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolve = r)))
      .mockResolvedValue();
    const { result } = harness(persist);
    act(() => result.current.digitar("Ana"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(persist).toHaveBeenCalledTimes(1);
    act(() => result.current.digitar("Ana Paula"));
    await act(async () => {
      resolve();
    });
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0].proprietario_1.nome_completo).toBe("Ana Paula");
    expect(result.current.dirty).toBe(false);
  });

  it("CPF do captador inválido não quebra o save: grava o resto com o CPF salvo e avisa", async () => {
    const persist = vi.fn<Persist>().mockResolvedValue();
    const { result } = harness(persist);
    act(() => {
      result.current.setCpf("111.111.111-1");
      result.current.marcarPlano(["acao-1"]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].dossie).toEqual(["acao-1"]);
    expect(persist.mock.calls[0][1]).toBe(CPF_OK);
    expect(result.current.auto.bloqueio).toBe(AUTOSAVE_BROKER_INVALIDO);
    // CPF inválido continua como alteração pendente (não some da tela).
    expect(result.current.dirty).toBe(true);
  });

  it("erro do save fica visível e persistente até um save dar certo", async () => {
    const persist = vi
      .fn<Persist>()
      .mockRejectedValueOnce(new Error("Edição não autorizada"))
      .mockResolvedValue();
    const { result } = harness(persist);
    act(() => result.current.marcarPlano(["acao-1"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(result.current.auto.error).toBe("Edição não autorizada");
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY * 3);
    });
    expect(result.current.auto.error).toBe("Edição não autorizada");
    act(() => result.current.marcarPlano(["acao-1", "acao-2"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(result.current.auto.error).toBeNull();
    expect(result.current.dirty).toBe(false);
  });

  it("preenchimento da IA (já gravado, dirty=false) não dispara autosave em loop", async () => {
    const persist = vi.fn<Persist>().mockResolvedValue();
    const { result } = harness(persist);
    act(() => result.current.iaPreencheu("João da Silva"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY * 5);
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("captação não editável (ou ação em andamento) não é salva", async () => {
    const persist = vi.fn<Persist>().mockResolvedValue();
    const { result } = harness(persist, { enabled: false });
    act(() => result.current.marcarPlano(["acao-1"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY * 3);
    });
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("captação: envio ao gestor depois do autosave", () => {
  it("enviar logo após marcar o Plano grava antes (sem esperar o timer) e não salva em dobro", async () => {
    const persist = vi.fn<Persist>().mockResolvedValue();
    const { result } = harness(persist);
    act(() => result.current.marcarPlano(["acao-1"]));
    await act(async () => {
      await result.current.auto.flush();
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].dossie).toEqual(["acao-1"]);
    expect(result.current.dirty).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY * 2);
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("enviar com autosave em andamento espera ele terminar antes de seguir", async () => {
    let resolve!: () => void;
    const order: string[] = [];
    const persist = vi.fn<Persist>().mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolve = () => {
            order.push("autosave");
            r();
          };
        }),
    );
    const { result } = harness(persist);
    act(() => result.current.marcarPlano(["acao-1"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    let done = false;
    const p = result.current.auto.flush().then(() => {
      order.push("enviar");
      done = true;
    });
    await flushPromises();
    expect(done).toBe(false);
    await act(async () => {
      resolve();
      await p;
    });
    expect(order).toEqual(["autosave", "enviar"]);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("sem nada pendente, o envio não grava nada", async () => {
    const persist = vi.fn<Persist>().mockResolvedValue();
    const { result } = harness(persist);
    await act(async () => {
      await result.current.auto.flush();
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("erro ao gravar no envio interrompe o envio (a RPC exclusive_transition não roda)", async () => {
    const persist = vi.fn<Persist>().mockRejectedValue(new Error("Dados inválidos"));
    const { result } = harness(persist);
    act(() => result.current.marcarPlano(["acao-1"]));
    await expect(
      act(async () => {
        await result.current.auto.flush();
      }),
    ).rejects.toThrow("Dados inválidos");
    expect(result.current.dirty).toBe(true);
  });
});
