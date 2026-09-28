import { describe, expect, it } from "vitest";
import {
  firstAdminSchema,
  formatCnpj,
  friendlyOrgError,
  isValidCnpj,
  organizationFormSchema,
  slugify,
  summarizeSteps,
} from "./platform-organizations";
import { decideOrgAction } from "./user-management-policy";

describe("cadastro de imobiliárias — regras puras", () => {
  it("slugify gera identificador aceito pelo banco", () => {
    expect(slugify("Imobiliária São João Ltda.")).toBe("imobiliaria-sao-joao-ltda");
    expect(slugify("  RE/MAX Única Escolha  ")).toBe("re-max-unica-escolha");
    expect(slugify("x".repeat(80))).toHaveLength(63);
  });

  it("CNPJ: dígitos verificadores, pontuação e repetidos", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("formulário: nome, identificador, CNPJ e cores opcionais", () => {
    const ok = organizationFormSchema.safeParse({
      nome: "Agência C",
      slug: "agencia-c",
      cnpj: "11.222.333/0001-81",
      corPrimaria: "#1A2B3C",
      corSecundaria: "",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.corPrimaria).toBe("#1a2b3c");
    expect(organizationFormSchema.safeParse({ nome: "C", slug: "agencia-c" }).success).toBe(false);
    expect(organizationFormSchema.safeParse({ nome: "Agência C", slug: "Agência C" }).success).toBe(false);
    expect(
      organizationFormSchema.safeParse({ nome: "Agência C", slug: "agencia-c", cnpj: "11222333000182" })
        .success,
    ).toBe(false);
    expect(
      organizationFormSchema.safeParse({ nome: "Agência C", slug: "agencia-c", corPrimaria: "azul" })
        .success,
    ).toBe(false);
  });

  it("primeiro administrador: nome completo e e-mail", () => {
    const id = "2b000000-0000-4000-8000-0000000000c0";
    expect(firstAdminSchema.safeParse({ organizationId: id, nome: "Ana Souza", email: "A@x.test" }).success).toBe(true);
    expect(firstAdminSchema.safeParse({ organizationId: id, nome: "Ana", email: "a@x.test" }).success).toBe(false);
    expect(firstAdminSchema.safeParse({ organizationId: id, nome: "Ana Souza", email: "x" }).success).toBe(false);
  });

  it("status das etapas: identifica a primeira falha", () => {
    expect(summarizeSteps([{ key: "organizacao", status: "ok", message: "" }]).ok).toBe(true);
    const r = summarizeSteps([
      { key: "organizacao", status: "ok", message: "" },
      { key: "dados", status: "erro", message: "CNPJ" },
      { key: "logo", status: "pulado", message: "" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.failed?.key).toBe("dados");
  });

  it("mensagens do banco viram texto claro", () => {
    expect(friendlyOrgError('duplicate key value violates unique constraint "organizations_slug_key"')).toMatch(
      /identificador/,
    );
    expect(friendlyOrgError("organizations_cnpj_unique")).toMatch(/CNPJ/);
    // Mesmo código 42501, motivo diferente: a mensagem específica prevalece.
    expect(friendlyOrgError("A agencia legada nao pode ser suspensa por aqui (42501)")).toMatch(/original/);
    expect(friendlyOrgError("Apenas o super-admin da plataforma cria imobiliarias. (42501)")).toMatch(
      /super-admin da plataforma/,
    );
  });

  it("só o super-admin da plataforma decide sobre imobiliárias (não o super_admin da agência)", () => {
    const agencia = { userId: "u", orgId: "o", roles: ["super_admin" as const] };
    expect(decideOrgAction(agencia, "create_org").allowed).toBe(false);
    expect(decideOrgAction({ ...agencia, isPlatformAdmin: true }, "create_org").allowed).toBe(true);
  });
});
