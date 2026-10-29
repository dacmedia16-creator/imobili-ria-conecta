import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  TODOS,
  cadastroDaSituacao,
  descreverFiltros,
  filtrarColaboradores,
  filtrosVazios,
  linhaExport,
  COLUNAS_EXPORT,
  mensagemErroCadastro,
  modoFicha,
  pendenciasCadastro,
  remaxIdValido,
  tudoCompleto,
  type Colaborador,
  type SituacaoFicha,
} from "./ficha-colaborador";

// Cadastro completo no aviso/trava da ficha (t_b98f3e4b).
type SituacaoAplica = Extract<SituacaoFicha, { aplica: true }>;
const sit = (o: Partial<SituacaoAplica>): SituacaoAplica => ({
  aplica: true,
  completa: true,
  cadastro_completo: true,
  cadastro_pendente: [],
  cadastro_exige_registro: true,
  cadastro: { nome: "Carlos Um", telefone: "15991234567", cpf: null, remax_id: null },
  bloqueia: false,
  obrigatoria_a_partir_de: "2026-10-30T04:30:00+00:00",
  data_nascimento: "1990-05-17",
  ficha: null,
  ...o,
});

describe("aviso/trava cobra o cadastro, não só a ficha", () => {
  it("corretor sem ID RE/MAX (ficha completa) é cobrado: lembrete antes do prazo", () => {
    const s = sit({ cadastro_completo: false, cadastro_pendente: ["remax_id"] });
    expect(tudoCompleto(s)).toBe(false);
    expect(pendenciasCadastro(s)).toEqual(["remax_id"]);
    expect(modoFicha(s, false)).toBe("lembrete");
  });
  it("depois do prazo trava, mesmo tendo clicado 'Preencher depois'", () => {
    const s = sit({ cadastro_pendente: ["cpf", "remax_id"], bloqueia: true });
    expect(modoFicha(s, false)).toBe("bloqueio");
    expect(modoFicha(s, true)).toBe("bloqueio");
  });
  it("antes do prazo, adiado neste login: não aparece de novo", () => {
    expect(modoFicha(sit({ cadastro_pendente: ["telefone"] }), true)).toBeNull();
  });
  it("staff sem pendência de cadastro (banco não cobra CPF/ID dele) e ficha completa: não aparece", () => {
    const s = sit({ cadastro_exige_registro: false, cadastro_pendente: [] });
    expect(modoFicha(s, false)).toBeNull();
  });
  it("Entrar como / plataforma (aplica=false): nunca aparece", () => {
    expect(modoFicha({ aplica: false, motivo: "sessao_restrita" }, false)).toBeNull();
    expect(pendenciasCadastro({ aplica: false })).toEqual([]);
  });
  it("versão antiga do banco sem 'cadastro_pendente': não inventa pendência", () => {
    const antiga = sit({});
    delete (antiga as Partial<SituacaoAplica>).cadastro_pendente;
    expect(modoFicha(antiga, false)).toBeNull();
  });
  it("chave desconhecida vinda do banco é ignorada (não trava por isso)", () => {
    const s = sit({ cadastro_pendente: ["creci" as never] });
    expect(pendenciasCadastro(s)).toEqual([]);
    expect(modoFicha(s, false)).toBeNull();
  });
  it("formulário começa com o que já está no cadastro", () => {
    expect(cadastroDaSituacao(sit({})).nome).toBe("Carlos Um");
    expect(cadastroDaSituacao(null)).toEqual({ nome: "", telefone: "", cpf: "", remax_id: "" });
  });
});

describe("ID RE/MAX: 9 dígitos começando com 630", () => {
  it("aceita o padrão e recusa o resto", () => {
    expect(remaxIdValido("630601272")).toBe(true);
    expect(remaxIdValido("630-601-272")).toBe(true);
    expect(remaxIdValido("63060127")).toBe(false); // 8 dígitos
    expect(remaxIdValido("123456789")).toBe(false); // sem 630
    expect(remaxIdValido("6306012720")).toBe(false); // 10 dígitos
    expect(remaxIdValido("")).toBe(false);
  });
  it("mensagens do banco viram texto claro", () => {
    expect(mensagemErroCadastro({ code: "23505", message: "ID RE/MAX ja esta em outro cadastro" })).toMatch(
      /outra pessoa/,
    );
    expect(mensagemErroCadastro({ code: "22023", message: "ID RE/MAX invalido" })).toMatch(/630/);
    expect(mensagemErroCadastro({ code: "22023", message: "CPF invalido" })).toMatch(/CPF/);
    expect(mensagemErroCadastro({ code: "42501", message: "x" })).toMatch(/permissão/);
  });
});

const colab = (o: Partial<Colaborador>): Colaborador => ({
  user_id: "u",
  nome: "Fulano",
  email: null,
  telefone: null,
  papeis: ["corretor"],
  equipes: [],
  data_nascimento: null,
  completa: true,
  cadastro_pendente: [],
  qtd_filhos: null,
  tem_plano_saude: null,
  plano_saude: null,
  emergencia_nome: null,
  emergencia_parentesco: null,
  emergencia_telefone: null,
  hospital_preferencia: null,
  religiao: null,
  preenchida_em: null,
  updated_at: null,
  ...o,
});

describe("tela do staff: filtro e coluna 'Cadastro pendente'", () => {
  const L = [
    colab({ user_id: "1", nome: "Ana", cadastro_pendente: ["remax_id"] }),
    colab({ user_id: "2", nome: "Bia", cadastro_pendente: ["cpf", "remax_id_invalido"] }),
    colab({ user_id: "3", nome: "Caio", papeis: ["staff"] }),
  ];
  const nomes = (cadastro: ReturnType<typeof filtrosVazios>["cadastro"]) =>
    filtrarColaboradores(L, { ...filtrosVazios(), cadastro }).map((c) => c.nome);
  it("filtra por qualquer pendência, por completo e por pendência específica", () => {
    expect(nomes(TODOS)).toEqual(["Ana", "Bia", "Caio"]);
    expect(nomes("pendente")).toEqual(["Ana", "Bia"]);
    expect(nomes("completo")).toEqual(["Caio"]);
    expect(nomes("remax_id")).toEqual(["Ana"]);
    expect(nomes("remax_id_invalido")).toEqual(["Bia"]);
  });
  it("exportação traz o que falta no fim (posições do PDF não mudam)", () => {
    const linha = linhaExport(L[1], {});
    expect(COLUNAS_EXPORT[COLUNAS_EXPORT.length - 1]).toBe("Cadastro pendente");
    expect(linha[linha.length - 1]).toBe("CPF, ID RE/MAX fora do padrão");
    expect(COLUNAS_EXPORT[5]).toBe("Ficha");
    expect(descreverFiltros({ ...filtrosVazios(), cadastro: "pendente" }, {})).toContain(
      "Cadastro pendente",
    );
  });
});

describe("migration do cadastro (contrato)", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20261029160000_cadastro_completo_ficha.sql",
      import.meta.url,
    ),
    "utf8",
  );
  it("só corretor/gestor/team leader são cobrados de CPF e ID; CRECI não é cobrado", () => {
    expect(sql).toContain("IN ('corretor', 'gestor', 'team_leader')");
    expect(sql).not.toMatch(/_r := _r \|\| 'creci'/);
  });
  it("ID RE/MAX: padrão 630 (gatilho só quando muda) e único entre todos", () => {
    expect(sql).toContain("'^630[0-9]{6}$'");
    expect(sql).toContain("NEW.remax_id IS DISTINCT FROM OLD.remax_id");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS profiles_remax_id_uniq\s+ON public\.profiles \(remax_id\)/);
  });
  it("erro ao calcular pendências = sem pendência (nunca trava por erro)", () => {
    expect(sql).toMatch(/EXCEPTION WHEN others THEN\s+_exige := false;\s+_pend := ARRAY\[\]::text\[\];/);
  });
  it("trava continua decidida pelo relógio do banco e 'Entrar como' continua fora", () => {
    expect(sql).toContain("'bloqueia', (NOT _completa OR cardinality(_pend) > 0) AND now() >= _desde");
    expect(sql).toContain("public.ficha_sessao_restrita()");
  });
  it("RPC de gravação valida CPF no banco e não grava CPF/ID de quem não é corretor", () => {
    expect(sql).toContain("public.exclusive_valid_cpf(_c)");
    expect(sql).toMatch(/IF NOT _exige THEN\s+_c := NULL;\s+_r := NULL;/);
  });
  it("rollback existe e restaura a versão anterior", () => {
    const rb = readFileSync(
      new URL(
        "../../docs/sql/rollback/20261029160000_cadastro_completo_ficha.rollback.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(rb).toContain("'bloqueia', NOT _completa AND now() >= _desde");
    expect(rb).toContain("DROP INDEX IF EXISTS public.profiles_remax_id_uniq");
  });
});

// Porteiro: falha ao consultar libera; "Entrar como" nem consulta.
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

describe("leitura da situação", () => {
  beforeEach(() => rpc.mockReset());
  it("erro do banco vira exceção (o porteiro trata como 'libera')", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { minhaSituacaoFicha } = await import("./ficha-colaborador-db");
    await expect(minhaSituacaoFicha()).rejects.toThrow();
    const gate = readFileSync(
      new URL("../components/ficha/FichaColaboradorGate.tsx", import.meta.url),
      "utf8",
    );
    expect(gate).toContain(".catch(() => vivo && setModo(null))");
    expect(gate).toContain("Boolean(impersonation)");
  });
  it("salvarMeuCadastro manda só o preenchido e traduz o erro", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "dup" } });
    const { salvarMeuCadastro } = await import("./ficha-colaborador-db");
    await expect(
      salvarMeuCadastro({ nome: "", telefone: "", cpf: "", remax_id: "630000001" }),
    ).rejects.toThrow(/outra pessoa/);
    expect(rpc).toHaveBeenCalledWith("cadastro_salvar_meu", {
      _nome: null,
      _telefone: null,
      _cpf: null,
      _remax_id: "630000001",
    });
  });
});
