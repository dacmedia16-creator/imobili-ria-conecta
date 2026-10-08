import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { captureValidity, validityElapsedPct, type Capture } from "./exclusive-captures";
import { VigenciaBar } from "../components/exclusividades/VigenciaBar";

const form = { condicoes: { prazo_dias_numero: "180" } } as unknown as Capture["form_data"];
const v = (today: string) => captureValidity({ signed_on: "2026-10-01", form_data: form }, today)!;
const html = (today: string, compact = false) =>
  renderToStaticMarkup(React.createElement(VigenciaBar, { v: v(today), compact }));
const text = (h: string) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

describe("barra de Vigência", () => {
  it("usa o mesmo cálculo do detalhe (print de Denis: 173 de 180, 4%)", () => {
    expect(v("2026-10-08").daysLeft).toBe(173);
    expect(validityElapsedPct(v("2026-10-08"))).toBe(4);
    expect(validityElapsedPct(v("2027-06-01"))).toBe(100);
    expect(validityElapsedPct(v("2026-09-01"))).toBe(0);
  });

  it("versão do card: barra, 'Faltam X dias de Y' e vencimento", () => {
    const out = html("2026-10-08", true);
    expect(out).toContain('aria-valuenow="4"');
    expect(out).toContain("width:4%");
    expect(text(out)).toContain("Faltam 173 dias de 180");
    expect(text(out)).toContain("Vence em 30/03/2027");
    expect(text(out)).not.toContain("Assinada em");
  });

  it("vencida mostra 'Venceu há' no card", () => {
    const t = text(html("2027-04-02", true));
    expect(t).toContain("Venceu há 3 dias");
    expect(t).toContain("Venceu em 30/03/2027");
  });

  it("versão do detalhe mantém título, selo e % do prazo", () => {
    const t = text(html("2026-10-08"));
    expect(t).toContain("Vigência");
    expect(t).toContain("Vence em 173 dias (30/03/2027)");
    expect(t).toContain("Assinada em 01/10/2026");
    expect(t).toContain("Faltam 173 dias de 180 (4% do prazo já passou).");
  });

  it("sem assinatura não há vigência (card não mostra barra)", () => {
    expect(captureValidity({ signed_on: null, form_data: form }, "2026-10-08")).toBeNull();
  });
});
