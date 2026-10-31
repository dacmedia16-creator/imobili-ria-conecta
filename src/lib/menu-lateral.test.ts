import { readFileSync } from "node:fs";
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
    // Ficha dos colaboradores (t_618b64bc): item novo, só staff e administração.
    ["/ficha-colaboradores", hasAny(["staff", "admin", "super_admin"])],
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
    ["/ajuda/wiki", true], // Wiki MAX v4 (t_5e94d050): item novo, igual para todos
    ["/admin/usuarios", hasAny(["admin", "super_admin", "gestor", "team_leader"])],
    ["/admin/posicionamento", hasAny(["admin", "super_admin"])],
    ["/admin/dados-imobiliaria", hasAny(["admin", "super_admin"])],
    ["/admin/unidades-captacao", exclusiveVisible && hasAny(["admin", "super_admin"])],
    ["/admin/configuracoes", hasAny(["super_admin"])],
    ["/admin/assinatura-digital", hasAny(["super_admin"])],
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
      "Relatórios detalhados",
      "Conta e acesso",
      "Administração",
      "Plataforma",
    ]);
    const admin = grupos.find((g) => g.label === "Administração")!;
    expect(admin.items.filter((i) => i.show).map((i) => i.to)).toEqual(["/admin/usuarios"]);
    // Sem plataforma, o grupo Plataforma fica vazio (não aparece na tela).
    const plat = grupos.find((g) => g.label === "Plataforma")!;
    expect(plat.items.some((i) => i.show)).toBe(false);
  });

  it("item 21 (t_0fa570c7): Plataforma separada da Administração e Reserva de salas em Equipe", () => {
    const grupos = montarMenuLateral({
      roles: ["super_admin"],
      platformAdmin: true,
      exclusiveVisible: true,
      roomVisible: true,
      feedbackVisible: true,
    });
    const doGrupo = (l: string) =>
      grupos.find((g) => g.label === l)!.items.filter((i) => i.show).map((i) => i.to);
    expect(doGrupo("Plataforma")).toEqual([
      "/plataforma/imobiliarias",
      "/plataforma/usuarios",
      "/plataforma/chamados",
    ]);
    expect(doGrupo("Administração").some((to) => to.startsWith("/plataforma"))).toBe(false);
    expect(doGrupo("Equipe")).toContain("/reservas-salas");
    expect(grupos.some((g) => g.label === "Agenda")).toBe(false);
  });

  it("item 21: nome do menu = título da tela (h1 e <title>) e Ajuda com um destino só", () => {
    const ler = (arq: string) =>
      readFileSync(new URL(`../routes/_authenticated/${arq}`, import.meta.url), "utf8");
    const grupos = montarMenuLateral({
      roles: ["super_admin", "admin", "financeiro", "gestor"],
      platformAdmin: true,
      exclusiveVisible: true,
      roomVisible: true,
      feedbackVisible: true,
      opportunitiesVisible: true,
      achievementsVisible: true,
      carreiraVisible: true,
    });
    const rotulo = new Map(grupos.flatMap((g) => g.items).map((i) => [i.to, i.label]));
    const arquivo: Record<string, string> = {
      "/minha-carreira": "minha-carreira.tsx",
      "/vendas": "vendas.index.tsx",
      "/exclusividades": "exclusividades.index.tsx",
      "/mapa-captacoes": "mapa-captacoes.tsx",
      "/feedback": "feedback.tsx",
      "/oportunidades": "oportunidades.tsx",
      "/mural-conquistas": "mural-conquistas.tsx",
      "/visao-executiva": "visao-executiva.tsx",
      "/equipe": "equipe.tsx",
      "/ficha-colaboradores": "ficha-colaboradores.tsx",
      "/reservas-salas": "reservas-salas.tsx",
      "/producao-por-pessoa": "producao-por-pessoa.tsx",
      "/vendas-por-regiao": "vendas-por-regiao.tsx",
      "/ocorrencias-concluidas": "ocorrencias-concluidas.tsx",
      "/financeiro": "financeiro.tsx",
      "/comparativo-comissao": "comparativo-comissao.tsx",
      "/relatorios": "relatorios.tsx",
      "/comissoes-a-receber": "comissoes-a-receber.tsx",
      "/notificacoes": "notificacoes.tsx",
      "/perfil": "perfil.tsx",
      "/ajuda": "ajuda.tsx",
      "/ajuda/wiki": "ajuda_.wiki.tsx",
      "/admin/usuarios": "admin.usuarios.tsx",
      "/admin/posicionamento": "admin.posicionamento.tsx",
      "/admin/dados-imobiliaria": "admin.dados-imobiliaria.tsx",
      "/admin/unidades-captacao": "admin.unidades-captacao.tsx",
      "/admin/configuracoes": "admin.configuracoes.tsx",
      "/admin/assinatura-digital": "admin.assinatura-digital.tsx",
      "/plataforma/usuarios": "plataforma.usuarios.tsx",
      "/plataforma/chamados": "plataforma.chamados.tsx",
    };
    for (const [to, arq] of Object.entries(arquivo)) {
      const nome = rotulo.get(to)!;
      expect(nome, to).toBeTruthy();
      const fonte = ler(arq);
      expect(fonte, `${arq} h1`).toContain(`title="${nome}"`);
    }
    const imob = ler("plataforma.imobiliarias.tsx");
    expect(imob).toContain(`>${rotulo.get("/plataforma/imobiliarias")}</h1>`);
    expect(imob).toContain(`title: "${rotulo.get("/plataforma/imobiliarias")}"`);
    // "Ajuda e sugestões" é só o botão do topo (formulário); o menu leva à lista "Meus chamados".
    const labels = grupos.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).not.toContain("Ajuda e sugestões");
    expect(rotulo.get("/ajuda")).toBe("Meus chamados");
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

  it('"Entrar como" da plataforma esconde os 3 itens da plataforma e a Ficha dos colaboradores (t_722085c6, t_618b64bc)', () => {
    // + Ficha dos colaboradores (t_618b64bc): dado sensível, o banco recusa na visão da plataforma.
    const PLATAFORMA = [
      "/plataforma/imobiliarias",
      "/plataforma/usuarios",
      "/plataforma/chamados",
      "/ficha-colaboradores",
    ];
    const base: MenuContexto = {
      roles: ["super_admin", "admin"], // papéis virtuais do contexto (CONTEXT_ROLES)
      platformAdmin: true,
      exclusiveVisible: true,
      roomVisible: true,
      feedbackVisible: true,
    };
    const fora = itensVisiveis(montarMenuLateral(base));
    const dentro = itensVisiveis(montarMenuLateral({ ...base, inPlatformContext: true }));
    for (const p of PLATAFORMA) {
      expect(fora).toContain(p);
      expect(dentro).not.toContain(p);
    }
    // Todo o resto continua igual, inclusive Configurações e Assinatura digital.
    expect(dentro).toEqual(fora.filter((to) => !PLATAFORMA.includes(to)));
    expect(dentro).toContain("/admin/configuracoes");
    expect(dentro).toContain("/admin/assinatura-digital");
    // Usuário real (sem platformAdmin) não muda com a flag.
    for (const roles of [["admin"], ["gestor"], ["corretor"], ["super_admin"]]) {
      const real = { ...base, roles, platformAdmin: false };
      expect(itensVisiveis(montarMenuLateral({ ...real, inPlatformContext: true }))).toEqual(
        itensVisiveis(montarMenuLateral(real)),
      );
    }
  });

  it("iniciais do e-mail", () => {
    expect(iniciaisDoEmail("alexandre.fernandes@x.com")).toBe("AF");
    expect(iniciaisDoEmail("denis@x.com")).toBe("DE");
    expect(iniciaisDoEmail(null)).toBe("?");
  });
});
