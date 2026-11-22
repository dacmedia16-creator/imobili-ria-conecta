import { describe, expect, it, vi } from "vitest";
import {
  linhaDeErro,
  mascarar,
  registrarErroServidor,
  resumirErro,
  rotaSegura,
} from "./log-seguro";

describe("mascarar", () => {
  it("troca e-mail, CPF, CNPJ e telefone", () => {
    const s = mascarar(
      "cliente joao.silva+x@gmail.com cpf 123.456.789-09 e 12345678909 cnpj 12.345.678/0001-95 " +
        "fone (15) 99876-5432, +55 15 3234-5678 e 15998765432",
    );
    expect(s).not.toMatch(/joao|@gmail|123\.456|12345678909|0001-95|99876|3234|15998765432/);
    expect(s).toContain("[email]");
    expect(s).toContain("[cpf]");
    expect(s).toContain("[cnpj]");
    expect(s).toContain("[telefone]");
  });

  it("troca tokens e chaves", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc_DEF-123";
    const s = mascarar(
      `Authorization: Bearer abc.def.ghi ${jwt} sb_secret_AAAABBBBCCCC ?token=XYZ123&x=1 senha: hunter2`,
    );
    expect(s).not.toContain(jwt);
    expect(s).not.toMatch(/sb_secret_AAAA|XYZ123|hunter2|abc\.def\.ghi/);
    expect(s).toContain("[token]");
    expect(s).toContain("[chave]");
  });

  it("não estraga texto comum, datas e valores", () => {
    expect(mascarar("Falha ao salvar venda 2026-11-22 valor R$ 450.000,00")).toBe(
      "Falha ao salvar venda 2026-11-22 valor R$ 450.000,00",
    );
  });

  it("aceita qualquer valor sem lançar", () => {
    expect(mascarar(undefined)).toBe("");
    expect(mascarar(42)).toBe("42");
  });
});

describe("rotaSegura", () => {
  it("tira query, hash e troca ids por :id", () => {
    expect(rotaSegura("/vendas/3f2b1c4d-1111-2222-3333-444455556666?aba=1#x")).toBe("/vendas/:id");
    expect(rotaSegura("/convite/AbCdEfGhIjKlMnOpQrStUvWx")).toBe("/convite/:id");
    expect(rotaSegura("/leads/123456")).toBe("/leads/:id");
  });
  it("mascara e-mail no caminho", () => {
    expect(rotaSegura("/busca/ana%40x.com")).toBe("/busca/[email]");
  });
  it("vazio vira /", () => {
    expect(rotaSegura(undefined)).toBe("/");
  });
});

describe("resumirErro", () => {
  it("mascara mensagem e pilha e corta tamanho", () => {
    const e = new Error("duplicate key ana@x.com " + "x".repeat(1000));
    e.stack = "Error: ana@x.com\n at f (https://app/x.js?token=abc:1:2)\n" + "  at g\n".repeat(50);
    const r = resumirErro(e);
    expect(r.mensagem).not.toContain("ana@x.com");
    expect(r.mensagem.length).toBeLessThanOrEqual(300);
    expect(r.pilha).not.toContain("token=abc");
    expect(r.pilha!.split("\n").length).toBeLessThanOrEqual(8);
  });
  it("aceita objeto do Supabase (message + code) e valores soltos", () => {
    // 11 dígitos soltos podem ser CPF ou celular: o importante é sumir (vira [cpf]).
    expect(resumirErro({ message: "fone 15999998888", code: "23505" }).mensagem).toBe("fone [cpf]");
    expect(resumirErro({ message: "fone (15) 99999-8888", code: "23505" })).toMatchObject({
      mensagem: "fone [telefone]",
      codigo: "23505",
    });
    expect(resumirErro("texto solto")).toEqual({ nome: "NaoErro", mensagem: "texto solto" });
  });
});

describe("registro no servidor", () => {
  it("escreve uma linha JSON mascarada", () => {
    const linha = JSON.parse(
      linhaDeErro("ssr", new Error("cpf 123.456.789-09"), { rota: "/a?b=c@d.com" }),
    );
    expect(linha).toMatchObject({ tipo: "erro", origem: "ssr", mensagem: "cpf [cpf]" });
    expect(linha.rota).not.toContain("c@d.com");
  });
  it("registrarErroServidor usa console.error e nunca lança", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    registrarErroServidor("worker", new Error("x@y.com"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("[email]");
    spy.mockRestore();
  });
});
