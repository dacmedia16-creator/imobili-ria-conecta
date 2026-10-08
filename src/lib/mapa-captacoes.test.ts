import { describe, expect, it } from "vitest";
import {
  captacoesPendentesGeo,
  COR_CAPTACAO,
  linhasCaptacao,
  pinosCaptacoes,
  type CaptacaoMapaRow,
} from "@/lib/mapa-captacoes";

const row = (p: Partial<CaptacaoMapaRow>): CaptacaoMapaRow => ({
  id: "c1",
  codigo: "AB12CD34",
  tipo_imovel: "Casa",
  bairro: "PARQUE CAMPOLIM",
  cidade: "Sorocaba",
  captador: "Fulano Corretor",
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
  ...p,
});

describe("mapa das captações", () => {
  it("balão de quem não é gestor/admin: código, tipo, bairro, cidade e captador — sem endereço nem situação", () => {
    const linhas = linhasCaptacao(row({}), "2026-10-08").map((l) => l.text);
    expect(linhas).toEqual([
      "Captação AB12CD34 · Casa",
      "Parque Campolim · Sorocaba",
      "Captador: Fulano Corretor",
      "Localização aproximada",
    ]);
  });

  it("gestor/admin vê também endereço e situação; cor pela situação", () => {
    const r = row({
      detalhe: true,
      pode_abrir: true,
      endereco: "Rua X, 10",
      status: "aprovada",
      signed_on: "2026-09-01",
      prazo_dias: "180",
    });
    const linhas = linhasCaptacao(r, "2026-10-08").map((l) => l.text);
    expect(linhas[1]).toBe("Rua X, 10");
    expect(linhas[linhas.length - 1]).toMatch(/^Em vigor/);
    const [p] = pinosCaptacoes([r], "2026-10-08");
    expect(p.color).not.toBe(COR_CAPTACAO);
    expect(p.actionLabel).toBe("Abrir captação →");
  });

  it("sem detalhe: cor única, sem botão de abrir; sem coordenada fica fora do mapa", () => {
    const pins = pinosCaptacoes(
      [row({}), row({ id: "c2", geo_lat: null, geo_lon: null })],
      "2026-10-08",
    );
    expect(pins).toHaveLength(1);
    expect(pins[0].color).toBe(COR_CAPTACAO);
    expect(pins[0].actionLabel).toBeUndefined();
  });

  it("só localiza captações que a pessoa pode abrir e que têm endereço novo", () => {
    const minha = row({
      id: "m",
      detalhe: true,
      pode_abrir: true,
      endereco: "Rua X, 10",
      geo_lat: null,
      geo_lon: null,
    });
    const jaLocalizada = row({
      id: "j",
      detalhe: true,
      pode_abrir: true,
      endereco: "Rua X, 10",
      geo_key: "rua x, 10|parque campolim|sorocaba|",
    });
    const deOutro = row({ id: "o", geo_lat: null, geo_lon: null });
    expect(captacoesPendentesGeo([minha, jaLocalizada, deOutro]).map((r) => r.id)).toEqual(["m"]);
  });
});
