import { describe, expect, it } from "vitest";
import {
  agruparPorRegiao,
  filtrarVendas,
  geoKeyVenda,
  geoQueriesVenda,
  montarVendas,
  SEM_BAIRRO,
  SEM_CIDADE,
  vendasNoMapa,
  vendasPendentesGeo,
  type SaleGeo,
  type VendaRegiaoRow,
} from "@/lib/vendas-por-regiao";

const row = (p: Partial<VendaRegiaoRow>): VendaRegiaoRow => ({
  sale_id: Math.random().toString(36).slice(2),
  data_fechamento: "2026-09-10",
  modalidade: "padrao",
  status: "ocorrencia_concluida",
  codigo_interno: "X",
  imovel_id: null,
  corretor_id: null,
  valor_negociado: 100,
  imovel_endereco: "Rua A, 1",
  imovel_bairro: null,
  imovel_cidade: null,
  imovel_uf: null,
  imovel_cep: null,
  ...p,
});

describe("vendas por região", () => {
  it("junta grafias diferentes da mesma cidade e bairro", () => {
    const g = agruparPorRegiao(
      montarVendas([
        row({ imovel_cidade: "SOROCABA", imovel_uf: "SP", imovel_bairro: "PARQUE CAMPOLIM" }),
        row({ imovel_cidade: "Sorocaba", imovel_uf: "SP", imovel_bairro: "Parque Campolim" }),
        row({
          imovel_cidade: "Votorantim",
          imovel_uf: "SP",
          imovel_bairro: "Vossoroca",
          valor_negociado: 50,
        }),
      ]),
    );
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ cidade: "Sorocaba", uf: "SP", qtd: 2, vgv: 200 });
    expect(g[0].bairros).toHaveLength(1);
    expect(g[0].bairros[0]).toMatchObject({ bairro: "Parque Campolim", qtd: 2 });
  });

  it("vendas sem cidade ou bairro ficam no fim", () => {
    const g = agruparPorRegiao(
      montarVendas([row({}), row({}), row({ imovel_cidade: "Itu", imovel_uf: "SP" })]),
    );
    expect(g[g.length - 1].cidade).toBe(SEM_CIDADE);
    expect(g[0].bairros[0].bairro).toBe(SEM_BAIRRO);
  });

  it("filtra por período e por texto do endereço sem acento", () => {
    const v = montarVendas([
      row({ imovel_bairro: "Jardim São Carlos", data_fechamento: "2026-09-01" }),
      row({ imovel_bairro: "Centro", data_fechamento: "2026-08-01" }),
    ]);
    expect(
      filtrarVendas(v, { dataDe: "2026-09-01", dataAte: "2026-09-30", busca: "" }),
    ).toHaveLength(1);
    expect(filtrarVendas(v, { dataDe: "", dataAte: "", busca: "sao carlos" })).toHaveLength(1);
  });
});

describe("vendas por região — mapa", () => {
  const venda = (p: Partial<VendaRegiaoRow>) => montarVendas([row(p)])[0];

  it("geoKey usa só o endereço do imóvel e fica vazia sem rua nem bairro", () => {
    const v = venda({
      imovel_endereco: "Rua da Penha,  620",
      imovel_bairro: "Centro",
      imovel_cidade: "Sorocaba",
      imovel_uf: "SP",
    });
    expect(geoKeyVenda(v)).toBe("rua da penha, 620|centro|sorocaba|sp");
    expect(geoKeyVenda(venda({ imovel_endereco: null, imovel_bairro: null }))).toBe("");
  });

  it("consultas vão da rua com número até o bairro, usando a cidade da imobiliária se faltar", () => {
    const v = venda({ imovel_endereco: "Rua da Penha, 620", imovel_bairro: "Centro" });
    expect(geoQueriesVenda(v, { cidade: "Campinas", uf: "SP" })).toEqual([
      "Rua da Penha, 620, Centro, Campinas, SP, Brasil",
      "Rua da Penha, Campinas, SP, Brasil",
      "Centro, Campinas, SP, Brasil",
    ]);
    const sn = venda({ imovel_endereco: "Rua X, S/N", imovel_cidade: "Itu", imovel_uf: "SP" });
    expect(geoQueriesVenda(sn)[1]).toBe("Rua X, Itu, SP, Brasil");
  });

  it("separa vendas com e sem coordenada e detecta endereço alterado", () => {
    const a = venda({
      sale_id: "a",
      imovel_endereco: "Rua A, 1",
      imovel_cidade: "Sorocaba",
      imovel_uf: "SP",
    });
    const b = venda({ sale_id: "b", imovel_endereco: "Rua B, 2" });
    const c = venda({ sale_id: "c", imovel_endereco: null, imovel_bairro: null });
    const d = venda({ sale_id: "d", imovel_endereco: "Rua D, 4" });
    const geo = new Map<string, SaleGeo>([
      ["a", { sale_id: "a", geo_key: geoKeyVenda(a), geo_lat: -23.5, geo_lon: -47.4 }],
      ["b", { sale_id: "b", geo_key: geoKeyVenda(b), geo_lat: null, geo_lon: null }],
      ["d", { sale_id: "d", geo_key: "endereco antigo", geo_lat: -1, geo_lon: -1 }],
    ]);
    const { noMapa, semLocal } = vendasNoMapa([a, b, c, d], geo);
    expect(noMapa.map((v) => v.saleId)).toEqual(["a"]);
    expect(noMapa[0]).toMatchObject({ lat: -23.5, lon: -47.4 });
    expect(semLocal).toBe(3);
    // pendentes: só a que mudou de endereço (b já foi procurada; c não tem endereço)
    expect(vendasPendentesGeo([a, b, c, d], geo).map((v) => v.saleId)).toEqual(["d"]);
  });

  it("filtros da tela também filtram os pinos", () => {
    const a = venda({ sale_id: "a", imovel_bairro: "Campolim", data_fechamento: "2026-09-01" });
    const b = venda({ sale_id: "b", imovel_bairro: "Centro", data_fechamento: "2026-09-02" });
    const geo = new Map<string, SaleGeo>(
      [a, b].map((v) => [
        v.saleId,
        { sale_id: v.saleId, geo_key: geoKeyVenda(v), geo_lat: 1, geo_lon: 1 },
      ]),
    );
    const f = filtrarVendas([a, b], { dataDe: "", dataAte: "", busca: "campolim" });
    expect(vendasNoMapa(f, geo).noMapa.map((v) => v.saleId)).toEqual(["a"]);
  });
});
