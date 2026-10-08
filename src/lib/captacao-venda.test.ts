import { describe, expect, it } from "vitest";
import {
  diasEntre,
  haQuantosDias,
  rotuloDocumentoHerdado,
  seloSituacaoCaptacao,
} from "@/lib/captacao-venda";
import {
  COR_CAPTACAO,
  COR_NEGOCIACAO,
  linhasCaptacao,
  pinosCaptacoes,
  type CaptacaoMapaRow,
} from "@/lib/mapa-captacoes";

const row = (p: Partial<CaptacaoMapaRow>): CaptacaoMapaRow => ({
  id: "c1",
  codigo: "AB12CD34",
  tipo_imovel: "Casa em condomínio",
  bairro: "Jardim Fictício",
  cidade: "Sorocaba",
  captador: "Bruno Exemplo",
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

describe("Virou venda — situação da captação", () => {
  it("conta dias em negociação por data civil, sem negativo", () => {
    expect(diasEntre("2026-10-01", "2026-10-08")).toBe(7);
    expect(diasEntre("2026-10-08", "2026-10-08")).toBe(0);
    expect(diasEntre("2026-10-09", "2026-10-08")).toBe(0);
    expect(diasEntre(null, "2026-10-08")).toBeNull();
    expect(diasEntre("lixo", "2026-10-08")).toBeNull();
    expect(haQuantosDias(0)).toBe("hoje");
    expect(haQuantosDias(1)).toBe("há 1 dia");
    expect(haQuantosDias(12)).toBe("há 12 dias");
  });

  it("rascunho não muda a captação; em negociação e vendida têm selo", () => {
    expect(seloSituacaoCaptacao("rascunho")).toBeNull();
    expect(seloSituacaoCaptacao(null)).toBeNull();
    expect(seloSituacaoCaptacao("em_negociacao")?.texto).toBe("Em negociação");
    expect(seloSituacaoCaptacao("vendida")?.texto).toBe("Vendida");
  });

  it("documentos herdados com nome legível por proprietário", () => {
    expect(rotuloDocumentoHerdado("rg", 1)).toBe("RG — proprietário 1");
    expect(rotuloDocumentoHerdado("matricula", 0)).toBe("Matrícula");
    expect(rotuloDocumentoHerdado("assinado", 0)).toBe("Contrato de exclusividade assinado");
  });

  it("mapa: captação em negociação tem pino laranja e linha com os dias, para todos", () => {
    const r = row({ negociacao: true, negociacao_desde: "2026-10-05" });
    const [p] = pinosCaptacoes([r], "2026-10-08");
    expect(p.color).toBe(COR_NEGOCIACAO);
    expect(linhasCaptacao(r, "2026-10-08").map((l) => l.text)).toContain("Em negociação há 3 dias");
  });

  it("mapa: sem negociação, cor e balão continuam iguais (sem regressão)", () => {
    const r = row({ negociacao: false });
    const [p] = pinosCaptacoes([r], "2026-10-08");
    expect(p.color).toBe(COR_CAPTACAO);
    expect(
      linhasCaptacao(r, "2026-10-08")
        .map((l) => l.text)
        .join(" "),
    ).not.toMatch(/negocia/i);
  });
});
