import { describe, expect, it } from "vitest";
import {
  agruparPorRegiao,
  filtrarVendas,
  montarVendas,
  SEM_BAIRRO,
  SEM_CIDADE,
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
