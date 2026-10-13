import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TEXTO_ORIGEM_DATA_ASSINATURA,
  camposSalvaveisOcorrencia,
  dataAssinaturaExibida,
  dataAssinaturaOcorrenciaTravada,
  dataAssinaturaParaAlinhar,
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

  describe("salvar alinha a data gravada à data oficial (venda padrão)", () => {
    it("oficial diferente da gravada entra no patch", () => {
      expect(dataAssinaturaParaAlinhar("padrao", "2026-09-04", "2026-08-25")).toBe("2026-09-04");
      expect(dataAssinaturaParaAlinhar(null, "2026-09-04", null)).toBe("2026-09-04");
    });

    it("oficial igual à gravada não entra no patch", () => {
      expect(dataAssinaturaParaAlinhar("padrao", "2026-09-04", "2026-09-04")).toBeNull();
    });

    it("oficial null (RPC falhou) não entra no patch; Lançamento também não", () => {
      expect(dataAssinaturaParaAlinhar("padrao", null, "2026-08-25")).toBeNull();
      expect(dataAssinaturaParaAlinhar("padrao", undefined, null)).toBeNull();
      expect(dataAssinaturaParaAlinhar("lancamento", "2026-09-04", "2026-08-25")).toBeNull();
    });

    it("save() da tela aplica o alinhamento no patch da ocorrência", () => {
      expect(tela).toMatch(
        /dataAssinaturaParaAlinhar\(\s*sale\.modalidade,\s*dataAssinaturaOficial,\s*occ\?\.data_assinatura,?\s*\)/,
      );
      expect(tela).toContain("if (dataAlinhada) patch.data_assinatura = dataAlinhada;");
    });
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
