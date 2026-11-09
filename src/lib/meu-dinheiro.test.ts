import { describe, expect, it } from "vitest";
import {
  agruparPartes,
  completarPartesPelaRpc,
  dataBR,
  filtrarOrigem,
  filtrarPeriodo,
  mostrarFiltroOrigem,
  normalizarComissao,
  ordenarPorData,
  origemDoPapel,
  origensDisponiveis,
  partesConferem,
  totalComissao,
  type MinhaComissao,
} from "./meu-dinheiro";

const c = (o: Partial<MinhaComissao>): MinhaComissao => ({
  sale_id: "s",
  venda_em: "2026-09-01",
  imovel: "Casa · Centro",
  papel: "captador",
  minha_comissao: 0,
  ...o,
});

describe("meu dinheiro", () => {
  const hoje = "2026-10-16";
  const lista = [
    c({ sale_id: "a", venda_em: "2026-10-03", minha_comissao: 9000 }),
    c({
      sale_id: "b",
      venda_em: "2026-10-12",
      minha_comissao: 4500.25,
      papel: "captador e vendedor",
    }),
    c({ sale_id: "c", venda_em: "2026-02-20", minha_comissao: 1000 }),
    c({ sale_id: "d", venda_em: "2025-12-05", minha_comissao: 7000 }),
    c({ sale_id: "e", venda_em: null, minha_comissao: 300 }),
  ];

  it("total geral soma a comissão de todas as vendas", () => {
    expect(totalComissao(filtrarPeriodo(lista, "todas", hoje))).toBe(21800.25);
  });

  it("filtro do mês: só vendas do mês corrente", () => {
    const m = filtrarPeriodo(lista, "mes", hoje);
    expect(m.map((x) => x.sale_id)).toEqual(["a", "b"]);
    expect(totalComissao(m)).toBe(13500.25);
  });

  it("filtro do ano: só vendas do ano corrente", () => {
    const a = filtrarPeriodo(lista, "ano", hoje);
    expect(a.map((x) => x.sale_id)).toEqual(["a", "b", "c"]);
    expect(totalComissao(a)).toBe(14500.25);
  });

  it("lista vazia: total zero", () => {
    expect(totalComissao([])).toBe(0);
    expect(filtrarPeriodo([], "mes", hoje)).toEqual([]);
  });

  it("ordena da venda mais recente para a mais antiga, sem data no fim", () => {
    expect(ordenarPorData(lista).map((x) => x.sale_id)).toEqual(["b", "a", "c", "d", "e"]);
  });

  it("normaliza números vindos como texto da RPC", () => {
    const n = normalizarComissao({ sale_id: "s", minha_comissao: "9000.50" });
    expect(n.minha_comissao).toBe(9000.5);
    expect(n.venda_em).toBeNull();
    expect(n.papel).toBeNull();
    expect(normalizarComissao({ sale_id: "s", minha_comissao: null }).minha_comissao).toBe(0);
  });

  describe("filtro Minhas vendas / Do time (t_31729652)", () => {
    // Venda a: só pessoal; b: mista (captador + líder captador); c: só time; d: coordenação.
    const rpc = [
      c({ sale_id: "a", venda_em: "2026-10-03", minha_comissao: 9000, papel: "captador" }),
      c({
        sale_id: "b",
        venda_em: "2026-10-12",
        minha_comissao: 5500.25,
        papel: "captador e lider captador",
      }),
      c({ sale_id: "c", venda_em: "2026-02-20", minha_comissao: 800, papel: "lider vendedor" }),
      c({
        sale_id: "d",
        venda_em: "2025-12-05",
        minha_comissao: 300,
        papel: "coordenador lancamento",
      }),
    ];
    const linhas = [
      { sale_id: "a", papel: "corretor_captador", valor: "9000" },
      { sale_id: "b", papel: "corretor_captador", valor: 5000.25 },
      { sale_id: "b", papel: "lider_captador", valor: 500 },
      { sale_id: "c", papel: "lider_vendedor", valor: 800 },
      { sale_id: "d", papel: "coordenador_lancamento", valor: 300 },
      { sale_id: "a", papel: "lider_vendedor", valor: 999, sem_cadastro_confirmado: true },
    ];
    const partes = agruparPartes(linhas);

    it("classifica os papéis do banco; desconhecido vai para outras", () => {
      expect(origemDoPapel("corretor_vendedor")).toBe("minhas");
      expect(origemDoPapel("indicador_captador")).toBe("minhas");
      expect(origemDoPapel("lider_captador")).toBe("time");
      expect(origemDoPapel("gestor")).toBe("time");
      expect(origemDoPapel("team_leader")).toBe("time");
      expect(origemDoPapel("coordenador_lancamento")).toBe("outras");
      expect(origemDoPapel("papel_novo")).toBe("outras");
      expect(origemDoPapel(null)).toBe("outras");
    });

    it("Todas devolve exatamente a lista da RPC (mesmo total de antes)", () => {
      expect(filtrarOrigem(rpc, partes, "todas")).toBe(rpc);
      expect(totalComissao(filtrarOrigem(rpc, partes, "todas"))).toBe(15600.25);
    });

    it("Minhas + Do time + Outras somam o mesmo total de Todas", () => {
      const soma = (["minhas", "time", "outras"] as const).reduce(
        (s, o) => s + totalComissao(filtrarOrigem(rpc, partes, o)),
        0,
      );
      expect(Math.round(soma * 100) / 100).toBe(15600.25);
    });

    it("venda mista aparece nas duas visões, cada uma com a sua parte e papel", () => {
      const m = filtrarOrigem(rpc, partes, "minhas");
      expect(m.map((x) => [x.sale_id, x.minha_comissao, x.papel])).toEqual([
        ["a", 9000, "captador"],
        ["b", 5000.25, "captador"],
      ]);
      const t = filtrarOrigem(rpc, partes, "time");
      expect(t.map((x) => [x.sale_id, x.minha_comissao, x.papel])).toEqual([
        ["b", 500, "lider captador"],
        ["c", 800, "lider vendedor"],
      ]);
    });

    it("combina com o período", () => {
      const t = filtrarPeriodo(filtrarOrigem(rpc, partes, "time"), "mes", hoje);
      expect(totalComissao(t)).toBe(500);
    });

    it("ignora linha sem cadastro confirmado (mesmo filtro da RPC) e confere com a RPC", () => {
      expect(partes.get("a")?.time).toBeUndefined();
      expect(partesConferem(rpc, partes)).toBe(true);
    });

    it("se faltar parte ou o valor não bater, não confere (filtro some)", () => {
      expect(partesConferem(rpc, agruparPartes(linhas.filter((l) => l.sale_id !== "c")))).toBe(
        false,
      );
      const errado = agruparPartes([
        ...linhas,
        { sale_id: "a", papel: "corretor_vendedor", valor: 1 },
      ]);
      expect(partesConferem(rpc, errado)).toBe(false);
    });

    it("venda sem leitura e com um só papel na RPC: a parte sai da RPC; com 2 papéis, não", () => {
      const semC = agruparPartes(linhas.filter((l) => l.sale_id !== "c"));
      const comp = completarPartesPelaRpc(rpc, semC);
      expect(comp.get("c")).toEqual({ time: { valor: 800, papeis: ["lider_vendedor"] } });
      expect(partesConferem(rpc, comp)).toBe(true);
      const ind = [c({ sale_id: "i", minha_comissao: 1080, papel: "indicador captador" })];
      expect(completarPartesPelaRpc(ind, new Map()).get("i")).toEqual({
        minhas: { valor: 1080, papeis: ["indicador_captador"] },
      });
      const semB = agruparPartes(linhas.filter((l) => l.sale_id !== "b"));
      expect(partesConferem(rpc, completarPartesPelaRpc(rpc, semB))).toBe(false);
    });

    it("filtro só para quem tem comissão de time; corretor só pessoal não vê", () => {
      expect(origensDisponiveis(rpc, partes)).toEqual(["minhas", "time", "outras"]);
      expect(mostrarFiltroOrigem(origensDisponiveis(rpc, partes))).toBe(true);
      const so = [rpc[0]];
      expect(origensDisponiveis(so, partes)).toEqual(["minhas"]);
      expect(mostrarFiltroOrigem(origensDisponiveis(so, partes))).toBe(false);
    });
  });

  it("data em formato brasileiro", () => {
    expect(dataBR("2026-10-28")).toBe("28/10/2026");
    expect(dataBR(null)).toBe("—");
  });
});
