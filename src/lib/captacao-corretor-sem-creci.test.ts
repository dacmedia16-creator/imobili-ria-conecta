// Captador SEM CRECI (t_e75b58c5): contrato com gestor/TL com CRECI no bloco corretor, captador como
// testemunha 1, testemunha 2 digitada; desde t_c0453ded o gestor/TL do contrato ASSINA como Corretor.
// Com CRECI: igual a antes. Só mock: sem rede, dados fictícios.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../supabase/functions/_shared/clicksign.ts";
import {
  handleSend,
  type SendDeps,
  testemunhasDoBanco,
} from "../../supabase/functions/clicksign-send/core.ts";
import {
  blocoCorretorContrato,
  bloqueioContratoSemCreci,
  corretorContratoAssina,
  fixarTestemunhasPdf,
  parseTestemunhas,
  sendDialogErrors,
  testemunhaManualErros,
  testemunhasParaPdf,
} from "./exclusive-clicksign";
import {
  emptyForm,
  fillExclusiveTemplate,
  missingRequirements,
  type Capture,
  type ExclusiveUnit,
} from "./exclusive-captures";

const CAP = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const IMOB = "33333333-3333-4333-8333-333333333333";
const DOC = "55555555-5555-4555-8555-555555555555";

/** Resposta da tela (exclusive_testemunhas) no modo sem CRECI, formato real do banco. */
const telaSemCreci = (over: Record<string, unknown> = {}) => ({
  modo: "sem_creci",
  aplica: true,
  corretor: { id: "c1", nome: "Carla Semcreci", cpf: "11144477735", ok: true, falta: [] },
  gestor: {
    id: null,
    nome: "Paula Exemplo",
    cpf: "98765432100",
    ok: true,
    falta: [],
    origem: "manual",
  },
  contrato: {
    id: "g1",
    nome: "Gina Gestora",
    cpf: "52998224725",
    creci: "12345-F",
    ok: true,
    falta: [],
    origem: "equipe",
  },
  contrato_escolhido: false,
  manual: { nome: "Paula Exemplo", cpf: "98765432100", email: "paula@example.com" },
  gestor_equipe: { id: "g1", nome: "Gina Gestora" },
  motivo: null,
  escolhido: false,
  problemas: [],
  ok: true,
  pdf_gerado: true,
  pdf_ok: true,
  pode_gerir: true,
  dados: "abc",
  ...over,
});

const telaComCreci = {
  modo: "padrao",
  aplica: true,
  corretor: { id: "c2", nome: "Caio Comcreci", cpf: "12345678909", ok: true, falta: [] },
  gestor: {
    id: "g1",
    nome: "Gina Gestora",
    cpf: "52998224725",
    ok: true,
    falta: [],
    origem: "equipe",
  },
  problemas: [],
  ok: true,
  pdf_ok: true,
  pode_gerir: true,
};

describe("tela: modo do contrato", () => {
  it("com CRECI: modo padrão, sem bloco contrato, PDF com o captador (inalterado)", () => {
    const t = parseTestemunhas(telaComCreci)!;
    expect(t.modo).toBe("padrao");
    expect(t.contrato).toBeNull();
    expect(bloqueioContratoSemCreci(t, "55555-F")).toBeNull();
    expect(
      blocoCorretorContrato(t, { nome: "Caio Comcreci", cpf: "12345678909", creci: "55555-F" }),
    ).toEqual({ broker_name: "Caio Comcreci", broker_cpf: "12345678909", broker_creci: "55555-F" });
    // Captador com CRECI: o CRECI continua não bloqueando e as pendências não mudam.
    expect(missingRequirements(emptyForm(), [], "123", "55555-F")).not.toContain(
      "CRECI do captador",
    );
  });

  it("sem CRECI: contrato com o gestor/TL; captador testemunha 1; testemunha 2 digitada", () => {
    const t = parseTestemunhas(telaSemCreci())!;
    expect(t.modo).toBe("sem_creci");
    expect(bloqueioContratoSemCreci(t, "")).toBeNull();
    expect(
      blocoCorretorContrato(t, { nome: "Carla Semcreci", cpf: "11144477735", creci: "" }),
    ).toEqual({ broker_name: "Gina Gestora", broker_cpf: "52998224725", broker_creci: "12345-F" });
    const pdf = testemunhasParaPdf(
      {
        testemunha_1: { nome: "x", rg: "1", cpf: "1" },
        testemunha_2: { nome: "y", rg: "", cpf: "" },
      },
      t,
    );
    expect(pdf.testemunha_1).toEqual({ nome: "Carla Semcreci", rg: "", cpf: "11144477735" });
    expect(pdf.testemunha_2).toEqual({ nome: "Paula Exemplo", rg: "", cpf: "98765432100" });
    expect(missingRequirements(emptyForm(), [], "123", "")).not.toContain("CRECI do captador");
  });

  it("sem CRECI: fixar o PDF manda _gestor null (testemunha digitada não tem id) e _corretor = captador", async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: null,
      error: null,
    }));
    const db = { rpc } as unknown as Parameters<typeof fixarTestemunhasPdf>[0];
    await fixarTestemunhasPdf(db, CAP, parseTestemunhas(telaSemCreci())!, "org/cap/contrato.pdf");
    expect(rpc).toHaveBeenCalledWith("exclusive_testemunhas_fixar", {
      _id: CAP,
      _corretor: "c1",
      _gestor: null,
      _path: "org/cap/contrato.pdf",
      _dados: "abc",
    });
    // Com CRECI segue igual: o gestor da equipe vai com o id dele.
    rpc.mockClear();
    await fixarTestemunhasPdf(db, CAP, parseTestemunhas(telaComCreci)!, "p.pdf");
    expect(rpc.mock.calls[0][1]).toMatchObject({ _corretor: "c2", _gestor: "g1" });
  });

  it("sem CRECI e sem Clicksign: vale igual (o PDF usa o gestor/TL e a testemunha digitada)", () => {
    const t = parseTestemunhas(telaSemCreci({ aplica: false }))!;
    expect(testemunhasParaPdf({ testemunha_1: {}, testemunha_2: {} }, t).testemunha_2).toEqual({
      nome: "Paula Exemplo",
      rg: "",
      cpf: "98765432100",
    });
  });

  it("sem CRECI, testemunha 2 não digitada: não gera PDF (mensagem clara)", () => {
    const t = parseTestemunhas(
      telaSemCreci({
        gestor: null,
        manual: null,
        ok: false,
        problemas: [
          "Testemunha 2: o captador não tem CRECI, então a testemunha 2 é digitada. Informe nome, CPF e e-mail",
        ],
      }),
    )!;
    const motivo = bloqueioContratoSemCreci(t, "");
    expect(motivo).toMatch(/testemunha 2 é digitada/);
    expect(() =>
      blocoCorretorContrato(t, { nome: "Carla Semcreci", cpf: "11144477735", creci: "" }),
    ).toThrow(/testemunha 2 é digitada/);
  });

  it("nenhum gestor/TL com CRECI: bloqueia (nunca contrato sem CRECI)", () => {
    const t = parseTestemunhas(
      telaSemCreci({
        contrato: {
          id: "g1",
          nome: "Gina Gestora",
          cpf: "52998224725",
          creci: "",
          ok: false,
          falta: ["CRECI no cadastro"],
          origem: "equipe",
        },
        ok: false,
        problemas: [
          "Corretor do contrato: o captador não tem CRECI e nenhum gestor ou team leader desta imobiliária tem CRECI e CPF válidos no cadastro. O contrato não pode ser gerado sem CRECI: cadastre o CRECI de um gestor/TL (ou do captador)",
        ],
      }),
    )!;
    expect(bloqueioContratoSemCreci(t, "")).toMatch(/nenhum gestor ou team leader/);
    expect(() => blocoCorretorContrato(t, { nome: "C", cpf: "1", creci: "" })).toThrow(
      /não pode ser gerado sem CRECI/,
    );
    // Mesmo com "ok" forjado, sem CRECI no bloco contrato não sai.
    const forjado = parseTestemunhas(
      telaSemCreci({
        contrato: { id: "g1", nome: "Gina", cpf: "52998224725", creci: "", ok: true, falta: [] },
      }),
    )!;
    expect(() => blocoCorretorContrato(forjado, { nome: "C", cpf: "1", creci: "" })).toThrow();
  });

  it("falha ao ler (null) ou modo desatualizado: fail-closed", () => {
    expect(() => blocoCorretorContrato(null, { nome: "C", cpf: "1", creci: "" })).toThrow(
      /Atualize a página/,
    );
    const velho = parseTestemunhas(telaComCreci)!;
    expect(() => blocoCorretorContrato(velho, { nome: "C", cpf: "1", creci: "" })).toThrow(
      /CRECI do captador mudou/,
    );
  });

  it("troca do gestor/TL pelo staff aparece como escolhido e o PDF usa o novo", () => {
    const t = parseTestemunhas(
      telaSemCreci({
        contrato: {
          id: "tl",
          nome: "Tiago Lider",
          cpf: "39053344705",
          creci: "67890-F",
          ok: true,
          falta: [],
          origem: "escolhido",
        },
        contrato_escolhido: true,
      }),
    )!;
    expect(t.contratoEscolhido).toBe(true);
    expect(t.contrato?.origem).toBe("escolhido");
    expect(blocoCorretorContrato(t, { nome: "Carla", cpf: "11144477735", creci: "" })).toEqual({
      broker_name: "Tiago Lider",
      broker_cpf: "39053344705",
      broker_creci: "67890-F",
    });
  });

  it("testemunha 2 digitada: recusa igual ao corretor do contrato, ao captador e dado inválido", () => {
    const t = parseTestemunhas(telaSemCreci())!;
    expect(
      testemunhaManualErros({ nome: "Gina Gestora", cpf: "529.982.247-25", email: "g@x.com" }, t),
    ).toContain("ser outra pessoa (não pode ser o corretor do contrato)");
    expect(
      testemunhaManualErros({ nome: "Carla S", cpf: "11144477735", email: "c@x.com" }, t),
    ).toContain("ser outra pessoa (o captador já é a testemunha 1)");
    expect(testemunhaManualErros({ nome: "Joao", cpf: "12345678900", email: "x" }, t)).toEqual([
      "nome com sobrenome",
      "CPF válido",
      "e-mail válido",
    ]);
    expect(
      testemunhaManualErros({ nome: "Paula Exemplo", cpf: "987.654.321-00", email: "p@x.com" }, t),
    ).toEqual([]);
  });

  it("t_c0453ded: tela — sem CRECI, gestor/TL do contrato como único 'pela imobiliária' trava; junto com outro, libera", () => {
    const t = parseTestemunhas(telaSemCreci())!;
    expect(corretorContratoAssina(t)).toBe(true);
    const form = { proprietario_1: { nome_completo: "Ana Teste Silva", email: "ana@example.com" } };
    expect(sendDialogErrors({ form, imobiliariaIds: ["g1"], testemunhas: t })).toEqual([
      "Gina Gestora já assina como Corretor (o captador não tem CRECI). Escolha outra pessoa para assinar pela imobiliária.",
    ]);
    expect(sendDialogErrors({ form, imobiliariaIds: ["g1", IMOB], testemunhas: t })).toEqual([]);
    // Com CRECI: regra nova não se aplica.
    expect(corretorContratoAssina(parseTestemunhas(telaComCreci))).toBe(false);
    expect(corretorContratoAssina(null)).toBe(false);
  });

  it("botão de envio trava com o problema do banco (ex.: testemunha igual ao corretor do contrato)", () => {
    const t = parseTestemunhas(
      telaSemCreci({
        ok: false,
        problemas: [
          "Testemunha 2 (digitada Gina Gestora): falta ser outra pessoa (não pode ser o corretor do contrato)",
        ],
      }),
    )!;
    const errs = sendDialogErrors({
      form: { proprietario_1: { nome_completo: "Ana Teste Silva", email: "ana@example.com" } },
      imobiliariaIds: [IMOB],
      testemunhas: t,
    });
    expect(errs.join(" ")).toMatch(/corretor do contrato/);
  });
});

// ---------- envio Clicksign (mock) ----------
type ImobSigner = { id: string; nome: string; email: string };
const VERA: ImobSigner = { id: IMOB, nome: "Vera Imobiliária", email: "vera@example.com" };
/** Gestora do contrato também cadastrada para assinar pela imobiliária (caso do duplicado). */
const GINA_ID = "44444444-4444-4444-8444-444444444444";
const GINA: ImobSigner = { id: GINA_ID, nome: "Gina Gestora", email: "gina@example.com" };

function deps(raw: unknown, imobiliaria: ImobSigner[] = [VERA]) {
  const posted: Array<{ key: string; body: unknown }> = [];
  let n = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, "").replace(/[0-9a-f-]{36}/g, ":id");
    const key = `${init.method ?? "GET"} ${path}`;
    if (init.body && typeof init.body === "string")
      posted.push({ key, body: JSON.parse(init.body) });
    n += 1;
    return Response.json(
      { data: { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` } },
      { status: 201 },
    );
  });
  const d: SendDeps = {
    actorId: "actor",
    fetch,
    authorize: vi.fn(async () => ORG),
    loadContext: vi.fn(async () => ({
      organizationId: ORG,
      form: { proprietario_1: { nome_completo: "Ana Teste Silva", email: "ana@example.com" } },
      testemunhas: testemunhasDoBanco(raw),
      imobiliaria,
      testMode: false,
      allowlistSha256: [],
      deadlineDays: 30,
      token: "tok-fake",
      gerado: { id: DOC, fileName: "c.pdf" },
    })),
    loadPdf: vi.fn(async () => new TextEncoder().encode("%PDF-1.4 TESTE")),
    insertEnvelope: vi.fn(async () => "row-1"),
    updateEnvelope: vi.fn(async () => undefined),
    markSent: vi.fn(async () => undefined),
  };
  return { d, fetch, posted };
}

/** Resposta do resolvedor (service_role, com e-mail) no modo sem CRECI. */
const resolverSemCreci = (over: Record<string, unknown> = {}) => ({
  modo: "sem_creci",
  ok: true,
  corretor: { id: "c1", nome: "Carla Semcreci", email: "carla@example.com" },
  gestor: { id: null, nome: "Paula Exemplo", email: "paula@example.com", origem: "manual" },
  contrato: { id: GINA_ID, nome: "Gina Gestora", email: "gina@example.com", creci: "12345-F" },
  problemas: [],
  pdf_ok: true,
  ...over,
});

describe("envio Clicksign sem CRECI (mock)", () => {
  /** Signatários postados na Clicksign: [e-mail, qualificação] na ordem. */
  const enviados = (posted: Array<{ key: string; body: unknown }>) => {
    const emails = posted
      .filter((p) => p.key === "POST /envelopes/:id/signers")
      .map((p) => (p.body as { data: { attributes: { email: string } } }).data.attributes.email);
    const roles = posted
      .filter((p) => p.key === "POST /envelopes/:id/requirements")
      .map((p) => (p.body as { data: { attributes: { role?: string } } }).data.attributes.role)
      .filter(Boolean);
    return { emails, roles };
  };
  const linhaGravada = (d: SendDeps) =>
    (d.insertEnvelope as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      signers: Array<{ papel: string; nome: string; email_sha256: string }>;
    };

  it("t_c0453ded: sem CRECI, o gestor/TL do contrato assina automaticamente como CORRETOR (real_estate_broker)", async () => {
    const { d, posted } = deps(resolverSemCreci());
    const r = await handleSend(d, { capture_id: CAP, imobiliaria_ids: [IMOB] });
    expect(r.status).toBe(200);
    expect(r.body.signers).toBe(5);
    const row = linhaGravada(d);
    expect(row.signers.map((s) => [s.papel, s.nome])).toEqual([
      ["proprietario_1", "Ana Teste Silva"],
      ["corretor", "Gina Gestora"],
      ["imobiliaria", "Vera Imobiliária"],
      ["testemunha", "Carla Semcreci"],
      ["testemunha", "Paula Exemplo"],
    ]);
    expect(row.signers[1].email_sha256).toBe(await sha256Hex("gina@example.com"));
    expect(row.signers[4].email_sha256).toBe(await sha256Hex("paula@example.com"));
    const { emails, roles } = enviados(posted);
    expect(emails).toEqual([
      "ana@example.com",
      "gina@example.com",
      "vera@example.com",
      "carla@example.com",
      "paula@example.com",
    ]);
    // Gestora como Corretor (parte), NÃO como testemunha; captador e digitada seguem testemunhas.
    expect(roles).toEqual(["contractor", "real_estate_broker", "contractee", "witness", "witness"]);
  });

  it("t_c0453ded: gestor/TL do contrato marcado também 'pela imobiliária' aparece uma vez só (como Corretor)", async () => {
    const { d, posted } = deps(resolverSemCreci(), [VERA, GINA]);
    const r = await handleSend(d, { capture_id: CAP, imobiliaria_ids: [IMOB, GINA_ID] });
    expect(r.status).toBe(200);
    const { emails, roles } = enviados(posted);
    expect(emails.filter((e) => e === "gina@example.com")).toHaveLength(1);
    expect(linhaGravada(d).signers.map((s) => s.papel)).toEqual([
      "proprietario_1",
      "corretor",
      "imobiliaria",
      "testemunha",
      "testemunha",
    ]);
    expect(roles).toEqual(["contractor", "real_estate_broker", "contractee", "witness", "witness"]);
  });

  it("t_c0453ded: gestor/TL do contrato como ÚNICO 'pela imobiliária': 422 pedindo outra pessoa, nada enviado", async () => {
    const { d, fetch } = deps(resolverSemCreci(), [VERA, GINA]);
    const r = await handleSend(d, { capture_id: CAP, imobiliaria_ids: [GINA_ID] });
    expect(r.status).toBe(422);
    expect(String((r.body.details as string[])[0])).toMatch(/Gina Gestora já assina como Corretor/);
    expect(fetch).not.toHaveBeenCalled();
    expect(d.insertEnvelope).not.toHaveBeenCalled();
  });

  it("t_c0453ded: modo sem CRECI sem corretor do contrato na resposta do banco: fail-closed (422)", async () => {
    const { d, fetch } = deps(resolverSemCreci({ contrato: null }));
    const r = await handleSend(d, { capture_id: CAP, imobiliaria_ids: [IMOB] });
    expect(r.status).toBe(422);
    expect(r.body.details).toEqual(["Corretor do contrato: não definido"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("t_c0453ded: COM CRECI nada muda — sem Corretor, captador e gestor da equipe como testemunhas", async () => {
    const { d, posted } = deps(
      {
        modo: "padrao",
        ok: true,
        corretor: { id: "c2", nome: "Caio Comcreci", email: "caio@example.com" },
        gestor: { id: GINA_ID, nome: "Gina Gestora", email: "gina@example.com", origem: "equipe" },
        problemas: [],
        pdf_ok: true,
      },
      [VERA, GINA],
    );
    const r = await handleSend(d, { capture_id: CAP, imobiliaria_ids: [IMOB] });
    expect(r.status).toBe(200);
    expect(linhaGravada(d).signers.map((s) => [s.papel, s.nome])).toEqual([
      ["proprietario_1", "Ana Teste Silva"],
      ["imobiliaria", "Vera Imobiliária"],
      ["testemunha", "Caio Comcreci"],
      ["testemunha", "Gina Gestora"],
    ]);
    const { roles } = enviados(posted);
    expect(roles).toEqual(["contractor", "contractee", "witness", "witness"]);
    expect(roles).not.toContain("real_estate_broker");
  });

  it("sem testemunha digitada ou sem gestor/TL com CRECI: 422 e nada vai à Clicksign", async () => {
    for (const raw of [
      resolverSemCreci({ gestor: null, ok: false, problemas: ["Testemunha 2: informe"] }),
      resolverSemCreci({ ok: false, problemas: ["Corretor do contrato: nenhum gestor com CRECI"] }),
    ]) {
      const { d, fetch } = deps(raw);
      const r = await handleSend(d, { capture_id: CAP, imobiliaria_ids: [IMOB] });
      expect(r.status).toBe(422);
      expect(fetch).not.toHaveBeenCalled();
      expect(d.insertEnvelope).not.toHaveBeenCalled();
    }
  });

  it("testemunha digitada com o e-mail do proprietário: recusa (mesma pessoa duas vezes)", async () => {
    const { d, fetch } = deps(
      resolverSemCreci({
        gestor: { id: null, nome: "Ana Teste Silva", email: "ana@example.com", origem: "manual" },
      }),
    );
    const r = await handleSend(d, { capture_id: CAP, imobiliaria_ids: [IMOB] });
    expect(r.status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("PDF gerado antes de trocar o corretor do contrato: 422 pedindo gerar de novo", async () => {
    const { d, fetch } = deps(resolverSemCreci({ pdf_ok: false }));
    const r = await handleSend(d, { capture_id: CAP, imobiliaria_ids: [IMOB] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("testemunhas:pdf");
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------- PDF real (modelo original, fora do git) ----------
const base = "assets/exclusividade/remax-padrao.pdf";
const unit: ExclusiveUnit = {
  id: "u1",
  nome: "Unidade Teste",
  creci: "99999-J",
  razao_social: "TESTE NEGÓCIOS IMOBILIÁRIOS LTDA",
  endereco: "Rua Exemplo, 100 - Centro",
  cidade: "Sorocaba",
  estado: "São Paulo",
  cnpj: "11.222.333/0001-81",
  nome_comercial: "RE/MAX TESTE",
  legacy_template: null,
  contrato_antigo: false,
  ativo: true,
};

describe("PDF do contrato", () => {
  it.skipIf(!existsSync(base))(
    "sem CRECI: bloco corretor = gestor/TL (nome, CRECI, CPF); testemunhas = captador e digitada",
    async () => {
      const t = parseTestemunhas(telaSemCreci())!;
      const captura = {
        id: "c1",
        template: "remax-padrao",
        unit_id: "u1",
        form_data: emptyForm(),
        broker_name: "Carla Semcreci",
        broker_cpf: "11144477735",
        broker_creci: "",
        created_on_sp: "2026-11-04",
      } as unknown as Capture;
      const bloco = blocoCorretorContrato(t, {
        nome: "Carla Semcreci",
        cpf: "11144477735",
        creci: "",
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
      expect(form.getTextField("NamGFe").getText()).toBe("Carla Semcreci");
      expect(form.getTextField("Individual TaxpaGFByer Registry").getText()).toBe("11144477735");
      expect(form.getTextField("NamDe").getText()).toBe("Paula Exemplo");
      expect(form.getTextField("Individual Taxpayer Registry").getText()).toBe("98765432100");
      if (process.env.SEM_CRECI_PDF_OUT)
        writeFileSync(process.env.SEM_CRECI_PDF_OUT, await montar(true));
    },
  );
});
