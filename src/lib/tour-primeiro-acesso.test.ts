import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { montarMenuLateral, type MenuContexto } from "@/lib/menu-lateral";
import {
  PASSO_GUIAS_TITULO,
  TOUR_MAX_ABERTURAS,
  idDaArea,
  limparAcessosDaSessao,
  novoAcessoNaSessao,
  listaEmTexto,
  montarPassosTour,
  podeGravarTour,
  statusDoEncerramento,
} from "@/lib/tour-primeiro-acesso";

const base: MenuContexto = {
  roles: [],
  platformAdmin: false,
  exclusiveVisible: false,
  roomVisible: false,
  feedbackVisible: false,
};
const menu = (ctx: Partial<MenuContexto>) => montarMenuLateral({ ...base, ...ctx });
const textos = (ps: { titulo: string; texto: string }[]) =>
  ps.map((p) => `${p.titulo} ${p.texto}`).join("\n");

describe("tour de primeiro acesso — passos", () => {
  it("o passo 1 é sempre os Guias de Ajuda, apontando para o item real do menu", () => {
    const ps = montarPassosTour(menu({ roles: ["corretor"] }), { celular: false });
    expect(ps[0].titulo).toBe(PASSO_GUIAS_TITULO);
    expect(ps[0].seletor).toBe('aside [data-tour="item-guias"]');
    expect(ps[0].texto).toContain("ADM MAX");
  });

  it("corretor: uma área por grupo visível, sem Equipe nem Administração", () => {
    const ps = montarPassosTour(menu({ roles: ["corretor"] }), { celular: false });
    const titulos = ps.map((p) => p.titulo);
    expect(titulos).toEqual([
      PASSO_GUIAS_TITULO,
      "Início",
      "Vendas e captações",
      "Relatórios",
      "Conta e acesso",
      "Precisa de ajuda?",
    ]);
    const tudo = textos(ps);
    expect(tudo).not.toContain("Painel da Equipe");
    expect(tudo).not.toContain("Usuários");
    expect(tudo).not.toContain("Financeiro");
  });

  it("gestor: inclui Equipe e Administração (Usuários), sem itens só de admin", () => {
    const ps = montarPassosTour(menu({ roles: ["gestor"] }), { celular: false });
    const titulos = ps.map((p) => p.titulo);
    expect(titulos).toContain("Equipe");
    expect(titulos).toContain("Administração");
    const adm = ps.find((p) => p.titulo === "Administração")!;
    expect(adm.texto).toContain("Usuários");
    expect(adm.texto).not.toContain("Dados da imobiliária");
    expect(adm.texto).not.toContain("Configurações");
  });

  it("respeita os módulos: Reservar sala e Captações só aparecem se ligados", () => {
    const desl = textos(montarPassosTour(menu({ roles: ["corretor"] }), { celular: false }));
    expect(desl).not.toContain("Reservar sala");
    expect(desl).not.toContain("Captações exclusivas");
    expect(desl).not.toContain("Agenda");
    const lig = montarPassosTour(
      menu({ roles: ["corretor"], roomVisible: true, exclusiveVisible: true }),
      { celular: false },
    );
    expect(lig.map((p) => p.titulo)).toContain("Agenda");
    expect(textos(lig)).toContain("Captações exclusivas");
  });

  it("cada item citado no tour é um item visível do menu (nunca aponta para o que a pessoa não vê)", () => {
    for (const roles of [["corretor"], ["gestor"], ["team_leader"], ["admin"], ["financeiro"]]) {
      const groups = menu({ roles, exclusiveVisible: true, roomVisible: true });
      const visiveis = new Set(
        groups.flatMap((g) => g.items.filter((i) => i.show).map((i) => i.label)),
      );
      const escondidos = groups.flatMap((g) => g.items.filter((i) => !i.show).map((i) => i.label));
      const tudo = textos(montarPassosTour(groups, { celular: false }));
      for (const e of escondidos) {
        if ([...visiveis].some((v) => v.includes(e))) continue;
        expect(tudo, `${roles} não deveria ver ${e}`).not.toContain(e);
      }
    }
  });

  it("áreas apontam para o grupo real da barra lateral (data-tour) no computador", () => {
    const ps = montarPassosTour(menu({ roles: ["corretor"] }), { celular: false });
    expect(ps.find((p) => p.titulo === "Vendas e captações")?.seletor).toBe(
      'aside [data-tour="area-vendas-e-captacoes"]',
    );
  });

  it("celular: passo 1 aponta para o botão do menu; áreas viram balão centralizado", () => {
    const ps = montarPassosTour(menu({ roles: ["corretor"] }), { celular: true });
    expect(ps[0].seletor).toBe('[data-tour="menu-celular"]');
    expect(ps[0].texto).toContain("Conta e acesso");
    const areas = ps.slice(1, -1);
    expect(areas.length).toBeGreaterThan(0);
    for (const a of areas) expect(a.seletor).toBeUndefined();
    expect(ps[ps.length - 1].seletor).toBe('[data-tour="ajuda-celular"]');
  });

  it("textos genéricos: sem nome de rede, imobiliária ou plataforma", () => {
    const fonte = readFileSync(new URL("./tour-primeiro-acesso.ts", import.meta.url), "utf8");
    for (const proibido of [
      "RE/MAX",
      "REMAX",
      "Única Escolha",
      "Unica Escolha",
      "UniHub",
      "MAX Hub",
    ]) {
      expect(fonte).not.toContain(proibido);
    }
    for (const roles of [["corretor"], ["gestor"], ["admin", "super_admin"]]) {
      for (const celular of [false, true]) {
        const tudo = textos(montarPassosTour(menu({ roles }), { celular }));
        expect(tudo).not.toMatch(/re\/?max|única escolha|unihub|max hub/i);
      }
    }
  });

  it("textos curtos (até 220 caracteres por balão)", () => {
    const groups = menu({
      roles: ["admin", "super_admin"],
      exclusiveVisible: true,
      roomVisible: true,
    });
    for (const p of montarPassosTour(groups, { celular: true })) {
      expect(p.texto.length, p.titulo).toBeLessThanOrEqual(220);
    }
  });
});

describe("tour de primeiro acesso — regras", () => {
  it("idDaArea tira acento e espaço", () => {
    expect(idDaArea("Relatórios detalhados")).toBe("relatorios-detalhados");
    expect(idDaArea(undefined)).toBe("inicio");
  });
  it("listaEmTexto", () => {
    expect(listaEmTexto(["A"])).toBe("A");
    expect(listaEmTexto(["A", "B"])).toBe("A e B");
    expect(listaEmTexto(["A", "B", "C"])).toBe("A, B e C");
    expect(listaEmTexto(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C, D e mais 2");
  });
  it("só grava/abre sozinho para a própria pessoa", () => {
    expect(
      podeGravarTour({ impersonando: false, emVisaoDaPlataforma: false, platformAdmin: false }),
    ).toBe(true);
    expect(
      podeGravarTour({ impersonando: true, emVisaoDaPlataforma: false, platformAdmin: false }),
    ).toBe(false);
    expect(
      podeGravarTour({ impersonando: false, emVisaoDaPlataforma: true, platformAdmin: true }),
    ).toBe(false);
    expect(
      podeGravarTour({ impersonando: false, emVisaoDaPlataforma: false, platformAdmin: true }),
    ).toBe(false);
  });
  it("concluir e fechar gravam; troca de tela/saída não grava", () => {
    expect(statusDoEncerramento("done")).toBe("concluido");
    expect(statusDoEncerramento("close")).toBe("fechado");
    expect(statusDoEncerramento("escape")).toBe("fechado");
    expect(statusDoEncerramento("overlay")).toBe("fechado");
    expect(statusDoEncerramento("replaced")).toBeNull();
    expect(statusDoEncerramento("api")).toBeNull();
    expect(statusDoEncerramento(undefined)).toBeNull();
  });
});

function memoria() {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("tour — 3 aberturas: 1 acesso por sessão da aba (t_7444a154)", () => {
  it("1ª checagem da sessão é acesso novo; recarregar/trocar de tela na mesma sessão não conta", () => {
    const s = memoria();
    expect(novoAcessoNaSessao(s, "u1")).toBe(true);
    expect(novoAcessoNaSessao(s, "u1")).toBe(false); // recarregou
    expect(novoAcessoNaSessao(s, "u1")).toBe(false); // trocou de tela/remontou
    expect(novoAcessoNaSessao(s, "u2")).toBe(true); // outra pessoa na mesma aba
  });
  it("sessão nova (aba/janela nova ou depois de sair da conta) conta de novo", () => {
    const s = memoria();
    expect(novoAcessoNaSessao(s, "u1")).toBe(true);
    s.setItem("outra-coisa", "x");
    limparAcessosDaSessao(s); // saiu da conta
    expect(s.getItem("outra-coisa")).toBe("x"); // só apaga a marca do tour
    expect(novoAcessoNaSessao(s, "u1")).toBe(true);
    expect(novoAcessoNaSessao(memoria(), "u1")).toBe(true); // aba nova
  });
  it("sem armazenamento: não abre sozinho (evita abrir a cada recarga)", () => {
    expect(novoAcessoNaSessao(null, "u1")).toBe(false);
    const quebrado = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {},
    };
    expect(novoAcessoNaSessao(quebrado, "u1")).toBe(false);
  });
  it("limite é 3", () => expect(TOUR_MAX_ABERTURAS).toBe(3));
});

describe("tour — migration das 3 aberturas", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20261026150000_tour_tres_aberturas.sql", import.meta.url),
    "utf8",
  );
  it("aditiva: só a tabela do tour, sem apagar dados, função sem SECURITY DEFINER", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS aberturas integer NOT NULL DEFAULT 1/);
    expect(sql).toMatch(/SECURITY INVOKER/);
    expect(sql).not.toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/t\.aberturas < 3/);
    expect(sql).not.toMatch(/\b(DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE|DISABLE ROW)\b/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.(?!user_tour_estado)/);
    expect(sql).not.toMatch(/GRANT[^;]*\banon\b/);
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY/); // RLS igual
    const rb = readFileSync(
      new URL(
        "../../docs/sql/rollback/20261026150000_tour_tres_aberturas.rollback.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(rb).toContain("DROP FUNCTION IF EXISTS public.tour_registrar_abertura(text)");
    expect(rb).not.toMatch(/DROP TABLE|DELETE FROM/i);
  });
});

describe("tour de primeiro acesso — migration", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20261026120000_tour_primeiro_acesso.sql", import.meta.url),
    "utf8",
  );
  it("é aditiva, com RLS só na própria linha e rollback", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.user_tour_estado/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql.match(/\(SELECT auth\.uid\(\)\)/g)?.length).toBe(4);
    expect(sql).not.toMatch(
      /\b(DROP TABLE|ALTER TABLE public\.(?!user_tour_estado)|DELETE FROM|TRUNCATE)\b/i,
    );
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*authenticated/);
    expect(sql).not.toMatch(/GRANT[^;]*\banon\b/);
    const rb = readFileSync(
      new URL(
        "../../docs/sql/rollback/20261026120000_tour_primeiro_acesso.rollback.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(rb).toContain("DROP TABLE IF EXISTS public.user_tour_estado");
  });
});
