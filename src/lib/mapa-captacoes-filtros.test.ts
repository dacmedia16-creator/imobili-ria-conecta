import { describe, expect, it } from "vitest";
import type { CaptacaoMapaRow } from "@/lib/mapa-captacoes";
import { linhasCaptacao, linksCaptador } from "@/lib/mapa-captacoes";
import {
  FILTROS_VAZIOS,
  filtrarCaptacoes,
  filtrosAtivos,
  opcoesFiltro,
  precoNumero,
  precoTexto,
  tipoLabel,
  whatsappLink,
  whatsappNumero,
} from "@/lib/mapa-captacoes-filtros";

const row = (p: Partial<CaptacaoMapaRow>): CaptacaoMapaRow => ({
  id: "c1",
  codigo: "AB12CD34",
  tipo_imovel: "Casa",
  bairro: "Parque Campolim",
  cidade: "Sorocaba",
  captador: "Ana Corretora",
  geo_lat: -23.5,
  geo_lon: -47.4,
  detalhe: false,
  pode_abrir: false,
  endereco: null,
  status: null,
  signed_on: null,
  prazo_dias: null,
  estado: null,
  geo_key: null,
  valor_imovel: "R$ 850.000,00",
  captador_id: "u1",
  captador_telefone: "(15) 99999-0001",
  captador_email: "ana@example.test",
  equipe: "Equipe Azul",
  ...p,
});

const lista = [
  row({}),
  row({
    id: "c2",
    tipo_imovel: "APARTAMENTO",
    bairro: "Centro",
    valor_imovel: "420.000",
    captador: "Beto",
    equipe: "Equipe Verde",
  }),
  row({
    id: "c3",
    tipo_imovel: "apartamento",
    bairro: "Jardim São Paulo",
    cidade: "Votorantim",
    valor_imovel: null,
    equipe: null,
  }),
];

describe("preço", () => {
  it("lê os formatos gravados na captação", () => {
    expect(precoNumero("R$ 850.000,00")).toBe(850000);
    expect(precoNumero("420.000")).toBe(420000);
    expect(precoNumero("")).toBeNull();
    expect(precoNumero(null)).toBeNull();
    expect(precoTexto("R$ 850.000,00")).toMatch(/R\$\s?850\.000/);
    expect(precoTexto(null)).toBe("Preço não informado");
  });
});

describe("WhatsApp do captador", () => {
  it("monta wa.me com DDI 55 e a mensagem com o código", () => {
    expect(whatsappNumero("(15) 99999-0001")).toBe("5515999990001");
    expect(whatsappNumero("+55 15 3333-4444")).toBe("551533334444");
    expect(whatsappNumero("123")).toBeNull();
    expect(whatsappLink("(15) 99999-0001", "AB12")).toBe(
      "https://wa.me/5515999990001?text=" +
        encodeURIComponent("Olá! Vi a captação AB12 no mapa de captações."),
    );
  });
  it("balão: preço, captador com equipe, telefone, e-mail e botões de contato", () => {
    const linhas = linhasCaptacao(row({}), "2026-10-08").map((l) => l.text);
    expect(linhas[1]).toMatch(/850\.000/);
    expect(linhas).toContain("Captador: Ana Corretora (Equipe Azul)");
    expect(linhas).toContain("Tel.: (15) 99999-0001");
    expect(linhas).toContain("E-mail: ana@example.test");
    expect(linksCaptador(row({})).map((l) => l.text)).toEqual(["WhatsApp do captador", "E-mail"]);
    expect(linksCaptador(row({ captador_telefone: null, captador_email: null }))).toEqual([]);
  });
});

describe("filtros do mapa", () => {
  it("sem filtro: todas", () => {
    expect(filtrarCaptacoes(lista, FILTROS_VAZIOS)).toHaveLength(3);
    expect(filtrosAtivos(FILTROS_VAZIOS)).toBe(0);
  });
  it("busca por bairro/cidade sem acento e sem caixa", () => {
    const f = { ...FILTROS_VAZIOS, busca: "jardim sao paulo" };
    expect(filtrarCaptacoes(lista, f).map((r) => r.id)).toEqual(["c3"]);
    expect(
      filtrarCaptacoes(lista, { ...FILTROS_VAZIOS, busca: "votorantim" }).map((r) => r.id),
    ).toEqual(["c3"]);
  });
  it("tipo normalizado junta APARTAMENTO e apartamento", () => {
    expect(tipoLabel("APARTAMENTO")).toBe("Apartamento");
    expect(opcoesFiltro(lista).tipos).toEqual(["Apartamento", "Casa"]);
    const f = { ...FILTROS_VAZIOS, tipo: "Apartamento" };
    expect(filtrarCaptacoes(lista, f).map((r) => r.id)).toEqual(["c2", "c3"]);
  });
  it("faixa de preço; sem preço sai quando há faixa", () => {
    const f = { ...FILTROS_VAZIOS, precoMin: "400000", precoMax: "500.000" };
    expect(filtrarCaptacoes(lista, f).map((r) => r.id)).toEqual(["c2"]);
    expect(filtrarCaptacoes(lista, { ...FILTROS_VAZIOS, precoMin: "1" }).map((r) => r.id)).toEqual([
      "c1",
      "c2",
    ]);
  });
  it("captador e equipe", () => {
    expect(
      filtrarCaptacoes(lista, { ...FILTROS_VAZIOS, captador: "Beto" }).map((r) => r.id),
    ).toEqual(["c2"]);
    expect(
      filtrarCaptacoes(lista, { ...FILTROS_VAZIOS, equipe: "Equipe Azul" }).map((r) => r.id),
    ).toEqual(["c1"]);
    expect(opcoesFiltro(lista).equipes).toEqual(["Equipe Azul", "Equipe Verde"]);
  });
});
