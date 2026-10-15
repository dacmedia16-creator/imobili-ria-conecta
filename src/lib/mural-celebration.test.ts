// @vitest-environment jsdom
import { createElement, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MuralCelebration,
  type RealtimeEvent,
  type SubscribeFn,
} from "@/components/mural/MuralCelebration";
import {
  CELEBRATION_DURATION_MS,
  celebrationPeopleText,
  parseCelebrationPost,
  readSeen,
  shouldCelebrate,
} from "@/lib/mural-celebration";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const USER = "00000000-0000-4000-8000-0000000000u1";

const post = (over: Record<string, unknown> = {}) => ({
  id: "post-1",
  organization_id: ORG_A,
  sale_id: "sale-1",
  captador_nome: "Ana Teste",
  vendedor_nome: "Caio Teste",
  coordenador_nome: "Bia Broker",
  tipo_imovel: "Casa",
  bairro: "Campolim",
  cidade: "Sorocaba",
  ativo: true,
  // campos que NUNCA podem aparecer no aviso, mesmo se vierem no payload
  valor_negociado: 987654.32,
  comissao: 12345.67,
  cliente_nome: "Cliente Secreto",
  ...over,
});
const insert = (over: Record<string, unknown> = {}): RealtimeEvent => ({
  eventType: "INSERT",
  new: post(over),
});

/** Canal falso: guarda o callback para o teste "emitir" eventos do Realtime. */
function fakeChannel() {
  const listeners = new Map<string, (e: RealtimeEvent) => void>();
  const unsubscribed: string[] = [];
  const subscribe: SubscribeFn = vi.fn((org, cb) => {
    listeners.set(org, cb);
    return () => {
      listeners.delete(org);
      unsubscribed.push(org);
    };
  });
  const emit = (org: string, e: RealtimeEvent) => act(() => listeners.get(org)?.(e));
  return { subscribe, emit, listeners, unsubscribed };
}

type Over = Partial<Parameters<typeof MuralCelebration>[0]>;
function setup(over: Over = {}) {
  const ch = fakeChannel();
  const fireConfetti = vi.fn();
  const onMute = vi.fn();
  const props = {
    userId: USER,
    organizationId: ORG_A,
    enabled: true,
    muted: false,
    subscribe: ch.subscribe,
    fireConfetti,
    onMute,
    ...over,
  };
  const view = render(createElement(MuralCelebration, props));
  return { ...ch, fireConfetti, onMute, view, props };
}

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduce && q.includes("reduce"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  mockReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("regras puras", () => {
  it("mostra só nomes e papéis; nunca valor, comissão nem cliente", () => {
    const p = parseCelebrationPost(post())!;
    expect(celebrationPeopleText(p)).toBe(
      "Captador: Ana Teste · Vendedor: Caio Teste · Coordenador/Broker: Bia Broker",
    );
    const s = JSON.stringify(p);
    expect(s).not.toContain("987654");
    expect(s).not.toContain("12345");
    expect(s).not.toContain("Cliente Secreto");
  });

  it("coordenador é opcional", () => {
    const p = parseCelebrationPost(post({ coordenador_nome: null }))!;
    expect(p.pessoas.map((x) => x.papel)).toEqual(["Captador", "Vendedor"]);
  });

  it("revogado (ativo=false) e UPDATE não comemoram", () => {
    const gate = { enabled: true, muted: false, organizationId: ORG_A, seen: new Set<string>() };
    expect(shouldCelebrate(insert({ ativo: false }), gate)).toBeNull();
    expect(shouldCelebrate({ eventType: "UPDATE", new: post() }, gate)).toBeNull();
    expect(shouldCelebrate(insert(), gate)?.id).toBe("post-1");
  });

  it("evento de outra imobiliária é ignorado (2ª trava além da RLS)", () => {
    const gate = { enabled: true, muted: false, organizationId: ORG_A, seen: new Set<string>() };
    expect(shouldCelebrate(insert({ organization_id: ORG_B }), gate)).toBeNull();
  });
});

describe("<MuralCelebration />", () => {
  it("dispara uma vez por conquista e persiste o ID visto por usuário", () => {
    const { emit, fireConfetti } = setup();
    emit(ORG_A, insert());
    expect(fireConfetti).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("mural-celebration").textContent).toContain("Captador: Ana Teste");
    expect(screen.getByTestId("mural-celebration").textContent).not.toContain("Cliente Secreto");
    emit(ORG_A, insert()); // mesmo post de novo (ex.: outra aba, reconexão)
    expect(fireConfetti).toHaveBeenCalledTimes(1);
    expect(readSeen(USER).has("post-1")).toBe(true);
    // Depois de recarregar a página (novo componente), continua sem repetir.
    cleanup();
    const again = setup();
    again.emit(ORG_A, insert());
    expect(again.fireConfetti).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mural-celebration")).toBeNull();
  });

  it("não dispara com o aviso silenciado", () => {
    const { emit, fireConfetti } = setup({ muted: true });
    emit(ORG_A, insert());
    expect(fireConfetti).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mural-celebration")).toBeNull();
  });

  it("não assina nem dispara com o módulo desligado", () => {
    const { subscribe, listeners, fireConfetti } = setup({ enabled: false });
    expect(subscribe).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(fireConfetti).not.toHaveBeenCalled();
  });

  it("não dispara para evento revogado", () => {
    const { emit, fireConfetti } = setup();
    emit(ORG_A, insert({ ativo: false }));
    emit(ORG_A, { eventType: "UPDATE", new: post({ id: "post-2" }) });
    expect(fireConfetti).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mural-celebration")).toBeNull();
  });

  it("fecha sozinho em cerca de 4 s", () => {
    vi.useFakeTimers();
    const { emit } = setup();
    emit(ORG_A, insert());
    expect(screen.getByTestId("mural-celebration")).toBeTruthy();
    expect(CELEBRATION_DURATION_MS).toBe(4000);
    act(() => vi.advanceTimersByTime(3900));
    expect(screen.queryByTestId("mural-celebration")).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByTestId("mural-celebration")).toBeNull();
  });

  it("botão de fechar some com o aviso; silenciar chama onMute", () => {
    const { emit, onMute } = setup();
    emit(ORG_A, insert());
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByTestId("mural-celebration")).toBeNull();
    emit(ORG_A, insert({ id: "post-2" }));
    fireEvent.click(screen.getByRole("button", { name: /Silenciar comemorações/ }));
    expect(onMute).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("mural-celebration")).toBeNull();
  });

  it("não tira o foco de um input em edição nem apaga o texto", () => {
    const ch = fakeChannel();
    function Form() {
      const [v, setV] = useState("");
      return createElement(
        "div",
        null,
        createElement("input", {
          "aria-label": "campo",
          value: v,
          onChange: (e: { target: { value: string } }) => setV(e.target.value),
        }),
        createElement(MuralCelebration, {
          userId: USER,
          organizationId: ORG_A,
          enabled: true,
          muted: false,
          subscribe: ch.subscribe,
          fireConfetti: () => {},
          onMute: () => {},
        }),
      );
    }
    render(createElement(Form));
    const input = screen.getByLabelText("campo") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "Rua das Flores, 12" } });
    ch.emit(ORG_A, insert());
    expect(screen.getByTestId("mural-celebration")).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Rua das Flores, 12");
    // Sem modal: nada com role=dialog nem aria-modal.
    expect(document.querySelector('[role="dialog"],[aria-modal="true"]')).toBeNull();
  });

  it("respeita prefers-reduced-motion: mostra o aviso sem confete", () => {
    mockReducedMotion(true);
    const { emit, fireConfetti } = setup();
    emit(ORG_A, insert());
    expect(fireConfetti).not.toHaveBeenCalled();
    expect(screen.getByTestId("mural-celebration")).toBeTruthy();
  });

  it("troca de imobiliária e logout cancelam a assinatura", () => {
    const { view, props, subscribe, unsubscribed, listeners } = setup();
    expect(subscribe).toHaveBeenCalledWith(ORG_A, expect.any(Function));
    view.rerender(createElement(MuralCelebration, { ...props, organizationId: ORG_B }));
    expect(unsubscribed).toEqual([ORG_A]);
    expect([...listeners.keys()]).toEqual([ORG_B]);
    view.rerender(
      createElement(MuralCelebration, { ...props, organizationId: ORG_B, userId: null }),
    );
    expect(unsubscribed).toEqual([ORG_A, ORG_B]);
    expect(listeners.size).toBe(0);
  });
});
