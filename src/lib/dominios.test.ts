import { describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  CONTA_MAX_ORIGENS_ACEITAS,
  contaMaxLoginUrl,
  isContaMaxLoginUrl,
} from "./dominios";

describe("dominios (migração somosmaxhub, t_97380535)", () => {
  it("portal e login apontam para o domínio novo", () => {
    expect(APP_ORIGIN).toBe("https://app.somosmaxhub.com.br");
    expect(contaMaxLoginUrl("adm-max")).toBe("https://conta.somosmaxhub.com.br/login?app=adm-max");
    expect(contaMaxLoginUrl("adm-max", "/reservas-salas")).toBe(
      "https://conta.somosmaxhub.com.br/login?app=adm-max&return_to=%2Freservas-salas",
    );
  });

  it("convite aceita as duas origens da Conta MAX durante a convivência", () => {
    expect(CONTA_MAX_ORIGENS_ACEITAS).toEqual([
      "https://conta.somosmaxhub.com.br",
      "https://conta.unicaescolha.com.br",
    ]);
    expect(isContaMaxLoginUrl(new URL("https://conta.somosmaxhub.com.br/login?app=adm-max"))).toBe(
      true,
    );
    expect(
      isContaMaxLoginUrl(new URL("https://conta.unicaescolha.com.br/login?app=adm-max-homolog")),
    ).toBe(true);
  });

  it("convite recusa outros endereços e outros caminhos", () => {
    expect(isContaMaxLoginUrl(new URL("https://app.somosmaxhub.com.br/login"))).toBe(false);
    expect(isContaMaxLoginUrl(new URL("https://conta.somosmaxhub.com.br/logout"))).toBe(false);
    expect(isContaMaxLoginUrl(new URL("https://conta.somosmaxhub.com.br.evil.com/login"))).toBe(
      false,
    );
    expect(isContaMaxLoginUrl(new URL("http://conta.somosmaxhub.com.br/login"))).toBe(false);
  });
});
