import { describe, expect, it } from "vitest";
import {
  errorCode,
  errorMessage,
  errorRawMessage,
  mensagemErro,
  MSG_ERRO_GENERICA,
} from "./errors";

// Tradutor único de erros (t_8ab6c348): código do Postgres/PostgREST -> frase em português com o que fazer.
const pg = (code: string, message: string, extra: Record<string, unknown> = {}) => ({
  code,
  message,
  details: "detalhe interno (row 123)",
  hint: "dica interna",
  ...extra,
});

describe("mensagemErro", () => {
  it.each([
    [
      "23505",
      'duplicate key value violates unique constraint "x_key"',
      /Já existe um registro igual/,
    ],
    [
      "23503",
      'insert or update on table "a" violates foreign key constraint "a_b_fkey"',
      /ligado a outro/,
    ],
    [
      "23502",
      'null value in column "nome" of relation "profiles" violates not-null constraint',
      /campo obrigatório/,
    ],
    [
      "23514",
      'new row for relation "sales" violates check constraint "c"',
      /não passou na conferência/,
    ],
    ["42501", 'new row violates row-level security policy for table "sales"', /não tem permissão/],
    ["42501", "permission denied for function foo", /não tem permissão/],
    ["22P02", 'invalid input syntax for type uuid: "abc"', /formato inválido/],
    ["22001", "value too long for type character varying(10)", /tamanho permitido/],
    ["57014", "canceling statement due to statement timeout", /demorou para responder/],
    ["40P01", "deadlock detected", /ao mesmo tempo/],
    ["PGRST301", "JWT expired", /sessão expirou/],
    ["PGRST303", "JWT claims validation or parsing failed", /sessão expirou/],
    ["PGRST116", "Cannot coerce the result to a single JSON object", /não encontrado/],
    ["PGRST202", "Could not find the function public.x in the schema cache", /Recarregue a página/],
    ["42883", "function public.x(uuid) does not exist", /Recarregue a página/],
  ])("código %s vira frase em português sem detalhe interno", (code, message, esperado) => {
    const msg = mensagemErro(pg(code, message));
    expect(msg).toMatch(esperado);
    expect(msg).not.toMatch(
      /violates|constraint|relation|JWT|schema cache|row 123|dica interna|select|uuid/i,
    );
  });

  it("mensagem RAISE em português do banco passa como está (mesmo com código de CHECK ou permissão)", () => {
    const raise =
      "Participação extra precisa ter uma pessoa (cadastrada ou com nome). Remova a linha vazia antes de salvar.";
    expect(mensagemErro(pg("23514", raise))).toBe(raise);
    expect(mensagemErro(pg("P0001", "Venda não encontrada."))).toBe("Venda não encontrada.");
    expect(mensagemErro(pg("42501", "Somente admin ou super_admin pode ativar."))).not.toContain(
      "super_admin",
    );
  });

  it.each([
    [{ code: "42501", message: "Login necessario" }, "Login necessario"],
    [
      { code: "22023", message: "Morador repetido (mesmo nome ou CPF)." },
      "Morador repetido (mesmo nome ou CPF).",
    ],
    [
      { code: "22023", message: "Horario fora da agenda liberada do fotografo" },
      "Horario fora da agenda liberada do fotografo",
    ],
    [
      { code: "23P01", message: "Horario indisponivel (sessao de 2 h + 1 h de intervalo)" },
      "Horario indisponivel (sessao de 2 h + 1 h de intervalo)",
    ],
    [
      { code: "42501", message: "Lead encerrado: so gestor ou administrador reabre" },
      "Lead encerrado: so gestor ou administrador reabre",
    ],
    [{ code: "22023", message: "Limite de 10 aparelhos" }, "Limite de 10 aparelhos"],
    [
      { code: "P0001", message: "Chamado resolvido. Abra um novo chamado." },
      "Chamado resolvido. Abra um novo chamado.",
    ],
    [new Error("Arquivo maior que 16 MB."), "Arquivo maior que 16 MB."],
    [new Error("Logo acima de 1 MB."), "Logo acima de 1 MB."],
    [new Error("Envie PDF ou imagem (JPG, PNG, WEBP)."), "Envie PDF ou imagem (JPG, PNG, WEBP)."],
  ])("português sem acento do banco/app passa como está (revisão): %#", (erro, esperado) => {
    expect(mensagemErro(erro, "Reserva da tela")).toBe(esperado);
  });

  it("português com nome técnico (tabela.coluna, snake_case) não passa: vira a frase do código", () => {
    expect(mensagemErro(pg("23503", "Registro pai sem organizacao (sales.sale_id)"))).toMatch(
      /ligado a outro/,
    );
    expect(mensagemErro(pg("42501", "organization_id nao pode ser alterado"))).toMatch(
      /não tem permissão/,
    );
  });

  it("erros do próprio app em português (new Error) continuam passando", () => {
    expect(mensagemErro(new Error("Escolha a pessoa antes de salvar."))).toBe(
      "Escolha a pessoa antes de salvar.",
    );
  });

  it("falha de rede vira orientação", () => {
    expect(mensagemErro(new TypeError("Failed to fetch"))).toMatch(/conexão/);
    expect(mensagemErro(new Error("NetworkError when attempting to fetch resource."))).toMatch(
      /conexão/,
    );
    expect(mensagemErro(new TypeError("Load failed"))).toMatch(/conexão/);
  });

  it("erros de login e de arquivo comuns", () => {
    expect(mensagemErro({ message: "Invalid login credentials", status: 400 })).toMatch(
      /E-mail ou senha/,
    );
    expect(
      mensagemErro({ message: "New password should be different from the old password." }),
    ).toMatch(/diferente/);
    expect(mensagemErro({ message: "Password should be at least 6 characters." })).toMatch(
      /senha/i,
    );
    expect(mensagemErro({ message: "The resource already exists", statusCode: "409" })).toMatch(
      /Já existe um arquivo/,
    );
    expect(mensagemErro({ message: "The object exceeded the maximum allowed size" })).toMatch(
      /grande demais/,
    );
  });

  it("inglês/técnico sem código conhecido: usa o texto da tela ou a frase genérica", () => {
    expect(mensagemErro(new Error("Unexpected token < in JSON at position 0"))).toBe(
      MSG_ERRO_GENERICA,
    );
    expect(
      mensagemErro({ code: "XX000", message: "internal error" }, "Falha ao salvar a sala."),
    ).toBe("Falha ao salvar a sala.");
    expect(MSG_ERRO_GENERICA).toMatch(/se continuar, fale com o suporte/);
  });

  it("nada ou valores estranhos não quebram", () => {
    for (const v of [null, undefined, "", 42, {}, { message: "" }, "something went wrong"]) {
      expect(mensagemErro(v)).toBe(MSG_ERRO_GENERICA);
    }
    expect(mensagemErro("Não foi possível abrir.")).toBe("Não foi possível abrir.");
  });
});

describe("errorMessage (helper antigo) agora traduz", () => {
  it("usa o tradutor e mantém o texto de contexto como reserva", () => {
    expect(errorMessage(pg("23505", "duplicate key value"), "Falha")).toMatch(
      /Já existe um registro igual/,
    );
    expect(errorMessage(new Error("Unexpected end of JSON input"), "Falha ao salvar.")).toBe(
      "Falha ao salvar.",
    );
    expect(errorMessage(new Error("Preencha o nome."), "Falha")).toBe("Preencha o nome.");
  });
  it("errorRawMessage devolve a mensagem crua só para decisões no código (nunca para a tela)", () => {
    expect(errorRawMessage(pg("23505", "sales_imovel_id_ativa_key"))).toBe(
      "sales_imovel_id_ativa_key",
    );
    expect(errorRawMessage(null)).toBe("");
    expect(errorCode(pg("23505", "x"))).toBe("23505");
  });
});
