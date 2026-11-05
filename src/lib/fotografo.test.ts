import { describe, expect, it } from "vitest";
import {
  abaFotografo,
  destinoFotografo,
  ehSoFotografo,
  ENTRADA_FOTOGRAFO,
  rotaPermitidaFotografo,
} from "./fotografo";
import { itensVisiveis, montarMenuLateral, type MenuContexto } from "./menu-lateral";
import { grantableRoles } from "./user-management-policy";
import { mensagemErroFoto } from "./vouchers-fotos";

// Papel Fotógrafo (t_0666d3f0 / t_fb0f919b — PR #269). Denis 05/11/2026: "é só fotógrafo".

const ctx = (roles: string[], extra: Partial<MenuContexto> = {}): MenuContexto => ({
  roles,
  platformAdmin: false,
  exclusiveVisible: true,
  roomVisible: true,
  feedbackVisible: true,
  opportunitiesVisible: true,
  achievementsVisible: true,
  leadsVisible: true,
  crmVisible: true,
  fotosVisible: true,
  carreiraVisible: true,
  ...extra,
});

describe("ehSoFotografo", () => {
  it("só o papel fotografo, sozinho", () => {
    expect(ehSoFotografo(["fotografo"])).toBe(true);
    expect(ehSoFotografo(["fotografo", "fotografo"])).toBe(true);
  });
  it("com qualquer outro papel deixa de ser só-fotógrafo", () => {
    expect(ehSoFotografo(["fotografo", "corretor"])).toBe(false);
    expect(ehSoFotografo(["fotografo", "admin"])).toBe(false);
    expect(ehSoFotografo(["staff"])).toBe(false);
    expect(ehSoFotografo([])).toBe(false);
  });
});

describe("destinoFotografo (guarda de rota)", () => {
  it("manda o só-fotógrafo para /fotografo fora das rotas liberadas", () => {
    for (const p of [
      "/dashboard",
      "/vendas",
      "/exclusividades",
      "/financeiro",
      "/minha-carreira",
      "/reserva-salas",
      "/mural",
      "/admin/usuarios",
      "/agendar-fotos",
      "/",
    ])
      expect(destinoFotografo(["fotografo"], p)).toBe(ENTRADA_FOTOGRAFO);
  });
  it("deixa abrir /fotografo, notificações, perfil e ajuda (com subpáginas)", () => {
    for (const p of [
      "/fotografo",
      "/fotografo/",
      "/notificacoes",
      "/perfil",
      "/ajuda",
      "/ajuda/wiki",
    ])
      expect(destinoFotografo(["fotografo"], p)).toBeNull();
    expect(rotaPermitidaFotografo("/fotografos")).toBe(false);
    expect(rotaPermitidaFotografo("/ajudante")).toBe(false);
  });
  it("não mexe em quem tem outro papel", () => {
    expect(destinoFotografo(["corretor"], "/vendas")).toBeNull();
    expect(destinoFotografo(["fotografo", "admin"], "/vendas")).toBeNull();
    expect(destinoFotografo([], "/vendas")).toBeNull();
  });
});

describe("abaFotografo (search ?aba=)", () => {
  it("aceita só as três abas", () => {
    expect(abaFotografo("sessoes")).toBe("sessoes");
    expect(abaFotografo("faixas")).toBe("faixas");
    expect(abaFotografo("historico")).toBe("historico");
    expect(abaFotografo("vendas")).toBeUndefined();
    expect(abaFotografo(undefined)).toBeUndefined();
  });
});

describe("menu reduzido do só-fotógrafo", () => {
  it("mostra só Fotos (Agenda/Sessões/Histórico) e a conta, mesmo com todos os módulos ligados", () => {
    const menu = montarMenuLateral(ctx(["fotografo"]));
    expect(menu.map((g) => g.label)).toEqual(["Fotos", "Conta e acesso"]);
    const fotos = menu[0].items.map((i) => [i.label, i.to, i.search]);
    expect(fotos).toEqual([
      ["Agenda", "/fotografo", { aba: "faixas" }],
      ["Sessões", "/fotografo", { aba: "sessoes" }],
      ["Histórico", "/fotografo", { aba: "historico" }],
    ]);
    const itens = itensVisiveis(menu);
    expect(new Set(itens)).toEqual(new Set(["/fotografo", "/notificacoes", "/perfil", "/ajuda"]));
    for (const proibido of [
      "/dashboard",
      "/vendas",
      "/exclusividades",
      "/minha-carreira",
      "/agendar-fotos",
      "/reserva-salas",
      "/mural",
    ])
      expect(itens).not.toContain(proibido);
    // Todo item do menu abre sem cair na guarda.
    for (const to of itens) expect(destinoFotografo(["fotografo"], to)).toBeNull();
  });
  it("também com a plataforma marcada não vaza item (o papel manda)", () => {
    const itens = itensVisiveis(montarMenuLateral(ctx(["fotografo"], { fotosVisible: false })));
    expect(itens).not.toContain("/vendas");
    expect(itens).toContain("/fotografo");
  });
  it("quem tem outro papel junto continua com o menu normal", () => {
    const itens = itensVisiveis(montarMenuLateral(ctx(["fotografo", "corretor"])));
    expect(itens).toContain("/vendas");
    expect(itens).toContain("/dashboard");
  });
});

describe("cadastro: quem concede o papel Fotógrafo", () => {
  it("admin, administrador principal e plataforma concedem; gestor/TL não", () => {
    expect(grantableRoles(["admin"])).toContain("fotografo");
    expect(grantableRoles(["super_admin"])).toContain("fotografo");
    expect(grantableRoles([], { isPlatformAdmin: true })).toContain("fotografo");
    expect(grantableRoles(["gestor"])).not.toContain("fotografo");
    expect(grantableRoles(["team_leader"])).not.toContain("fotografo");
    expect(grantableRoles(["corretor"])).toEqual([]);
  });
});

describe("Configurações: erro do banco ao escolher o fotógrafo", () => {
  it("casa a mensagem nova (staff ou fotografo ativo) e a antiga", () => {
    const esperado =
      "O fotógrafo precisa ser um usuário staff ou fotógrafo ativo desta imobiliária.";
    expect(
      mensagemErroFoto(
        {
          message: "O fotografo precisa ser um usuario staff ou fotografo ativo desta imobiliaria",
        },
        "x",
      ),
    ).toBe(esperado);
    expect(mensagemErroFoto({ message: "precisa ser um usuario staff ativo" }, "x")).toBe(esperado);
  });
});
