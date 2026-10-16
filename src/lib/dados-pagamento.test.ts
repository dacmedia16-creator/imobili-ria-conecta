import { describe, expect, it } from "vitest";
import {
  DADOS_VAZIOS,
  dadosCompletos,
  normalizarPessoas,
  papeisDaEquipe,
  payloadDados,
  resumoConta,
  statusPessoa,
  textoPreenchido,
  validarDados,
} from "./dados-pagamento";

const conta = {
  ...DADOS_VAZIOS,
  titular: "Ana",
  banco: "Banco X",
  agencia: "1234",
  conta: "98765-4",
  tipo_conta: "corrente" as const,
};

describe("dados para pagamento da equipe", () => {
  it("completo exige titular e PIX ou banco+agência+conta", () => {
    expect(dadosCompletos(conta)).toBe(true);
    expect(dadosCompletos({ ...DADOS_VAZIOS, titular: "Ana", pix_chave: "a@b.co" })).toBe(true);
    expect(dadosCompletos({ ...conta, conta: "" })).toBe(false);
    expect(dadosCompletos({ ...conta, titular: " " })).toBe(false);
  });

  it("valida o formulário", () => {
    expect(validarDados(conta)).toBeNull();
    expect(validarDados({ ...conta, titular: "" })).toMatch(/titular/);
    expect(validarDados({ ...DADOS_VAZIOS, titular: "Ana", pix_chave: "x" })).toMatch(
      /tipo da chave/,
    );
    expect(validarDados({ ...conta, documento: "123" })).toMatch(/CPF/);
    expect(validarDados({ ...conta, documento: "123.456.789-01" })).toBeNull();
    expect(
      validarDados({ ...DADOS_VAZIOS, titular: "Ana", pix_tipo: "email", pix_chave: "sem-arroba" }),
    ).toMatch(/e-mail/);
  });

  it("status do selo segue a maquete", () => {
    expect(statusPessoa({ origem: "venda", modo: "imobiliaria", completo: false })).toBe(
      "imobiliaria",
    );
    expect(statusPessoa({ origem: "cadastro", modo: "conta_propria", completo: true })).toBe("ok");
    expect(statusPessoa({ origem: "venda", modo: "conta_propria", completo: false })).toBe(
      "pendente",
    );
    expect(statusPessoa({ origem: "nenhum", modo: "conta_propria", completo: false })).toBe(
      "pendente",
    );
  });

  it("normaliza linhas da RPC e ignora lixo", () => {
    const r = normalizarPessoas([
      {
        user_id: "u1",
        nome: "Ana",
        origem: "venda",
        modo: "imobiliaria",
        completo: false,
        pix_tipo: "xx",
      },
      null,
      { nome: "sem id" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      user_id: "u1",
      modo: "imobiliaria",
      pix_tipo: "",
      dados_completos: false,
      preenchido_por: null,
      preenchido_em: null,
    });
    expect(normalizarPessoas(null)).toEqual([]);
  });

  it("mostra quem preencheu e quando (t_19cd1fc1)", () => {
    const [p] = normalizarPessoas([
      {
        user_id: "u1",
        nome: "Ailton",
        preenchido_por: "adm",
        preenchido_por_nome: "Denis",
        preenchido_em: "2026-10-16T18:00:00+00:00",
      },
    ]);
    expect(textoPreenchido(p, "outro")).toBe("Preenchido por Denis em 16/10");
    expect(textoPreenchido(p, "adm")).toBe("Preenchido por você em 16/10");
    expect(
      textoPreenchido(
        { preenchido_por: null, preenchido_por_nome: null, preenchido_em: null },
        "x",
      ),
    ).toBeNull();
  });

  it("papéis da equipe juntam fixos e extras sem repetir", () => {
    const m = papeisDaEquipe(
      { corretor_captador_id: "a", lider_captador_id: "b", corretor_vendedor_id: "a" },
      [
        { user_id: "c", papel: "outro", lado: null },
        { user_id: "b", papel: "gestor", lado: "vendedor" },
        { user_id: null, papel: "outro" },
      ],
    );
    expect(m.get("a")).toEqual(["Corretor captador", "Corretor vendedor"]);
    expect(m.get("b")).toEqual(["Gestor/TL do captador", "Gestor (vendedor)"]);
    expect(m.get("c")).toEqual(["Outro"]);
    expect(m.size).toBe(3);
  });

  it("resumo e payload", () => {
    expect(resumoConta({ ...conta, pix_tipo: "cpf", pix_chave: "***8901" })).toBe(
      "PIX CPF ***8901 | Banco X · ag 1234 · cc 98765-4",
    );
    expect(payloadDados({ ...conta, documento: "  " })).toEqual({
      titular: "Ana",
      banco: "Banco X",
      agencia: "1234",
      conta: "98765-4",
      tipo_conta: "corrente",
    });
  });
});
