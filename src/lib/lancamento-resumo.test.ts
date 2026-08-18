import { describe, it, expect } from "vitest";
import { sanitizeLancamentoResumoPayload } from "./lancamento-resumo";

// BUG #1 (regressão): data_assinatura/previsao_recebimento_data (colunas `date`) e midia (CHECK
// constraint) nunca podem virar "" no payload enviado pro banco.
describe("sanitizeLancamentoResumoPayload", () => {
  it("converte data_assinatura vazia para null", () => {
    const r = sanitizeLancamentoResumoPayload({ data_assinatura: "" });
    expect(r.data_assinatura).toBeNull();
  });
  it("converte midia vazia para null", () => {
    const r = sanitizeLancamentoResumoPayload({ midia: "" });
    expect(r.midia).toBeNull();
  });
  it("converte previsao_recebimento_data vazia para null", () => {
    const r = sanitizeLancamentoResumoPayload({ previsao_recebimento_data: "" });
    expect(r.previsao_recebimento_data).toBeNull();
  });
  it("preserva valores válidos sem alteração", () => {
    const r = sanitizeLancamentoResumoPayload({
      data_assinatura: "2026-08-17",
      midia: "Portal",
      previsao_recebimento_data: "2026-09-01",
    });
    expect(r).toEqual({
      data_assinatura: "2026-08-17",
      midia: "Portal",
      previsao_recebimento_data: "2026-09-01",
    });
  });
  it("preserva null já existente sem transformar em outra coisa", () => {
    const r = sanitizeLancamentoResumoPayload({ data_assinatura: null, midia: null });
    expect(r.data_assinatura).toBeNull();
    expect(r.midia).toBeNull();
  });
  it('não mexe em outros campos do form (ex. observações em texto livre podem ficar "")', () => {
    const r = sanitizeLancamentoResumoPayload({
      negociacao_observacoes: "",
      previsao_recebimento_forma: "",
      valor_negociado: 100000,
    });
    expect(r).toEqual({
      negociacao_observacoes: "",
      previsao_recebimento_forma: "",
      valor_negociado: 100000,
    });
  });
});
