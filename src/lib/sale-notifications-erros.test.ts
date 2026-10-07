import { describe, expect, it } from "vitest";
import { erroSemDadosPessoais } from "@/lib/sale-notifications.functions";

describe("erroSemDadosPessoais", () => {
  it("mascara telefone em vários formatos", () => {
    expect(erroSemDadosPessoais("invalid mobile_phone 5515999998888")).toBe(
      "invalid mobile_phone [numero]",
    );
    expect(erroSemDadosPessoais("falhou para +55 (15) 99999-8888 agora")).toBe(
      "falhou para [numero] agora",
    );
  });

  it("preserva mensagens sem número e códigos curtos", () => {
    expect(erroSemDadosPessoais("Unauthorized 401")).toBe("Unauthorized 401");
  });

  it("limita o tamanho a 200 caracteres", () => {
    expect(erroSemDadosPessoais("x".repeat(500))).toHaveLength(200);
  });
});
