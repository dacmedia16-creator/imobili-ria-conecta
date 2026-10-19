// @vitest-environment jsdom
// Escolha "Como vai ser assinado?" com os rótulos do atalho do gestor e seletor de arquivo do padrão
// do sistema (t_70ebc484).
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EscolhaAssinaturaVenda } from "./AssinaturaManualVenda";
import { SeletorArquivo } from "./SeletorArquivo";

afterEach(cleanup);

const escolha = (over: Record<string, unknown> = {}) => {
  const onClicksign = vi.fn();
  const onManual = vi.fn(async () => {});
  render(
    createElement(EscolhaAssinaturaVenda, {
      bloqueado: false,
      contratoNome: "contrato.pdf",
      tituloClicksign: "Assinatura digital (Clicksign)",
      tituloManual: "Manual (papel)",
      onClicksign,
      onManual,
      ...over,
    }),
  );
  return { onClicksign, onManual };
};

describe("atalho do gestor: Como vai ser assinado?", () => {
  it("mostra 'Assinatura digital (Clicksign)' e 'Manual (papel)'", () => {
    escolha();
    expect(screen.getByText("Como vai ser assinado?")).toBeTruthy();
    expect(screen.getByText("Assinatura digital (Clicksign)")).toBeTruthy();
    expect(screen.getByText("Manual (papel)")).toBeTruthy();
  });
  it("digital segue o fluxo da Clicksign, sem mudar status", () => {
    const { onClicksign, onManual } = escolha();
    fireEvent.click(screen.getByRole("button", { name: /Continuar com a Clicksign/ }));
    expect(onClicksign).toHaveBeenCalledTimes(1);
    expect(onManual).not.toHaveBeenCalled();
  });
  it("papel pede confirmação antes de mudar a etapa", async () => {
    const { onClicksign, onManual } = escolha();
    fireEvent.click(screen.getByTestId("escolha-manual"));
    fireEvent.click(screen.getByRole("button", { name: /Continuar com assinatura manual/ }));
    expect(onManual).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar: assinatura manual/ }));
    await waitFor(() => expect(onManual).toHaveBeenCalledTimes(1));
    expect(onClicksign).not.toHaveBeenCalled();
  });
  it("trava quando o jurídico não liberou a assinatura", () => {
    escolha({ bloqueado: true });
    expect(
      (screen.getByRole("button", { name: /Continuar com a Clicksign/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("sem rótulos próprios mantém os textos de contrato_ok_corretor", () => {
    escolha({ tituloClicksign: undefined, tituloManual: undefined });
    expect(screen.getByText("Pela Clicksign (sistema)")).toBeTruthy();
    expect(screen.getByText("Manual – papel")).toBeTruthy();
  });
});

describe("SeletorArquivo", () => {
  it("mostra 'Escolher arquivo' em português do Brasil e o nome escolhido", () => {
    const onChange = vi.fn();
    const { rerender } = render(createElement(SeletorArquivo, { arquivo: null, onChange }));
    expect(screen.getByText("Escolher arquivo")).toBeTruthy();
    expect(screen.getByTestId("seletor-arquivo-nome").textContent).toBe(
      "Nenhum arquivo selecionado",
    );
    const f = new File(["x"], "GORETI - Contrato de Compra e Venda - Financiamento.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText("Escolher arquivo"), { target: { files: [f] } });
    expect(onChange).toHaveBeenCalledWith(f);
    rerender(createElement(SeletorArquivo, { arquivo: f, onChange }));
    expect(screen.getByTestId("seletor-arquivo-nome").textContent).toBe(f.name);
  });
});
