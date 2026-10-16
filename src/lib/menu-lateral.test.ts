import { describe, expect, it } from "vitest";
import {
  FileSignature,
  Handshake,
  Map as MapIcon,
  MapPinned,
  UserCog,
  UsersRound,
} from "lucide-react";
import {
  iniciaisDoEmail,
  itensVisiveis,
  montarMenuLateral,
  type MenuContexto,
} from "./menu-lateral";
import { podeAcessarCentralFinanceira } from "./financeiro-dashboard-calc";
import { podeVerOcorrenciasConcluidas } from "./ocorrencias-concluidas";
import { podeAcessarVendasPorRegiao } from "./vendas-por-regiao";
import { podeAcessarPainelEquipe } from "./painel-equipe-calc";

// Cópia fiel das condições do menu ANTES do agrupamento (AppShell em origin/main 7350d26).
// Serve de prova de que nenhum papel ganhou nem perdeu item: só a ordem e o grupo mudaram.
function menuAnterior(ctx: MenuContexto): Set<string> {
  const { roles, platformAdmin, exclusiveVisible, roomVisible, feedbackVisible } = ctx;
  const hasAny = (rs: string[]) => rs.some((r) => roles.includes(r));
  const itens: [string, boolean][] = [
    ["/dashboard", true],
    ["/vendas", true],
    [
      "/exclusividades",
      exclusiveVisible && hasAny(["corretor", "gestor", "team_leader", "admin", "super_admin"]),
    ],
    ["/mapa-captacoes", podeAcessarVendasPorRegiao(roles)],
    [
      "/feedback",
      feedbackVisible && hasAny(["corretor", "gestor", "team_leader", "admin", "super_admin"]),
    ],
    ["/financeiro", podeAcessarCentralFinanceira([...roles])],
    ["/visao-executiva", hasAny(["gestor", "team_leader", "admin", "super_admin", "financeiro"])],
    ["/painel-equipe", podeAcessarPainelEquipe(roles)],
    ["/equipe", hasAny(["gestor", "team_leader", "admin", "super_admin"])],
    ["/reservas-salas", roomVisible],
    ["/comparativo-comissao", hasAny(["admin", "super_admin", "financeiro"])],
    [
      "/producao-por-pessoa",
      hasAny(["admin", "super_admin", "financeiro", "gestor", "team_leader"]),
    ],
    ["/vendas-por-regiao", podeAcessarVendasPorRegiao(roles)],
    ["/relatorios", hasAny(["financeiro", "admin", "super_admin"])],
    ["/comissoes-a-receber", hasAny(["financeiro", "admin", "super_admin"])],
    ["/ocorrencias-concluidas", podeVerOcorrenciasConcluidas(roles)],
    ["/notificacoes", true],
    ["/perfil", true],
    ["/ajuda", true],
    ["/admin/usuarios", hasAny(["admin", "super_admin", "gestor", "team_leader"])],
    ["/admin/posicionamento", hasAny(["admin", "super_admin"])],
    ["/admin/dados-imobiliaria", hasAny(["admin", "super_admin"])],
    ["/admin/unidades-captacao", exclusiveVisible && hasAny(["admin", "super_admin"])],
    ["/admin/configuracoes", hasAny(["super_admin"])],
    ["/plataforma/imobiliarias", platformAdmin],
    ["/plataforma/usuarios", platformAdmin],
    ["/plataforma/chamados", platformAdmin],
  ];
  return new Set(itens.filter(([, s]) => s).map(([to]) => to));
}

const PAPEIS = [
  "corretor",
  "gestor",
  "team_leader",
  "juridico",
  "financeiro",
  "admin",
  "super_admin",
  "lancamento",
  "staff",
];

describe("menu lateral agrupado", () => {
  it("cada papel (sozinho, combinado e com módulos ligados/desligados) vê exatamente os mesmos itens", () => {
    const combos: string[][] = [[], ...PAPEIS.map((p) => [p])];
    for (let i = 0; i < PAPEIS.length; i++)
      for (let j = i + 1; j < PAPEIS.length; j++) combos.push([PAPEIS[i], PAPEIS[j]]);
    let casos = 0;
    for (const roles of combos)
      for (let flags = 0; flags < 16; flags++) {
        const ctx: MenuContexto = {
          roles,
          exclusiveVisible: Boolean(flags & 1),
          roomVisible: Boolean(flags & 2),
          feedbackVisible: Boolean(flags & 4),
          platformAdmin: Boolean(flags & 8),
        };
        const depois = itensVisiveis(montarMenuLateral(ctx));
        expect(new Set(depois).size).toBe(depois.length);
        expect([...depois].sort()).toEqual([...menuAnterior(ctx)].sort());
        casos++;
      }
    expect(casos).toBeGreaterThan(700);
  });

  it("nenhum ícone se repete e os ícones pedidos estão nos itens certos", () => {
    const grupos = montarMenuLateral({
      roles: PAPEIS,
      platformAdmin: true,
      exclusiveVisible: true,
      roomVisible: true,
      feedbackVisible: true,
    });
    const itens = grupos.flatMap((g) => g.items);
    expect(new Set(itens.map((i) => i.icon)).size).toBe(itens.length);
    const icone = (to: string) => itens.find((i) => i.to === to)?.icon;
    expect(icone("/vendas")).toBe(Handshake);
    expect(icone("/exclusividades")).toBe(FileSignature);
    expect(icone("/mapa-captacoes")).toBe(MapIcon);
    expect(icone("/vendas-por-regiao")).toBe(MapPinned);
    expect(icone("/equipe")).toBe(UsersRound);
    expect(icone("/admin/usuarios")).toBe(UserCog);
  });

  it("grupos na ordem aprovada e Usuários dentro de Administração", () => {
    const grupos = montarMenuLateral({
      roles: ["team_leader"],
      platformAdmin: false,
      exclusiveVisible: true,
      roomVisible: true,
      feedbackVisible: true,
    });
    expect(grupos.map((g) => g.label ?? "")).toEqual([
      "",
      "Vendas e captações",
      "Equipe",
      "Agenda",
      "Relatórios detalhados",
      "Conta e acesso",
      "Administração",
    ]);
    const admin = grupos.find((g) => g.label === "Administração")!;
    expect(admin.items.filter((i) => i.show).map((i) => i.to)).toEqual(["/admin/usuarios"]);
  });

  it("Oportunidades só aparece com o módulo ligado e para os mesmos perfis do Feedback", () => {
    const base = {
      platformAdmin: true,
      exclusiveVisible: true,
      roomVisible: true,
      feedbackVisible: true,
    };
    const vê = (roles: string[], opportunitiesVisible?: boolean) =>
      itensVisiveis(montarMenuLateral({ ...base, roles, opportunitiesVisible })).includes(
        "/oportunidades",
      );
    for (const p of ["corretor", "gestor", "team_leader", "admin", "super_admin"]) {
      expect(vê([p], true)).toBe(true);
      expect(vê([p], false)).toBe(false);
      expect(vê([p])).toBe(false);
    }
    for (const p of ["juridico", "financeiro", "lancamento", "staff"])
      expect(vê([p], true)).toBe(false);
  });

  it("Minha carreira só aparece com o módulo de captação e para os perfis de Captações exclusivas", () => {
    const base = {
      platformAdmin: true,
      exclusiveVisible: true,
      roomVisible: true,
      feedbackVisible: true,
    };
    const vê = (roles: string[], carreiraVisible?: boolean) =>
      itensVisiveis(montarMenuLateral({ ...base, roles, carreiraVisible })).includes(
        "/minha-carreira",
      );
    for (const p of ["corretor", "gestor", "team_leader", "admin", "super_admin"]) {
      expect(vê([p], true)).toBe(true);
      expect(vê([p], false)).toBe(false);
      expect(vê([p])).toBe(false);
    }
    for (const p of ["juridico", "financeiro", "lancamento", "staff"])
      expect(vê([p], true)).toBe(false);
  });

  it("iniciais do e-mail", () => {
    expect(iniciaisDoEmail("alexandre.fernandes@x.com")).toBe("AF");
    expect(iniciaisDoEmail("denis@x.com")).toBe("DE");
    expect(iniciaisDoEmail(null)).toBe("?");
  });
});
