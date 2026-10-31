import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("FASE 2 D6 — item 25 (celular)", () => {
  it("botões, campos, seletores, abas e dias do calendário têm 40px no celular", () => {
    expect(ler("../components/ui/button.tsx")).toContain("max-md:min-h-10");
    expect(ler("../components/ui/button.tsx")).toContain('icon: "h-9 w-9 max-md:min-w-10"');
    expect(ler("../components/ui/input.tsx")).toContain("max-md:min-h-10");
    expect(ler("../components/ui/select.tsx")).toContain("max-md:min-h-10");
    expect(ler("../components/ui/tabs.tsx")).toContain("max-md:min-h-10");
    expect(ler("../components/ui/calendar.tsx")).toContain("max-md:[--cell-size:2.5rem]");
    expect(ler("../components/NotificationBell.tsx")).toContain("h-10 w-10 md:h-9 md:w-9");
  });

  it("janelas têm altura máxima com área segura e o Fechar é em português e com 40px", () => {
    for (const p of ["../components/ui/dialog.tsx", "../components/ui/alert-dialog.tsx"]) {
      const s = ler(p);
      expect(s).toContain(
        "max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]",
      );
      expect(s).toContain("overflow-y-auto");
    }
    for (const p of ["../components/ui/dialog.tsx", "../components/ui/sheet.tsx"]) {
      const s = ler(p);
      expect(s).not.toContain(">Close<");
      expect(s).toContain('aria-label="Fechar"');
      expect(s).toContain("h-10 w-10");
    }
    // A área segura do PR #235 continua no Fechar da gaveta.
    expect(ler("../components/ui/sheet.tsx")).toContain(
      "top-[calc(0.5rem+env(safe-area-inset-top))]",
    );
  });

  it("detalhe do chamado abre por cima da lista em telas estreitas", () => {
    const ajuda = ler("../routes/_authenticated/ajuda.tsx");
    const central = ler("../routes/_authenticated/plataforma.chamados.tsx");
    expect(ajuda).toContain("useTelaEstreita(1024)");
    expect(ajuda).toContain("<DetalhePorCima");
    expect(central).toContain("useTelaEstreita(1280)");
    expect(central).toContain("<DetalhePorCima");
  });

  it("Salas no celular é uma lista por sala, sem a grade de 760px", () => {
    const salas = ler("../routes/_authenticated/reservas-salas.tsx");
    expect(salas).toContain('data-testid="salas-lista-celular"');
    expect(salas).toContain('className="space-y-3 md:hidden"');
    expect(salas).toContain('className="hidden overflow-x-auto md:block"');
    // Enquanto carrega ou se falhar, nada aparece como livre (mesma regra do item 5).
    const lista = salas.slice(salas.indexOf("salas-lista-celular"), salas.indexOf("min-w-[760px]"));
    expect(lista).toContain("getRoomSlotState(");
    expect(lista).toContain('e.estado === "livre"');
  });
});
