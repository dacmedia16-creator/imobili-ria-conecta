import { describe, expect, it } from "vitest";
import { expiringItems, expiryMessage, weekStart } from "./exclusive-expiry-alerts.server";
import { emptyForm, type Capture } from "./exclusive-captures";

const mk = (signed_on: string, over: Partial<Capture> = {}): Capture => {
  const f = emptyForm();
  f.condicoes.prazo_dias_numero = "180";
  f.imovel.endereco = "Rua Inglaterra, 348";
  f.imovel.bairro = "Jardim Europa";
  f.proprietario_1.nome_completo = "Fulano Proprietario";
  return {
    id: signed_on,
    captor_id: "u",
    template: "campolim",
    status: "aprovada",
    form_data: f,
    broker_name: "Maiana",
    broker_cpf: "",
    broker_creci: "",
    created_on_sp: "2026-01-01",
    created_at: "",
    archived_at: null,
    signed_on,
    ...over,
  } as Capture;
};

describe("alerta semanal de vencimento", () => {
  const today = "2026-10-03";
  it("pega só as que vencem em até 30 dias ou venceram há até 30 dias", () => {
    const xs = expiringItems(
      [
        mk("2026-10-01"), // vence 30/03/2027 — fora
        mk("2026-04-20"), // vence 17/10/2026 — dentro
        mk("2026-03-20"), // venceu 16/09/2026 — dentro
        mk("2026-01-01"), // venceu há mais de 30 dias — fora
        mk("2026-04-20", { status: "enviada" }),
        mk("2026-04-20", { archived_at: "x" }),
      ],
      today,
    );
    expect(xs.map((x) => x.v.end)).toEqual(["2026-09-16", "2026-10-17"]);
  });
  it("mensagem sem dado do proprietário e em ASCII", () => {
    const msg = expiryMessage(expiringItems([mk("2026-04-20"), mk("2026-03-20")], today));
    expect(msg).toContain("Ja vencidas");
    expect(msg).toContain("captador: Maiana | vence em 17/10/2026 (14 dias)");
    expect(msg).not.toContain("Fulano");
    expect([...msg].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });
  it("semana começa na segunda", () => {
    expect(weekStart("2026-10-03")).toBe("2026-09-28");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });
});
