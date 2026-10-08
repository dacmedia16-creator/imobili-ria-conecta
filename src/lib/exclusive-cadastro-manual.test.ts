import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSignedContractPrompt, sanitizeSignedContractAi } from "./exclusive-captures-ai";
import {
  applySignedContract,
  captureNextAction,
  emptyOwner,
  manualPendencies,
  MANUAL_COLOR,
  normalizeForm,
  type CaptureDocument,
} from "./exclusive-captures";
import { COR_CAPTACAO } from "./mapa-captacoes";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const up = read("../../supabase/migrations/20261008160000_exclusividade_cadastro_manual.sql");
const down = read("../../supabase/rollback/20261008160000_exclusividade_cadastro_manual.sql");
const fn = (sql: string, name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  return sql.slice(start, sql.indexOf("END $function$;", start));
};
const doc = (kind: CaptureDocument["kind"], owner = 0): CaptureDocument =>
  ({ id: kind + owner, kind, owner_index: owner, file_name: `${kind}.pdf` }) as CaptureDocument;

describe("cadastro manual — leitura do contrato assinado (IA das Vendas)", () => {
  it("prompt pede todos os campos do contrato e proíbe inventar", () => {
    const p = buildSignedContractPrompt();
    for (const k of [
      "proprietario_1",
      "proprietario_2",
      "imovel",
      "prazo_dias",
      "comissao_percentual",
      "data_assinatura",
      "data_vencimento",
      "foro_comarca",
    ])
      expect(p).toContain(`"${k}"`);
    expect(p).toMatch(/nunca invente/);
  });

  it("limpa a resposta: datas válidas, prazo, comissão, UF por extenso e CPF inválido descartado", () => {
    const v = sanitizeSignedContractAi(
      {
        proprietario_1: { nome_completo: "Maria Ficticia", cpf: "111.111.111-11" },
        imovel: { endereco: "Rua Teste, 10", municipio: "Sorocaba", estado: "SP" },
        prazo_dias: "180 dias",
        comissao_percentual: "6%",
        data_assinatura: "2026-06-02",
        foro_estado: "SP",
        lixo: "ignorar",
      },
      "2026-10-08",
    );
    expect(v.proprietario_1.nome_completo).toBe("Maria Ficticia");
    expect(v.proprietario_1.cpf).toBeUndefined();
    expect(v.data_assinatura).toBe("2026-06-02");
    expect(v.condicoes).toMatchObject({
      prazo_dias_numero: "180",
      comissao_percentual_numero: "6",
      foro_estado: "São Paulo",
    });
    expect(v).not.toHaveProperty("lixo");
    expect(v.proprietario_2).toBeUndefined();
  });

  it("assinatura no futuro ou data inexistente é descartada; prazo sai do vencimento", () => {
    expect(
      sanitizeSignedContractAi({ data_assinatura: "2027-01-01" }, "2026-10-08").data_assinatura,
    ).toBeUndefined();
    expect(
      sanitizeSignedContractAi({ data_assinatura: "2026-02-30" }, "2026-10-08").data_assinatura,
    ).toBeUndefined();
    const v = sanitizeSignedContractAi(
      { data_assinatura: "2026-01-01", data_vencimento: "2026-07-01" },
      "2026-10-08",
    );
    expect(v.condicoes.prazo_dias_numero).toBe("181");
  });

  it("aplica só nos campos vazios e lista o que preencheu", () => {
    const base = normalizeForm({});
    base.imovel.endereco = "Digitado pelo corretor";
    const { form, filled } = applySignedContract(base, {
      proprietario_1: { nome_completo: "Maria Ficticia" },
      proprietario_2: { nome_completo: "João Ficticio" },
      imovel: { endereco: "Lido pela IA", bairro: "Campolim" },
      condicoes: { prazo_dias_numero: "180" },
      data_assinatura: "2026-06-02",
    });
    expect(form.imovel.endereco).toBe("Digitado pelo corretor");
    expect(form.imovel.bairro).toBe("Campolim");
    expect(form.proprietario_1.nome_completo).toBe("Maria Ficticia");
    expect(form.proprietario_2?.nome_completo).toBe("João Ficticio");
    expect(form.data_assinatura).toBe("2026-06-02");
    expect(filled).toContain("Data de assinatura");
    expect(filled.some((f) => /proprietário 2/.test(f))).toBe(true);
    expect(filled).not.toContain("Endereço");
  });

  it("data de assinatura sobrevive ao normalizeForm (vai para signed_on na aprovação)", () => {
    expect(normalizeForm({ data_assinatura: "2026-06-02" }).data_assinatura).toBe("2026-06-02");
    expect(normalizeForm({}).data_assinatura).toBeUndefined();
  });
});

describe("cadastro manual — único obrigatório é o contrato", () => {
  it("sem contrato: obrigatório; com contrato: só pendências opcionais", () => {
    const form = normalizeForm({});
    expect(manualPendencies(form, []).required).toEqual(["Contrato assinado"]);
    const r = manualPendencies(form, [doc("assinado")]);
    expect(r.required).toEqual([]);
    expect(r.optional).toEqual(
      expect.arrayContaining([
        "Nome do proprietário",
        "RG + CPF ou CNH do proprietário 1",
        "IPTU",
        "Matrícula",
      ]),
    );
  });

  it("completo não deixa pendência; segundo proprietário só conta se existir", () => {
    const form = normalizeForm({ data_assinatura: "2026-06-02" });
    form.proprietario_1.nome_completo = "Maria";
    form.imovel.endereco = "Rua A, 1";
    form.imovel.municipio = "Sorocaba";
    form.condicoes.prazo_dias_numero = "180";
    const docs = [doc("assinado"), doc("cnh", 1), doc("residencia"), doc("iptu"), doc("matricula")];
    expect(manualPendencies(form, docs)).toEqual({ required: [], optional: [] });
    expect(manualPendencies({ ...form, proprietario_2: emptyOwner() }, docs).optional).toContain(
      "RG + CPF ou CNH do proprietário 2",
    );
  });

  it("Plano de Marketing é obrigatório no manual: vitais pré-marcadas, bloqueia envio e aprovação", () => {
    const route = read("../routes/_authenticated/exclusividades.$id.tsx");
    const step = read("../components/CaptureDossieStep.tsx");
    // Mesma regra da normal (sem exceção para o manual) e vitais já marcadas.
    expect(route).toContain("const dossieMissing = dossieMissingFor(dossieActions, dossieIds);");
    expect(route).not.toMatch(/dossieRequired = !manual/);
    expect(route).toContain("initialDossieSelection(dossieActions, undefined, true)");
    // Pendência obrigatória (desabilita "Enviar ao gestor") e mesma navegação até a etapa.
    expect(route).toContain(
      'manualCheck.required.push("Plano de Marketing: marque ao menos 1 ação")',
    );
    expect(route).toMatch(
      /manual && dossieMissing && \(name === "enviar" \|\| name === "aprovar"\)\) \{\s+setStep\("dossie"\)/,
    );
    // Botão Aprovar: mesma regra do banco nos dois fluxos (auditoria t_874, ALTO-2).
    expect(route).toContain("aprovarBloqueio({ manual, docs, dossieMissing })");
    expect(route).toMatch(/disabled=\{busy \|\| !!bloqueioAprovar\}[\s\S]{0,160}action\("aprovar"\)/);
    // Nada de "opcional" para o Plano de Marketing.
    expect(route).not.toMatch(/Plano de Marketing[^\n]*[Oo]pcional/);
    expect(route).not.toContain("optional\n");
    expect(step).not.toContain("Não impede o envio ao gestor");
    expect(up.slice(0, 600)).not.toMatch(/Marketing \(opcional\)/);
  });

  it("próxima ação e cor do selo/pino seguem a maquete (roxo)", () => {
    expect(captureNextAction("enviada", true, true)).toBe("Conferir e aprovar o cadastro manual");
    expect(captureNextAction("enviada", false, true)).toBe("Aguardar aprovação do gestor");
    expect(captureNextAction("enviada", true)).toBe("Revisar e encaminhar para assinatura");
    expect(MANUAL_COLOR).toBe("#7c3aed");
    expect(MANUAL_COLOR).toBe(COR_CAPTACAO);
  });
});

describe("cadastro manual — migration 20261008160000 e rollback", () => {
  it("coluna manual com padrão false; criação só na própria imobiliária e captador = logado", () => {
    expect(up).toContain("ADD COLUMN manual boolean NOT NULL DEFAULT false");
    const body = fn(up, "exclusive_create_manual");
    expect(body).toContain("organization_id = public.current_org_id() AND ativo");
    expect(body).toMatch(/VALUES \(auth\.uid\(\),auth\.uid\(\)/);
    expect(body).toContain("'corretor','gestor','team_leader','admin','super_admin'");
    expect(up).toContain(
      "REVOKE ALL ON FUNCTION public.exclusive_create_manual(uuid) FROM PUBLIC, anon",
    );
    expect(up).toContain(
      "ALTER FUNCTION public.exclusive_create_manual(uuid) OWNER TO mt_1b_definer",
    );
  });

  it("envio manual exige só o contrato assinado; aprovação é do gestor e grava aprovada + signed_on", () => {
    const t = fn(up, "exclusive_transition");
    expect(t).toMatch(/_action = 'enviar' AND _c\.manual[\s\S]*kind='assinado'/);
    expect(t).toMatch(/_action = 'assinatura' THEN\s+IF _c\.manual OR/);
    expect(t).toMatch(/_action = 'aprovar'[\s\S]*exclusive_is_manager/);
    expect(t).toMatch(/SET status='aprovada'[\s\S]*signed_on=coalesce\(signed_on,_d,_hoje\)/);
    // devolver mantém o contrato de papel da manual
    expect(t).toContain("(kind = 'assinado' AND NOT _c.manual)");
  });

  it("normal não muda: assinado continua PDF e só do gestor; manual não aceita contrato gerado", () => {
    const r = fn(up, "exclusive_register_document");
    expect(r).toContain("Apenas gestor pode anexar contrato assinado");
    expect(r).toContain("(_kind = 'assinado' AND NOT _manual AND _mime <> 'application/pdf')");
    expect(r).toMatch(/_kind = 'gerado' THEN[\s\S]*IF _manual OR/);
  });

  it("não altera o mapa do PR #41 (mapa_captacoes) nem o alerta de vencimento", () => {
    expect(up).not.toMatch(/FUNCTION public\.mapa_captacoes/);
    expect(down).not.toMatch(/FUNCTION public\.mapa_captacoes/);
  });

  it("rollback remove a RPC e a coluna e devolve as funções alteradas", () => {
    expect(down).toMatch(/DROP FUNCTION (IF EXISTS )?public\.exclusive_create_manual\(uuid\)/);
    expect(down).toMatch(/DROP COLUMN (IF EXISTS )?manual/);
    for (const name of [
      "exclusive_register_document",
      "exclusive_transition",
      "exclusive_set_signed_on",
      "exclusive_archive",
    ])
      expect(down).toContain(`FUNCTION public.${name}(`);
    expect(down).toContain("CREATE POLICY exclusive_documents_read");
  });
});
