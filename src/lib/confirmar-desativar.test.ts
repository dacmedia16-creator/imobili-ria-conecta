import { describe, expect, it } from "vitest";
import {
  DESCRICAO_CONFIRMAR_DESATIVAR,
  podeConfirmarDesativar,
  precisaConfirmarStatus,
  tituloConfirmarDesativar,
} from "./confirmar-desativar";

describe("confirmação de desativar usuário", () => {
  it("desativar pede confirmação; ativar continua com um clique", () => {
    expect(precisaConfirmarStatus(true)).toBe(true);
    expect(precisaConfirmarStatus(false)).toBe(false);
  });

  it("monta o título com o nome e tem fallback", () => {
    expect(tituloConfirmarDesativar("Ana Fictícia")).toBe("Desativar Ana Fictícia?");
    expect(tituloConfirmarDesativar("  ")).toBe("Desativar este usuário?");
    expect(tituloConfirmarDesativar(null)).toBe("Desativar este usuário?");
    expect(DESCRICAO_CONFIRMAR_DESATIVAR).toBe("Ele não vai mais conseguir entrar no sistema.");
  });

  it("fora da plataforma confirma direto; na plataforma exige motivo de 5+ caracteres", () => {
    expect(podeConfirmarDesativar(false, "")).toBe(true);
    expect(podeConfirmarDesativar(true, "")).toBe(false);
    expect(podeConfirmarDesativar(true, " abc ")).toBe(false);
    expect(podeConfirmarDesativar(true, "pedido do admin")).toBe(true);
  });
});
