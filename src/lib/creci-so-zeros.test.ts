// CRECI sem valor real (vazio ou só zeros) = SEM CRECI (t_77132312). Só mock, dados fictícios.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRECI_SO_ZEROS_AVISO, creciReal, creciSoZeros } from "./exclusive-captures-ocr";
import {
  blocoCorretorContrato,
  bloqueioContratoSemCreci,
  parseTestemunhas,
  testemunhasParaPdf,
} from "./exclusive-clicksign";
import {
  emptyForm,
  fillExclusiveTemplate,
  type Capture,
  type ExclusiveUnit,
} from "./exclusive-captures";
import { camposFaltando } from "./completar-perfil";
import { brokerFieldsOk } from "@/components/exclusividades/useCaptureAutosave";

const ZEROS = ["0", "0000000000", "000-0", "00000-F", " 0.0/0 "];

const telaSemCreci = {
  modo: "sem_creci",
  aplica: true,
  corretor: { id: "c1", nome: "Silvia Zerada", cpf: "11144477735", ok: true, falta: [] },
  gestor: { id: null, nome: "Paula Exemplo", cpf: "39053344705", ok: true, falta: [], origem: "manual" },
  contrato: {
    id: "g1",
    nome: "Gina Gestora",
    cpf: "52998224725",
    creci: "12345-F",
    ok: true,
    falta: [],
    origem: "equipe",
  },
  problemas: [],
  ok: true,
  pdf_ok: true,
  pode_gerir: true,
  dados: "abc",
};

describe("creciReal: regra única (espelho de public.creci_real)", () => {
  it.each(["", "   ", ...ZEROS])("%j = sem CRECI", (v) => {
    expect(creciReal(v)).toBeNull();
  });
  it("null/undefined = sem CRECI", () => {
    expect(creciReal(null)).toBeNull();
    expect(creciReal(undefined)).toBeNull();
  });
  it.each([
    [" 12345-F ", "12345-F"],
    ["100", "100"],
    ["000010", "000010"],
    ["F-1", "F-1"],
  ])("%j = CRECI real %j", (v, out) => {
    expect(creciReal(v)).toBe(out);
  });
  it("só zeros preenchido ≠ vazio (para o aviso)", () => {
    expect(creciSoZeros("0000000000")).toBe(true);
    expect(creciSoZeros("")).toBe(false);
    expect(creciSoZeros("12345-F")).toBe(false);
    expect(CRECI_SO_ZEROS_AVISO).toBe("CRECI inválido: deixe em branco se não tiver");
  });
});

describe("captação: CRECI só zeros entra no modo sem CRECI", () => {
  it.each(["0000000000", "0", "000-0"])(
    "captador %j: bloco corretor = gestor/TL; testemunhas = captador + digitada",
    (creci) => {
      const t = parseTestemunhas(telaSemCreci)!;
      expect(bloqueioContratoSemCreci(t, creci)).toBeNull();
      expect(blocoCorretorContrato(t, { nome: "Silvia Zerada", cpf: "11144477735", creci })).toEqual(
        { broker_name: "Gina Gestora", broker_cpf: "52998224725", broker_creci: "12345-F" },
      );
      const pdf = testemunhasParaPdf({ testemunha_1: {}, testemunha_2: {} }, t);
      expect(pdf.testemunha_1).toEqual({ nome: "Silvia Zerada", rg: "", cpf: "11144477735" });
      expect(pdf.testemunha_2).toEqual({ nome: "Paula Exemplo", rg: "", cpf: "39053344705" });
    },
  );

  it("captador com zeros e o banco ainda no modo padrão (migration não aplicada): fail-closed", () => {
    const t = parseTestemunhas({ ...telaSemCreci, modo: "padrao", contrato: undefined })!;
    expect(bloqueioContratoSemCreci(t, "0000000000")).toMatch(/CRECI do captador mudou/);
    expect(() =>
      blocoCorretorContrato(t, { nome: "Silvia Zerada", cpf: "11144477735", creci: "0000000000" }),
    ).toThrow();
  });

  it("captador com zeros sem testemunha 2 digitada: não gera PDF", () => {
    const t = parseTestemunhas({
      ...telaSemCreci,
      gestor: null,
      ok: false,
      problemas: ["Testemunha 2: o captador não tem CRECI, então a testemunha 2 é digitada."],
    })!;
    expect(bloqueioContratoSemCreci(t, "0000000000")).toMatch(/testemunha 2 é digitada/);
  });

  it("captador com CRECI real: bloco = o próprio captador (igual a hoje)", () => {
    expect(
      blocoCorretorContrato(null, { nome: "Caio Comcreci", cpf: "98765432100", creci: "55555-F" }),
    ).toEqual({ broker_name: "Caio Comcreci", broker_cpf: "98765432100", broker_creci: "55555-F" });
    expect(bloqueioContratoSemCreci(null, "55555-F")).toBeNull();
  });

  it("autosave: zeros não derrubam o save (grava vazio); CRECI real inválido continua barrado", () => {
    expect(brokerFieldsOk("", "0000000000")).toBe(true);
    expect(brokerFieldsOk("", "0")).toBe(true);
    expect(brokerFieldsOk("", "12")).toBe(false);
    expect(brokerFieldsOk("", "12345-F")).toBe(true);
  });
});

describe("cadastro/perfil: só zeros avisa e não bloqueia", () => {
  const base = {
    nome: "Silvia Zerada",
    telefone: "(15) 99999-0000",
    avatar_url: "x",
    cpf: "111.444.777-35",
  };
  it("1º acesso com CRECI 0000000000: não falta nada (grava null)", () => {
    expect(camposFaltando({ ...base, creci: "0000000000" })).toEqual([]);
    expect(creciReal("0000000000")).toBeNull();
  });
  it("CRECI vazio continua opcional; CRECI real com formato inválido continua avisando", () => {
    expect(camposFaltando({ ...base, creci: null })).toEqual([]);
    expect(camposFaltando({ ...base, creci: "12" })).toEqual(["creci"]);
    expect(camposFaltando({ ...base, creci: "12345-F" })).toEqual([]);
  });
});

// Modelo fora do git (.gitignore): o teste roda só onde o arquivo existe, igual ao da 130000.
const base = "assets/exclusividade/remax-padrao.pdf";
const unit: ExclusiveUnit = {
  id: "u1",
  nome: "Unidade Exemplo",
  creci: "J-0001",
  razao_social: "Exemplo Ltda",
  endereco: "Rua Exemplo, 1",
  cidade: "Sorocaba",
  estado: "SP",
  cnpj: "00.000.000/0001-91",
  nome_comercial: "Exemplo",
  legacy_template: null,
  contrato_antigo: false,
  ativo: true,
};

describe("PDF do contrato com captador 0000000000", () => {
  it.skipIf(!existsSync(base))("bloco corretor = gestor/TL; testemunhas = captador e digitada", async () => {
    const t = parseTestemunhas(telaSemCreci)!;
    const captura = {
      id: "c1",
      template: "remax-padrao",
      unit_id: "u1",
      form_data: emptyForm(),
      broker_name: "Silvia Zerada",
      broker_cpf: "11144477735",
      broker_creci: "0000000000",
      created_on_sp: "2026-11-04",
    } as unknown as Capture;
    const bloco = blocoCorretorContrato(t, {
      nome: "Silvia Zerada",
      cpf: "11144477735",
      creci: "0000000000",
    });
    const montar = (flatten: boolean) =>
      fillExclusiveTemplate(
        new Uint8Array(readFileSync(base)),
        { ...captura, form_data: testemunhasParaPdf(captura.form_data, t), ...bloco },
        flatten,
        "2026-11-04",
        unit,
      );
    const { PDFDocument } = await import("pdf-lib");
    const form = (await PDFDocument.load(await montar(false))).getForm();
    expect(form.getTextField("NaGme").getText()).toBe("Gina Gestora");
    expect(form.getTextField("kgmf").getText()).toBe("12345-F");
    expect(form.getTextField("NameGF").getText()).toBe("52998224725");
    expect(form.getTextField("NamGFe").getText()).toBe("Silvia Zerada");
    expect(form.getTextField("NamDe").getText()).toBe("Paula Exemplo");
    if (process.env.CRECI_ZEROS_PDF_OUT)
      writeFileSync(process.env.CRECI_ZEROS_PDF_OUT, await montar(true));
  });
});
