import { describe, expect, it } from "vitest";
import {
  applyFilters,
  bairroLabel,
  buildDashboard,
  geoQueries,
  parseBRL,
  EMPTY_FILTERS,
} from "./exclusive-captures-dashboard";
import { emptyForm, type Capture } from "./exclusive-captures";

const mk = (
  over: Partial<Capture> & { valor?: string; bairro?: string; endereco?: string },
): Capture => {
  const f = emptyForm();
  f.imovel.valor_imovel = over.valor ?? "";
  f.imovel.bairro = over.bairro ?? "";
  f.imovel.endereco = over.endereco ?? "";
  f.imovel.municipio = "Sorocaba";
  f.condicoes.prazo_dias_numero = "180";
  f.condicoes.comissao_percentual_numero = "6";
  return {
    id: Math.random().toString(),
    captor_id: "u",
    template: "campolim",
    status: "rascunho",
    form_data: f,
    broker_name: "Ana",
    broker_cpf: "",
    broker_creci: "",
    created_on_sp: "2026-09-01",
    created_at: "",
    archived_at: null,
    signed_on: null,
    ...over,
  } as Capture;
};

describe("painel de captações", () => {
  it("lê valores em reais nos formatos digitados", () => {
    expect(parseBRL("R$ 870.000,00 ")).toBe(870000);
    expect(parseBRL("730.000")).toBe(730000);
    expect(parseBRL("195.000,00")).toBe(195000);
    expect(parseBRL("")).toBeNull();
  });
  it("unifica a grafia do bairro", () => {
    expect(bairroLabel(mk({ bairro: "JARDIM  EUROPA" }))).toBe("Jardim Europa");
    expect(bairroLabel(mk({}))).toBe("Sem bairro");
  });
  it("soma só exclusividades em vigor e separa vencendo/vencida", () => {
    const today = "2026-10-03";
    const d = buildDashboard(
      [
        mk({ status: "aprovada", signed_on: "2026-10-01", valor: "730.000" }), // vence 30/03/2027
        mk({ status: "aprovada", signed_on: "2026-04-20", valor: "100.000" }), // vence 17/10/2026
        mk({ status: "aprovada", signed_on: "2026-01-01", valor: "999.000" }), // vencida
        mk({ status: "enviada", valor: "500.000" }),
        mk({}),
      ],
      today,
    );
    expect(d.porSituacao).toEqual({
      em_vigor: 1,
      vencendo: 1,
      vencida: 1,
      em_andamento: 1,
      rascunho: 1,
    });
    expect(d.valorEmVigor).toBe(830000);
    expect(d.comissaoPotencial).toBeCloseTo(49800);
    expect(d.proximosVencimentos[0].v.daysLeft).toBe(-95);
  });
  it("filtra por período, corretor e ignora arquivadas", () => {
    const list = [
      mk({ created_on_sp: "2026-10-01" }),
      mk({ created_on_sp: "2026-05-01" }),
      mk({ archived_at: "x" }),
      mk({ broker_name: "Bia" }),
    ];
    expect(applyFilters(list, { ...EMPTY_FILTERS, periodo: "30" }, "2026-10-03")).toHaveLength(1);
    expect(applyFilters(list, { ...EMPTY_FILTERS, corretor: "Bia" }, "2026-10-03")).toHaveLength(1);
    expect(applyFilters(list, EMPTY_FILTERS, "2026-10-03")).toHaveLength(3);
    const ruas = [
      mk({ endereco: "Rua Inglaterra, 348", bairro: "Jardim Europa" }),
      mk({ endereco: "Av. São Paulo" }),
    ];
    expect(
      applyFilters(ruas, { ...EMPTY_FILTERS, busca: "inglaterra europa" }, "2026-10-03"),
    ).toHaveLength(1);
    expect(applyFilters(ruas, { ...EMPTY_FILTERS, busca: "sao paulo" }, "2026-10-03")).toHaveLength(
      1,
    );
    expect(
      applyFilters(ruas, { ...EMPTY_FILTERS, situacao: "rascunho" }, "2026-10-03"),
    ).toHaveLength(2);
    expect(
      applyFilters(ruas, { ...EMPTY_FILTERS, situacao: "em_vigor" }, "2026-10-03"),
    ).toHaveLength(0);
  });
  it("monta buscas do mapa sem dado de proprietário, da mais precisa para a aproximada", () => {
    const c = mk({ endereco: "Rua Comendador Vicente Amaral 3333,", bairro: "Jardim Guarujá" });
    c.form_data.proprietario_1.nome_completo = "Fulano";
    const q = geoQueries(c);
    expect(q[0]).toBe("Rua Comendador Vicente Amaral 3333, Jardim Guarujá, Sorocaba, SP, Brasil");
    expect(q[1]).toBe("Rua Comendador Vicente Amaral, Sorocaba, SP, Brasil");
    expect(q[2]).toBe("Jardim Guarujá, Sorocaba, SP, Brasil");
    expect(q.join(" ")).not.toContain("Fulano");
  });
});
