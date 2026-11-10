// Ficha de abertura + checklist por parte + trava do "Montar contrato" (t_28e583e2). Regras puras do front e
// conferência de que o front e a migration 20261113120000 usam as mesmas listas. A suíte do banco (isolamento,
// trava, data da documentação completa) é supabase/tests/locacao-ficha.sql (run-locacao-ficha.sh).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  docsParaTexto,
  faltasFicha,
  fichaParaBanco,
  itemOpcional,
  lerDetalhe,
  lerFicha,
  textoParaDocs,
  type FichaLocacao,
} from "./locacao";
import { itemLidoPorIa, tipoDoItem } from "./locacao-ia";

const MIG = readFileSync("supabase/migrations/20261113120000_locacao_ficha_checklist.sql", "utf8");
const RB = readFileSync("supabase/rollback/20261113120000_locacao_ficha_checklist.sql", "utf8");
const F1 = readFileSync("supabase/migrations/20261110120000_locacao_fase1.sql", "utf8");

const fichaOk = (): FichaLocacao => ({
  imovelId: "IM-9001",
  mobilia: "semi",
  metragem: 68.5,
  locatarioEndereco: "Rua Atual Fictícia, 5 — Sorocaba/SP",
  locatarioPessoa: "pf",
  proprietarioPessoa: "pf",
  fiadorPessoa: "pf",
  proprietario: { nome: "Proprietário Exemplo", telefone: "(15) 90000-0002", email: "" },
  garantiaOutra: "",
  observacoes: "",
});

const padrao = (): Record<string, string[]> => {
  const json =
    /locacao_docs_padrao\(\)[\s\S]*?SELECT '(\{[\s\S]*?\})'::jsonb/.exec(MIG)?.[1] ?? "{}";
  return JSON.parse(json) as Record<string, string[]>;
};

describe("ficha de abertura (corretor preenche)", () => {
  it("lista o que falta da ficha, na ordem do formulário", () => {
    const vazia = lerFicha({});
    expect(faltasFicha(vazia, null)).toEqual([
      "ID do imóvel",
      "mobília",
      "metragem",
      "endereço atual do locatário",
      "nome do proprietário",
      "telefone ou e-mail do proprietário",
      "corretor captador",
    ]);
    expect(faltasFicha(fichaOk(), "uuid-captador")).toEqual([]);
  });
  it("proprietário: basta telefone OU e-mail", () => {
    const f = fichaOk();
    f.proprietario = { nome: "Fulano", telefone: "", email: "a@b.co" };
    expect(faltasFicha(f, "x")).toEqual([]);
    f.proprietario.email = "";
    expect(faltasFicha(f, "x")).toEqual(["telefone ou e-mail do proprietário"]);
  });
  it("campo vazio vai como null (sai da ficha no banco) e PF/PJ sempre vai", () => {
    const b = fichaParaBanco({ ...fichaOk(), observacoes: "  ", metragem: 0 });
    expect(b.observacoes).toBeNull();
    expect(b.metragem).toBeNull();
    expect(b.locatario_pessoa).toBe("pf");
    expect(b.imovel_id).toBe("IM-9001");
  });
  it("leitura fechada: valor estranho do banco vira padrão seguro", () => {
    const f = lerFicha({
      mobilia: "luxo",
      locatario_pessoa: "empresa",
      metragem: "x",
      proprietario: 5,
    });
    expect(f.mobilia).toBe("");
    expect(f.locatarioPessoa).toBe("pf");
    expect(f.metragem).toBe(0);
    expect(f.proprietario).toEqual({ nome: "", telefone: "", email: "" });
  });
  it("chaves que o front manda = chaves que o banco aceita (locacao_ficha_ok)", () => {
    const corpo = /FUNCTION public\.locacao_ficha_ok[\s\S]*?END \$\$;/.exec(MIG)?.[0] ?? "";
    const doBanco = new Set([...corpo.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    for (const k of Object.keys(fichaParaBanco(fichaOk()))) expect(doBanco.has(k)).toBe(true);
    for (const k of ["nome", "telefone", "email"]) expect(doBanco.has(k)).toBe(true);
  });
  it("detalhe traz ficha, captador, partes e a data da documentação completa", () => {
    const d = lerDetalhe({
      captador_id: "c",
      captador_nome: "Captador X",
      docs_completos_em: "2026-11-10T12:00:00Z",
      docs_completa: true,
      ficha: { imovel_id: "IM-1", proprietario_pessoa: "pj" },
      partes: [
        {
          parte: "proprietario",
          grupo: "proprietario_pj",
          rotulo: "Proprietário PJ",
          itens: [
            { item: "A", obrigatorio: true, entregue: true },
            { item: "B (opcional)", obrigatorio: false, entregue: false },
          ],
        },
      ],
    });
    expect(d.captadorNome).toBe("Captador X");
    expect(d.docsCompleta).toBe(true);
    expect(d.docsCompletosEm).toBe("2026-11-10T12:00:00Z");
    expect(d.ficha.proprietarioPessoa).toBe("pj");
    expect(d.partes[0].itens[1]).toEqual({
      item: "B (opcional)",
      obrigatorio: false,
      entregue: false,
    });
  });
  it("detalhe de banco antigo (sem docs_completa) usa a lista de faltando", () => {
    expect(lerDetalhe({ faltando: [] }).docsCompleta).toBe(true);
    expect(lerDetalhe({ faltando: ["x"] }).docsCompleta).toBe(false);
  });
});

describe("checklist por parte e itens opcionais", () => {
  it('opcional = nome termina em "(opcional)" (mesma regra do banco)', () => {
    expect(itemOpcional("Boleto do gás (opcional)")).toBe(true);
    expect(itemOpcional("Boleto do gás (OPCIONAL) ")).toBe(true);
    expect(itemOpcional("Opcional: RG")).toBe(false);
    expect(MIG).toContain("_item ~* '[(]opcional[)][[:space:]]*$'");
  });
  it("listas PF de antes não mudam (mesmo texto da Fase 1)", () => {
    const f1 = JSON.parse(
      /locacao_docs_padrao\(\)[\s\S]*?SELECT '(\{[\s\S]*?\})'::jsonb/.exec(F1)?.[1] ?? "{}",
    ) as Record<string, string[]>;
    const novo = padrao();
    for (const k of Object.keys(f1)) expect(novo[k]).toEqual(f1[k]);
  });
  it("listas PJ dos formulários reais; fiador PJ sem lista (a confirmar)", () => {
    const p = padrao();
    expect(p.locatario_pj).toContain("Cartão CNPJ da empresa locatária");
    expect(p.proprietario_pj).toContain(
      "Contrato social da empresa proprietária (última alteração)",
    );
    expect(p.fiador_pj).toBeUndefined();
    // Condomínio e gás ficam opcionais (imóvel sem condomínio/gás ainda a confirmar).
    expect(p.proprietario_pj.filter(itemOpcional)).toEqual([
      "Boleto do condomínio (opcional)",
      "CND do condomínio (opcional)",
      "Boleto do gás (opcional)",
    ]);
  });
  it("documentos PJ continuam lidos pela IA quando são de identidade/matrícula/contas", () => {
    expect(tipoDoItem("RG/CNH dos representantes da empresa locatária")).toBe("identidade");
    expect(tipoDoItem("Matrícula, escritura ou contrato de compra e venda do imóvel")).toBe(
      "matricula",
    );
    expect(tipoDoItem("Fatura CPFL do imóvel")).toBe("contas");
    expect(itemLidoPorIa("Contrato social da empresa proprietária (última alteração)")).toBe(false);
  });
  it("Regras: grupos PJ editáveis no mesmo texto (ida e volta) e o banco aceita as chaves", () => {
    const docs = {
      locatario: ["RG"],
      fiador: ["Renda"],
      caucao: [],
      seguro_fianca: ["Apólice"],
      proprietario: ["Matrícula"],
      locatario_pj: ["Cartão CNPJ"],
      fiador_pj: ["Contrato social do fiador"],
      proprietario_pj: ["Boleto do gás (opcional)"],
    };
    expect(textoParaDocs(docsParaTexto(docs))).toEqual(docs);
    for (const k of ["locatario_pj", "fiador_pj", "proprietario_pj"])
      expect(MIG).toContain(`'${k}'`);
  });
});

describe("trava do Montar contrato e rollback", () => {
  it("a trava vale para enviar a minuta e preparar a assinatura", () => {
    const corpo = /FUNCTION public\.locacao_contratos_acao[\s\S]*?END \$\$;/.exec(MIG)?.[0] ?? "";
    expect(corpo).toContain("IF _acao IN ('enviar_minuta', 'preparar_assinatura') THEN");
    expect(corpo).toContain("Montar contrato travado");
  });
  it("sem link público: nenhuma função nova para anon", () => {
    expect(MIG).not.toMatch(/TO\s+anon/i);
    expect(MIG).not.toMatch(/token/i);
  });
  it("rollback devolve cada função redefinida e apaga as colunas novas", () => {
    const redefinidas = [...MIG.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map(
      (m) => m[1],
    );
    const novas = [
      "locacao_doc_opcional",
      "locacao_docs_grupo",
      "locacao_partes",
      "locacao_checklist_l",
      "locacao_partes_json",
      "locacao_ficha_ok",
      "locacao_membro_ativo",
      "locacao_docs_situacao",
      "locacao_corretores",
    ];
    for (const f of redefinidas) {
      if (novas.includes(f)) expect(RB).toContain(`DROP FUNCTION IF EXISTS public.${f}(`);
      else expect(RB).toContain(`CREATE OR REPLACE FUNCTION public.${f}(`);
    }
    expect(RB).toContain("DROP COLUMN IF EXISTS ficha");
  });
});
