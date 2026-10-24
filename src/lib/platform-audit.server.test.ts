import { describe, expect, it } from "vitest";
import { platformAuditRow } from "./platform-audit.server";

describe("auditoria de ações da plataforma (t_2cd53d1e)", () => {
  it("grava na imobiliária do alvo, sem autor_id, com o ator no payload", () => {
    expect(
      platformAuditRow({
        orgId: "org-alvo",
        actorId: "super-admin",
        acao: "user_updated_platform",
        payload: { target_user: "u1", motivo: "Gestão" },
      }),
    ).toEqual({
      organization_id: "org-alvo",
      autor_id: null,
      sale_id: null,
      acao: "user_updated_platform",
      payload: { target_user: "u1", motivo: "Gestão", ator_plataforma_id: "super-admin" },
    });
  });

  it("o payload não sobrescreve o ator real", () => {
    const row = platformAuditRow({
      orgId: "org-alvo",
      actorId: "super-admin",
      acao: "x",
      payload: { ator_plataforma_id: "forjado" },
    });
    expect(row.payload.ator_plataforma_id).toBe("super-admin");
  });

  it("falha fechada sem imobiliária ou sem ator", () => {
    expect(() => platformAuditRow({ orgId: "", actorId: "a", acao: "x", payload: {} })).toThrow(
      /imobiliária/,
    );
    expect(() => platformAuditRow({ orgId: "o", actorId: "", acao: "x", payload: {} })).toThrow(
      /autor/,
    );
  });
});
