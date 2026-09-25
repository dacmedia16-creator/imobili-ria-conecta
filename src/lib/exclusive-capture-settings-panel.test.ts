import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { ExclusiveSettingsPanel } from "../routes/_authenticated/admin.configuracoes";

function render(enabled: boolean | null) {
  return renderToStaticMarkup(
    React.createElement(ExclusiveSettingsPanel, {
      enabled,
      saving: false,
      confirmEnable: false,
      onConfirmEnableChange: vi.fn(),
      onChange: vi.fn(),
      onReload: vi.fn(),
    }),
  );
}

function clickMainButton(enabled: boolean) {
  const onChange = vi.fn();
  const onConfirmEnableChange = vi.fn();
  const panel = ExclusiveSettingsPanel({
    enabled,
    saving: false,
    confirmEnable: false,
    onConfirmEnableChange,
    onChange,
    onReload: vi.fn(),
  });
  function button(node: React.ReactNode): React.ReactElement | null {
    if (!React.isValidElement(node)) return null;
    const props = node.props as { children?: React.ReactNode; onClick?: () => void };
    if (props.children === "Ligar captações" || props.children === "Desligar captações")
      return node;
    for (const child of React.Children.toArray(props.children)) {
      const found = button(child);
      if (found) return found;
    }
    return null;
  }
  const target = button(panel);
  expect(target).not.toBeNull();
  (target!.props as { onClick: () => void }).onClick();
  return { onChange, onConfirmEnableChange };
}

describe("painel de controle das captações", () => {
  it("desligado: exibe o estado e exige confirmação antes de ligar", () => {
    const html = render(false);
    expect(html).toContain("Estado atual: Desligado");
    expect(html).toContain("Ligar captações");
    expect(html).toContain("preserva captações, documentos e histórico");
    const actions = clickMainButton(false);
    expect(actions.onConfirmEnableChange).toHaveBeenCalledWith(true);
    expect(actions.onChange).not.toHaveBeenCalled();
  });
  it("ligado: permite desligar e informa que preserva os dados", () => {
    const html = render(true);
    expect(html).toContain("Estado atual: Ligado");
    expect(html).toContain("Desligar captações");
    expect(html).toContain("preserva captações, documentos e histórico");
    const actions = clickMainButton(true);
    expect(actions.onChange).toHaveBeenCalledWith(false);
    expect(actions.onConfirmEnableChange).not.toHaveBeenCalled();
  });
  it("falha de leitura: não permite alteração com estado desconhecido", () => {
    const html = render(null);
    expect(html).toContain("Estado atual: indisponível");
    expect(html).toContain("Consultar estado novamente");
    expect(html).not.toContain("Desligar captações</button>");
    expect(html).not.toContain("Ligar captações</button>");
  });
});
