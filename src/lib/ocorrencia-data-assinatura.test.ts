import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TEXTO_ORIGEM_DATA_ASSINATURA,
  camposSalvaveisOcorrencia,
  dataAssinaturaExibida,
  dataAssinaturaOcorrenciaTravada,
} from "./ocorrencia-data-assinatura";

const CAMPOS = ["codigo_imovel", "data_assinatura", "midia", "observacoes"] as const;
const tela = readFileSync(
  new URL("../routes/_authenticated/vendas.$id.tsx", import.meta.url),
  "utf8",
);

describe("data de assinatura da ocorrência (opção A, Denis 13/10)", () => {
  it("venda padrão: campo travado e fora do payload de salvamento", () => {
    expect(dataAssinaturaOcorrenciaTravada("padrao")).toBe(true);
    expect(dataAssinaturaOcorrenciaTravada(null)).toBe(true);
    expect(camposSalvaveisOcorrencia(CAMPOS, "padrao")).toEqual([
      "codigo_imovel",
      "midia",
      "observacoes",
    ]);
  });

  it("Lançamento: comportamento inalterado (campo editável e salvo)", () => {
    expect(dataAssinaturaOcorrenciaTravada("lancamento")).toBe(false);
    expect(camposSalvaveisOcorrencia(CAMPOS, "lancamento")).toEqual([...CAMPOS]);
  });

  it("mostra a data oficial; sem histórico, mantém a data já gravada", () => {
    expect(dataAssinaturaExibida("2026-09-04", "2026-08-25")).toBe("2026-09-04");
    expect(dataAssinaturaExibida(null, "2026-08-25")).toBe("2026-08-25");
    expect(dataAssinaturaExibida(null, null)).toBe("");
    expect(TEXTO_ORIGEM_DATA_ASSINATURA).toContain("contrato assinado");
  });

  it("tela usa o campo somente leitura e filtra o salvamento pela modalidade", () => {
    expect(tela).toContain('rpc("data_assinatura_oficial", { _sale_id: saleId })');
    expect(tela).toContain("camposSalvaveisOcorrencia<keyof OccurrenceRow>(");
    expect(tela).toMatch(/\],\s*sale\.modalidade,?\s*\);/);
    const travado = tela.slice(
      tela.indexOf('data-testid="ocorrencia-data-assinatura-oficial"'),
      tela.indexOf("TEXTO_SEM_HISTORICO_ASSINATURA}"),
    );
    expect(travado).toContain("readOnly");
    expect(travado).not.toContain("onChange");
  });
});
