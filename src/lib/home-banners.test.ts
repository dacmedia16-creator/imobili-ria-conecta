// @vitest-environment jsdom
/**
 * Banner do Início (t_75786f5c). Dados fictícios.
 * - sem banner o carrossel não renderiza nada (nem espaço);
 * - com 2+ banners: bolinhas, troca sozinha a cada 5 s, clique na bolinha leva ao banner;
 * - regras de link, público (sem Fotógrafo), situação por data e tamanho padrão da arte.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const emb = vi.hoisted(() => ({
  idx: 0,
  handlers: {} as Record<string, (() => void)[]>,
  scrollNext: vi.fn(),
  scrollTo: vi.fn(),
  api: null as unknown,
}));
// A api do embla precisa ser a MESMA a cada render (como na biblioteca real); senão o Carousel entra em laço.
vi.mock("embla-carousel-react", () => ({
  default: () => {
    if (emb.api) return [() => {}, emb.api];
    const api = {
      selectedScrollSnap: () => emb.idx,
      canScrollPrev: () => true,
      canScrollNext: () => true,
      scrollPrev: vi.fn(),
      scrollNext: emb.scrollNext,
      scrollTo: (i: number) => {
        emb.scrollTo(i);
        emb.idx = i;
        (emb.handlers.select ?? []).forEach((h) => h());
      },
      on: (ev: string, h: () => void) => {
        (emb.handlers[ev] ??= []).push(h);
      },
      off: vi.fn(),
    };
    emb.api = api;
    return [() => {}, api];
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...p }: { to: string; children: unknown }) =>
    createElement("a", { href: to, "data-interno": "1", ...p }, children as never),
}));
vi.mock("@tanstack/react-start", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-start")>()),
  useServerFn: (f: unknown) => f,
}));
vi.mock("@/lib/home-banners.functions", () => ({ bannersDoInicio: vi.fn() }));

import { BannerCarrossel } from "@/components/dashboard/BannerInicio";
import {
  BANNER_ALTURA,
  BANNER_INTERVALO_MS,
  BANNER_LARGURA,
  ORIENTACAO_IMAGEM,
  extensaoBanner,
  foraDaProporcao,
  hojeSaoPaulo,
  linkBannerValido,
  papeisDoPublico,
  rotuloPublico,
  situacaoBanner,
  somarDias,
} from "@/lib/home-banners";

const B = (id: string, link: string | null = null) => ({
  id,
  titulo: `Banner ${id}`,
  link,
  url: `https://exemplo.test/${id}.jpg`,
});

beforeAll(() => {
  // jsdom não tem estes; o embla real não roda (mock), mas o Carousel pode consultar.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
beforeEach(() => {
  emb.idx = 0;
  emb.handlers = {};
  emb.scrollNext.mockReset();
  emb.scrollTo.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("carrossel do Início", () => {
  it("sem banner ativo não renderiza nada", () => {
    const { container } = render(createElement(BannerCarrossel, { banners: [] }));
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("banner-inicio")).toBeNull();
  });

  it("um banner: aparece sem bolinhas e não gira", () => {
    render(createElement(BannerCarrossel, { banners: [B("1")] }));
    expect(screen.getByTestId("banner-inicio")).toBeTruthy();
    expect(screen.getByAltText("Banner 1")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    act(() => vi.advanceTimersByTime(BANNER_INTERVALO_MS * 3));
    expect(emb.scrollNext).not.toHaveBeenCalled();
  });

  it("vários: troca sozinho a cada 5 s e as bolinhas navegam", () => {
    render(createElement(BannerCarrossel, { banners: [B("1"), B("2"), B("3")] }));
    const bolinhas = screen.getAllByRole("button");
    expect(bolinhas).toHaveLength(3);
    expect(bolinhas[0].getAttribute("aria-current")).toBe("true");
    expect(BANNER_INTERVALO_MS).toBe(5000);
    act(() => vi.advanceTimersByTime(4999));
    expect(emb.scrollNext).toHaveBeenCalledTimes(0);
    act(() => vi.advanceTimersByTime(1));
    expect(emb.scrollNext).toHaveBeenCalledTimes(1);
    act(() => fireEvent.click(bolinhas[2]));
    expect(emb.scrollTo).toHaveBeenCalledWith(2);
    expect(screen.getAllByRole("button")[2].getAttribute("aria-current")).toBe("true");
    // O clique reinicia a contagem: 4 s depois ainda não girou de novo.
    act(() => vi.advanceTimersByTime(4000));
    expect(emb.scrollNext).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(emb.scrollNext).toHaveBeenCalledTimes(2);
  });

  it("link interno usa o roteador; externo abre em outra aba com noopener; sem link não é clicável", () => {
    render(
      createElement(BannerCarrossel, {
        banners: [B("i", "/vendas"), B("e", "https://exemplo.test/campanha"), B("s")],
      }),
    );
    const interno = screen.getByLabelText("Banner i");
    expect(interno.getAttribute("href")).toBe("/vendas");
    expect(interno.getAttribute("data-interno")).toBe("1");
    const externo = screen.getByLabelText("Banner e");
    expect(externo.getAttribute("target")).toBe("_blank");
    expect(externo.getAttribute("rel")).toContain("noopener");
    expect(screen.getByAltText("Banner s").closest("a")).toBeNull();
  });

  it("arte inteira na proporção 3:1 (sem corte no celular)", () => {
    render(createElement(BannerCarrossel, { banners: [B("1")] }));
    const img = screen.getByAltText("Banner 1");
    expect(img.className).toContain("object-contain");
    expect(img.parentElement!.className).toContain("aspect-[3/1]");
  });
});

describe("regras do banner", () => {
  it("tamanho padrão documentado: 1500 × 500 (3:1), até 2 MB", () => {
    expect(BANNER_LARGURA / BANNER_ALTURA).toBe(3);
    expect(ORIENTACAO_IMAGEM).toContain("3:1");
    expect(ORIENTACAO_IMAGEM).toContain("1500 × 500");
    expect(ORIENTACAO_IMAGEM).toContain("2 MB");
    expect(foraDaProporcao(1500, 500)).toBe(false);
    expect(foraDaProporcao(1200, 400)).toBe(false);
    expect(foraDaProporcao(1080, 1080)).toBe(true);
  });

  it("links aceitos e recusados (mesma regra do banco)", () => {
    for (const ok of ["", "/vendas", "/vendas?status=x#a", "https://exemplo.test/x?y=1"])
      expect(linkBannerValido(ok), ok).toBe(true);
    for (const ruim of [
      "javascript:alert(1)",
      "//evil.test",
      "http://exemplo.test",
      "vendas",
      "/a b",
      "https://a b",
    ])
      expect(linkBannerValido(ruim), ruim).toBe(false);
  });

  it("público: todos os papéis menos Fotógrafo; vazio = Todos", () => {
    const p = papeisDoPublico().map((x) => x.valor);
    expect(p).toContain("corretor");
    expect(p).toContain("gestor");
    expect(p).toContain("team_leader");
    expect(p).not.toContain("fotografo");
    expect(rotuloPublico([])).toBe("Todos");
    expect(rotuloPublico(["corretor", "team_leader"])).toBe("Corretor, Team Leader");
  });

  it("situação pela data: agendado, no ar (início e fim inclusivos), encerrado, desativado", () => {
    const b = { ativo: true, inicio: "2026-11-10", fim: "2026-11-20" };
    expect(situacaoBanner(b, "2026-11-09")).toBe("agendado");
    expect(situacaoBanner(b, "2026-11-10")).toBe("no_ar");
    expect(situacaoBanner(b, "2026-11-20")).toBe("no_ar");
    expect(situacaoBanner(b, "2026-11-21")).toBe("encerrado");
    expect(situacaoBanner({ ...b, ativo: false }, "2026-11-15")).toBe("desativado");
  });

  it("hoje no fuso de São Paulo e soma de dias", () => {
    expect(hojeSaoPaulo(new Date("2026-11-13T02:30:00Z"))).toBe("2026-11-12");
    expect(somarDias("2026-11-30", 1)).toBe("2026-12-01");
  });

  it("extensão só para imagem aceita", () => {
    expect(extensaoBanner("image/jpeg")).toBe("jpg");
    expect(extensaoBanner("image/png")).toBe("png");
    expect(extensaoBanner("image/webp")).toBe("webp");
    expect(extensaoBanner("application/pdf")).toBeNull();
    expect(extensaoBanner("image/gif")).toBeNull();
  });

  it("Início monta o banner acima do cabeçalho “Olá”", () => {
    const fonte = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
    const banner = fonte.indexOf("<BannerInicio />");
    const cabecalho = fonte.indexOf("<PageHeader", banner);
    expect(banner).toBeGreaterThan(0);
    expect(cabecalho).toBeGreaterThan(banner);
  });

  it("servidor: toda função usa o login do usuário e só assina caminhos que o banco devolveu", () => {
    const fonte = readFileSync("src/lib/home-banners.functions.ts", "utf8");
    const fns = fonte.match(/createServerFn\(/g) ?? [];
    const mid = fonte.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? [];
    expect(fns.length).toBe(6);
    expect(mid.length).toBe(fns.length);
    // Nenhum caminho vem do navegador para leitura/remoção: só o de envio (validado pelo banco no salvar).
    expect(fonte).not.toMatch(/data\.path/);
  });
});
