import { describe, expect, it } from "vitest";
import { linhaFichaPino, montarVendasTodos, type VendaRegiaoTodosRow } from "@/lib/vendas-por-regiao";
import { normalizeForm, normalizeFichaCaptacao } from "@/lib/exclusive-captures";

const base: VendaRegiaoTodosRow = {
  tipo: "pino",
  sale_id: null,
  data_fechamento: null,
  modalidade: "padrao",
  codigo: null,
  qtd: 1,
  valor: "400000",
  imovel_endereco: null,
  imovel_bairro: "Campolim",
  imovel_cidade: "Sorocaba",
  imovel_uf: "SP",
  geo_key: null,
  geo_lat: -23.5,
  geo_lon: -47.4,
};

describe("ficha no pino de Vendas por região", () => {
  it("mostra tipo, área útil e preço por m²", () => {
    // Intl usa espaço não separável depois de "R$".
    expect(linhaFichaPino("Apartamento", 50, 400000)?.replace(/\s/g, " ")).toBe(
      "Apartamento · 50 m² · R$ 8.000/m²",
    );
  });
  it("sem área útil: só o tipo, sem preço por m²", () => {
    expect(linhaFichaPino("Casa", null, 400000)).toBe("Casa");
  });
  it("sem tipo e sem área: nenhuma linha", () => {
    expect(linhaFichaPino(null, null, 400000)).toBeNull();
  });
  it("área sem valor: não inventa preço por m²", () => {
    expect(linhaFichaPino("Studio", 30.5, null)).toBe("Studio · 30,5 m²");
  });
  it("pino anônimo continua sem código, endereço e data; ganha só tipo e área", () => {
    const { pinos } = montarVendasTodos([{ ...base, tipo_imovel: "Casa", area_util_m2: "120.00" }]);
    expect(pinos).toHaveLength(1);
    expect(pinos[0]).toMatchObject({ tipoImovel: "Casa", areaUtil: 120, valor: 400000 });
    expect(Object.keys(pinos[0]).sort()).toEqual(
      ["areaUtil", "bairro", "cidade", "id", "lat", "lon", "modalidade", "tipoImovel", "valor"].sort(),
    );
  });
  it("área zero ou ausente vira null (banco antigo sem as colunas)", () => {
    const { pinos } = montarVendasTodos([base, { ...base, area_util_m2: 0 }]);
    expect(pinos.map((p) => p.areaUtil)).toEqual([null, null]);
  });
  it("venda que a pessoa abre recebe tipo e área", () => {
    const { vendas } = montarVendasTodos([
      { ...base, tipo: "venda", sale_id: "s1", codigo: "C1", tipo_imovel: "Apartamento", area_util_m2: 54.8 },
    ]);
    expect(vendas[0]).toMatchObject({ tipoImovel: "Apartamento", areaUtil: 54.8 });
  });
});

describe("ficha na captação (form_data.ficha)", () => {
  it("normaliza só as chaves conhecidas, como texto", () => {
    const f = normalizeFichaCaptacao({ area_util_m2: "54,80", quartos: 2, lixo: "x" });
    expect(f.area_util_m2).toBe("54,80");
    expect(f.quartos).toBe("2");
    expect(f.vagas).toBe("");
    expect("lixo" in f).toBe(false);
  });
  it("normalizeForm preserva a ficha salva e não cria ficha em captação antiga", () => {
    expect(normalizeForm({}).ficha).toBeUndefined();
    const form = normalizeForm({ ficha: { area_util_m2: "110", vagas: "2" } as never });
    expect(form.ficha).toMatchObject({ area_util_m2: "110", vagas: "2", suites: "" });
  });
});
