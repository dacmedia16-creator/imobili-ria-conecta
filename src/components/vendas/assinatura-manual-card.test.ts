// @vitest-environment jsdom
// Cartão "Assinatura manual (papel)" por papel: o jurídico só sobe/substitui o contrato assinado;
// "Marcar contrato assinado" fica com gestor/team leader e ADM (correção de Denis 19/10, t_6efe0960).
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssinaturaManualCard } from "./AssinaturaManualVenda";
import { podeMarcarAssinado, podeOperarAssinatura, type PapeisAssinatura } from "@/lib/assinatura-manual";

const P = {
  gestor: { isGestor: true, isJuridico: false, isAdminLike: false },
  juridico: { isGestor: false, isJuridico: true, isAdminLike: false },
  adm: { isGestor: false, isJuridico: false, isAdminLike: true },
  corretor: { isGestor: false, isJuridico: false, isAdminLike: false },
} satisfies Record<string, PapeisAssinatura>;

const noop = () => {};
const card = (p: PapeisAssinatura, assinadoNome: string | null) =>
  render(
    createElement(AssinaturaManualCard, {
      podeOperar: podeOperarAssinatura(p),
      podeMarcar: podeMarcarAssinado(p),
      podeDevolver: false,
      podeTrocarParaClicksign: false,
      assinadoNome,
      onSubir: noop,
      onMarcar: noop,
      onTrocarParaClicksign: noop,
      onDevolver: noop,
    }),
  );

afterEach(cleanup);

describe("cartão Assinatura manual: quem marca como assinado", () => {
  it("jurídico vê Subir/Substituir e NÃO vê Marcar contrato assinado", () => {
    card(P.juridico, null);
    expect(screen.getByRole("button", { name: /Subir contrato assinado/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Marcar contrato assinado/ })).toBeNull();
    cleanup();
    card(P.juridico, "assinado.pdf");
    expect(screen.getByRole("button", { name: /Substituir contrato assinado/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Marcar contrato assinado/ })).toBeNull();
    expect(screen.getByText(/gestor, team leader ou ADM confere e marca/)).toBeTruthy();
  });
  it("gestor e ADM veem Marcar contrato assinado", () => {
    for (const p of [P.gestor, P.adm]) {
      card(p, "assinado.pdf");
      expect(screen.getByRole("button", { name: /Marcar contrato assinado/ })).toBeTruthy();
      cleanup();
    }
  });
  it("corretor: nenhum botão", () => {
    card(P.corretor, "assinado.pdf");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
