// t_77132312 — captador que também é proprietário (testemunhas digitadas) e vigência só com a
// captação aprovada. Só mock, dados fictícios.
import { describe, expect, it } from "vitest";
import {
  bloqueioTestemunhasProprietario,
  cpfsProprietarios,
  parseTestemunhas,
  testemunhaManualErros,
  testemunhasParaPdf,
  usarTestemunhasAuto,
} from "./exclusive-clicksign";
import { captureValidity, emptyForm } from "./exclusive-captures";
import { expiringItems } from "./exclusive-expiry-alerts.server";
import { situation } from "./exclusive-captures-dashboard";

const propCompleto = {
  modo: "padrao",
  aplica: true,
  captador_proprietario: true,
  corretor: {
    id: null,
    nome: "Tiago Lider",
    cpf: "39053344705",
    ok: true,
    falta: [],
    origem: "manual",
  },
  gestor: {
    id: null,
    nome: "Gina Gestora",
    cpf: "52998224725",
    ok: true,
    falta: [],
    origem: "manual",
  },
  manual: { nome: "Gina Gestora", cpf: "52998224725", email: "g@exemplo.test" },
  manual_1: { nome: "Tiago Lider", cpf: "39053344705", email: "t@exemplo.test" },
  problemas: [],
  ok: true,
  pdf_ok: false,
  pode_gerir: true,
  dados: "x",
};
const propSemTestemunhas = {
  ...propCompleto,
  corretor: { id: null, nome: "", cpf: "", ok: false, falta: ["não informada"], origem: "manual" },
  gestor: null,
  manual: undefined,
  manual_1: undefined,
  problemas: [
    "Testemunha 1: o captador também é proprietário deste imóvel e não pode ser testemunha. Digite a testemunha 1 (nome, CPF e e-mail)",
    "Testemunha 2: o captador também é proprietário deste imóvel e não pode ser testemunha. Digite a testemunha 2 (nome, CPF e e-mail)",
  ],
  ok: false,
};

describe("captador que também é proprietário", () => {
  it("lê captadorProprietario e as duas digitadas", () => {
    const t = parseTestemunhas(propCompleto)!;
    expect(t.captadorProprietario).toBe(true);
    expect(t.manual1?.email).toBe("t@exemplo.test");
    expect(t.manual?.email).toBe("g@exemplo.test");
  });
  it("sem as duas digitadas: não gera o PDF (com e sem CRECI) e nunca usa o captador", () => {
    for (const modo of ["padrao", "sem_creci"]) {
      const t = parseTestemunhas({ ...propSemTestemunhas, modo })!;
      expect(bloqueioTestemunhasProprietario(t)).toMatch(/também é proprietário/);
      expect(usarTestemunhasAuto(t)).toBe(false);
      const form = emptyForm();
      // PDF não troca para o captador: fica como o formulário (e a geração é bloqueada antes).
      expect(testemunhasParaPdf(form, t)).toBe(form);
    }
  });
  it("com as duas digitadas: PDF sai com elas", () => {
    const t = parseTestemunhas(propCompleto)!;
    expect(bloqueioTestemunhasProprietario(t)).toBeNull();
    const out = testemunhasParaPdf(emptyForm(), t);
    expect(out.testemunha_1).toEqual({ nome: "Tiago Lider", rg: "", cpf: "39053344705" });
    expect(out.testemunha_2).toEqual({ nome: "Gina Gestora", rg: "", cpf: "52998224725" });
  });
  it("testemunha digitada com CPF de proprietário: recusada na tela", () => {
    const form = emptyForm();
    form.proprietario_2 = { ...form.proprietario_1, cpf: "111.444.777-35" };
    const donos = cpfsProprietarios(form as unknown as Record<string, unknown>);
    expect(donos).toContain("11144477735");
    const t = parseTestemunhas(propSemTestemunhas)!;
    const e = testemunhaManualErros(
      { nome: "Silvia Dona", cpf: "111.444.777-35", email: "s@exemplo.test" },
      t,
      { qual: 1, donos },
    );
    expect(e.join(" ")).toMatch(/proprietário do imóvel/);
  });
  it("captador que NÃO é proprietário: nada muda", () => {
    const t = parseTestemunhas({ ...propCompleto, captador_proprietario: false })!;
    expect(t.captadorProprietario).toBe(false);
    expect(t.manual1).toBeNull();
    expect(bloqueioTestemunhasProprietario(t)).toBeNull();
  });
});

describe("vigência só com a captação aprovada", () => {
  const form = emptyForm();
  form.condicoes.prazo_dias_numero = "180";
  const base = { signed_on: "2026-10-30", form_data: form };
  it("em assinatura/enviada/rascunho com signed_on: sem vigência", () => {
    for (const status of ["em_assinatura", "enviada", "rascunho", "devolvida"]) {
      expect(captureValidity({ ...base, status } as never, "2026-11-04")).toBeNull();
    }
  });
  it("aprovada: igual a hoje", () => {
    const v = captureValidity({ ...base, status: "aprovada" } as never, "2026-11-04")!;
    expect(v.end).toBe("2027-04-28");
    expect(v.daysLeft).toBe(175);
  });
  it("sem alerta de vencimento e sem 'vencendo' no painel para a em assinatura", () => {
    const c = {
      ...base,
      status: "em_assinatura",
      archived_at: null,
      signed_on: "2026-05-10",
    } as never;
    expect(expiringItems([c], "2026-11-04")).toEqual([]);
    expect(situation(c, "2026-11-04").v).toBeNull();
  });
});
