import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addOwner,
  canRemoveOwner,
  captureOwners,
  emptyForm,
  emptyOwner,
  fillExclusiveTemplate,
  missingRequirements,
  normalizeForm,
  ownerListSuffix,
  removeOwner,
  withOwners,
  type Capture,
  type CaptureDocument,
  type Owner,
} from "./exclusive-captures";
import { layoutExtraOwners, OWNERS_BOTTOM, OWNERS_PAGE } from "./exclusive-owners-pdf";

// Dados 100% fictícios.
const dono = (n: number): Owner => ({
  ...emptyOwner(),
  nome_completo: `Proprietário Fictício Número ${n} da Silva Exemplo`,
  rg: `${n}0.000.000-0`,
  cpf: "000.000.001-91",
  endereco_completo: `Rua Fictícia ${n}, ${n * 10}, apto ${n}, Bairro Exemplo, Sorocaba/SP, 18000-000`,
  nacionalidade: "brasileira",
  estado_civil: "casado(a) sob comunhão parcial de bens",
  email: `proprietario${n}@example.com`,
  telefone_1: "(15) 90000-0000",
});
const doc = (kind: CaptureDocument["kind"], owner_index = 0): CaptureDocument => ({
  id: `${kind}-${owner_index}`,
  capture_id: "c",
  kind,
  owner_index,
  storage_path: "x",
  file_name: "x.pdf",
});
const formWith = (n: number) =>
  withOwners(
    emptyForm(),
    Array.from({ length: n }, (_, i) => dono(i + 1)),
  );

describe("vários proprietários (t_58effd65)", () => {
  it("1, 2, 4 e 35 proprietários: lista, formato salvo e contagem na listagem", () => {
    expect(captureOwners(formWith(1))).toHaveLength(1);
    expect(formWith(1).proprietario_2).toBeUndefined();
    expect(formWith(2).proprietarios_extras).toBeUndefined();
    const f4 = formWith(4);
    expect(f4.proprietario_2?.nome_completo).toContain("Número 2");
    expect(f4.proprietarios_extras).toHaveLength(2);
    expect(ownerListSuffix(f4)).toMatch(/Número 2 .* \+2$/);
    expect(captureOwners(normalizeForm(JSON.parse(JSON.stringify(formWith(35)))))).toHaveLength(35);
  });
  it("captação antiga (só proprietario_1/2) abre igual e extras sem 2º são ignorados", () => {
    const antiga = normalizeForm({ proprietario_1: dono(1), proprietario_2: dono(2) });
    expect(antiga.proprietarios_extras).toBeUndefined();
    expect(captureOwners(antiga)).toHaveLength(2);
    expect(
      captureOwners(normalizeForm({ proprietario_1: dono(1), proprietarios_extras: [dono(3)] })),
    ).toHaveLength(1);
  });
  it("documentos obrigatórios para cada um, com 35 proprietários", () => {
    const f = formWith(35);
    for (const k of Object.keys(f.imovel) as (keyof typeof f.imovel)[]) f.imovel[k] = "x";
    const all = [
      doc("matricula"),
      doc("iptu"),
      ...Array.from({ length: 35 }, (_, i) => doc("cnh", i + 1)),
    ];
    expect(missingRequirements(f, all, "123", "CRECI")).toEqual([]);
    const semO34 = all.filter((d) => d.owner_index !== 34);
    expect(missingRequirements(f, semO34, "123", "CRECI")).toEqual([
      "Proprietário 34: RG e CPF ou CNH",
    ]);
  });
  it("remover: mínimo 1; não troca documento de pessoa", () => {
    const f = formWith(4);
    expect(canRemoveOwner(f, [], 1).ok).toBe(false);
    expect(canRemoveOwner(f, [doc("cnh", 4)], 3).ok).toBe(false);
    expect(canRemoveOwner(f, [doc("cnh", 4)], 4).ok).toBe(true);
    expect(captureOwners(removeOwner(f, 3))[2].nome_completo).toContain("Número 4");
    expect(captureOwners(addOwner(f))).toHaveLength(5);
  });
  it("layout com 35: blocos inteiros, nada abaixo da margem, todos numerados 3..35", () => {
    const measure = (t: string, s: number) => t.length * s * 0.5;
    const extras = Array.from({ length: 33 }, (_, i) => dono(i + 3));
    const { pages, blocks } = layoutExtraOwners(extras, 3, measure);
    expect(blocks.map((b) => b.number)).toEqual(Array.from({ length: 33 }, (_, i) => i + 3));
    for (const b of blocks) {
      expect(b.bottom).toBeGreaterThanOrEqual(OWNERS_BOTTOM);
      expect(b.top).toBeLessThanOrEqual(OWNERS_PAGE.height);
    }
    expect(pages).toBeGreaterThan(5);
  });
  const base = "assets/exclusividade/remax-padrao.pdf";
  it.skipIf(!existsSync(base))(
    "PDF real com 4 e 35: 1º e 2º nos campos, extras em páginas novas",
    async () => {
      const unit = {
        id: "u1",
        nome: "Unidade Teste",
        creci: "99999-J",
        razao_social: "TESTE LTDA",
        endereco: "Rua Exemplo, 100",
        cidade: "Sorocaba",
        estado: "São Paulo",
        cnpj: "11.222.333/0001-81",
        nome_comercial: "RE/MAX TESTE",
        legacy_template: null,
        contrato_antigo: false,
        ativo: true,
      };
      const { PDFDocument } = await import("pdf-lib");
      for (const n of [2, 4, 35]) {
        const capture = {
          id: "c",
          captor_id: "u",
          template: "remax-padrao",
          unit_id: "u1",
          status: "enviada",
          form_data: formWith(n),
          broker_name: "Corretor Fictício",
          broker_cpf: "000.000.001-91",
          broker_creci: "000000-F",
          created_on_sp: "2026-10-22",
          created_at: "2026-10-22",
        } as Capture;
        const out = await fillExclusiveTemplate(
          new Uint8Array(readFileSync(base)),
          capture,
          true,
          "2026-10-22",
          unit,
        );
        const pages = (await PDFDocument.load(out)).getPageCount();
        if (n === 2) expect(pages).toBe(6);
        else expect(pages).toBeGreaterThan(6);
        if (process.env.PDF_OUT)
          writeFileSync(`${process.env.PDF_OUT}/contrato-${n}-proprietarios.pdf`, out);
      }
    },
  );
});
