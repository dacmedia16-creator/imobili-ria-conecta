// Ficha de moradores + pacote para a administradora (t_40cff7e4). Regras puras e espelho com a migration 20261215120000.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  errosLista,
  errosMorador,
  itemRgMorador,
  lerMoradoresRpc,
  moradorAdulto,
  textoMoradores,
  type Morador,
} from "@/lib/locacao-moradores";
import { tipoDoItem, itemLidoPorIa } from "@/lib/locacao-ia";
import { montarPacotePdf, nomeArquivoPacote, tipoArquivo } from "@/lib/locacao-pacote-pdf";

const MIG = readFileSync("supabase/migrations/20261215120000_locacao_moradores_pacote.sql", "utf8");
const RB = readFileSync("supabase/rollback/20261215120000_locacao_moradores_pacote.sql", "utf8");

const m = (x: Partial<Morador>): Morador => ({
  id: "6f1b7c1e-0000-4000-8000-000000000001",
  nome: "Ana Fictícia",
  cpf: "529.982.247-25",
  nascimento: "1990-05-10",
  email: "ana@exemplo.com",
  telefone: "(15) 99999-0000",
  ...x,
});

describe("maior de 18 pela data de nascimento", () => {
  it("completa 18 no dia do aniversário (exige RG); um dia antes não", () => {
    expect(moradorAdulto("2008-11-20", "2026-11-20")).toBe(true);
    expect(moradorAdulto("2008-11-21", "2026-11-20")).toBe(false);
  });
  it("criança e data inválida não exigem RG", () => {
    expect(moradorAdulto("2015-01-01", "2026-11-20")).toBe(false);
    expect(moradorAdulto("", "2026-11-20")).toBe(false);
    expect(moradorAdulto("20/11/2008", "2026-11-20")).toBe(false);
  });
  it("nascido em 29/02 completa 18 em 01/03 do ano não bissexto (igual ao Postgres)", () => {
    // '2026-02-28'::date - interval '18 years' = 2008-02-28 → 29/02/2008 ainda não; 01/03 já.
    expect(moradorAdulto("2008-02-29", "2026-02-28")).toBe(false);
    expect(moradorAdulto("2008-02-29", "2026-03-01")).toBe(true);
    // Hoje 29/02 (bissexto) e 18 anos antes não bissexto: o limite vira 28/02.
    expect(moradorAdulto("2010-02-28", "2028-02-29")).toBe(true);
    expect(moradorAdulto("2010-03-01", "2028-02-29")).toBe(false);
  });
  it("banco usa a mesma regra (18 anos, data de São Paulo)", () => {
    expect(MIG).toContain("- interval '18 years'");
    expect(MIG).toContain("AT TIME ZONE 'America/Sao_Paulo'");
  });
});

describe("contrato continua com o mesmo texto de antes", () => {
  it("nome — CPF, um por linha, a partir da ficha", () => {
    const t = textoMoradores([
      m({ nome: " Ana Fictícia " }),
      m({ id: "x", nome: "Bia Fictícia", cpf: "111.444.777-35", nascimento: "2015-03-03" }),
    ]);
    expect(t).toBe("Ana Fictícia — CPF 529.982.247-25\nBia Fictícia — CPF 111.444.777-35");
    // Mesmo formato do exemplo da tela antiga ("Ana Exemplo — CPF 000.000.000-00").
    expect(t.split("\n")[0]).toMatch(/^.+ — CPF \d{3}\.\d{3}\.\d{3}-\d{2}$/);
  });
  it('banco gera o mesmo texto e grava no mesmo campo "moradores" do contrato', () => {
    expect(MIG).toContain("btrim(p->>'nome') || ' — CPF ' || btrim(p->>'cpf'), chr(10)");
    expect(MIG).toContain("jsonb_build_object('moradores', _txt)");
  });
});

describe("item do RG", () => {
  it('"Cópia do RG — <nome>" igual no front e no banco', () => {
    expect(itemRgMorador(" Ana Fictícia ")).toBe("Cópia do RG — Ana Fictícia");
    expect(MIG).toContain("SELECT 'Cópia do RG — ' || btrim(_nome)");
  });
  it("só adultos geram item e o item entra na parte do locatário", () => {
    expect(MIG).toContain("AND public.locacao_morador_adulto(p->>'nascimento')");
    expect(MIG).toMatch(/WHEN p\.parte = 'locatario' THEN public\.locacao_morador_itens\(_l\)/);
  });
  it("IA não lê o RG do morador (não confunde com o locatário)", () => {
    expect(tipoDoItem("Cópia do RG — Ana Fictícia")).toBe("outro");
    expect(itemLidoPorIa("Cópia do RG — Ana Fictícia")).toBe(false);
    expect(tipoDoItem("RG/CNH do locatário")).toBe("identidade");
  });
});

describe("validação da ficha", () => {
  const hoje = "2026-11-20";
  it("adulto exige CPF válido, e-mail e telefone", () => {
    expect(errosMorador(m({}), hoje)).toEqual([]);
    expect(errosMorador(m({ cpf: "111.111.111-11" }), hoje)).toContain("CPF válido");
    expect(errosMorador(m({ email: "" }), hoje)).toContain("e-mail");
    expect(errosMorador(m({ telefone: "" }), hoje)).toContain("telefone com DDD");
  });
  it("menor pode ficar sem e-mail e telefone", () => {
    expect(errosMorador(m({ nascimento: "2016-01-01", email: "", telefone: "" }), hoje)).toEqual(
      [],
    );
  });
  it("nascimento no futuro ou vazio é recusado", () => {
    expect(errosMorador(m({ nascimento: "2027-01-01" }), hoje)).toContain("data de nascimento");
    expect(errosMorador(m({ nascimento: "" }), hoje)).toContain("data de nascimento");
  });
  it("morador repetido (nome ou CPF) é recusado", () => {
    expect(errosLista([m({}), m({ id: "b", nome: "Outra Pessoa" })])).toContain(
      "morador repetido (mesmo nome ou CPF)",
    );
  });
});

describe("leitura da RPC", () => {
  it("lê pessoas e downloads com tolerância a campos faltando", () => {
    const r = lerMoradoresRpc({
      ficha: true,
      obrigatoria: true,
      pessoas: [{ nome: "A" }],
      downloads: [{ em: "x" }],
    });
    expect(r.pessoas[0]).toEqual({
      id: "",
      nome: "A",
      cpf: "",
      nascimento: "",
      email: "",
      telefone: "",
    });
    expect(r.downloads[0]).toEqual({ em: "x", por: null });
    expect(lerMoradoresRpc(null).pessoas).toEqual([]);
  });
});

describe("segurança no banco (texto da migration)", () => {
  it("tabelas sem acesso direto do navegador, só por RPC", () => {
    expect(MIG).toContain(
      "REVOKE ALL ON public.locacao_moradores, public.locacao_pacote_downloads FROM PUBLIC, anon, authenticated;",
    );
    expect(MIG).toContain("ALTER TABLE public.locacao_moradores ENABLE ROW LEVEL SECURITY;");
  });
  it("ficha e pacote só para corretor da locação, gerência ou gestora, dentro da imobiliária", () => {
    expect(MIG).toMatch(
      /_l\.organization_id = public\.current_org_id\(\)[\s\S]*_l\.corretor_id = auth\.uid\(\) OR public\.locacao_eh_gerencia/,
    );
    expect(MIG).toContain("p.papel = 'gestora'");
  });
  it("pacote só para condomínio e registra quem baixou", () => {
    expect(MIG).toContain("Pacote só para imóvel de condomínio.");
    expect(MIG).toContain(
      "INSERT INTO public.locacao_pacote_downloads (locacao_id, organization_id, baixado_por)",
    );
  });
  it("locações antigas não são atualizadas (padrão false nas existentes, true nas novas)", () => {
    expect(MIG).toContain("ADD COLUMN moradores_ficha boolean NOT NULL DEFAULT false");
    expect(MIG).toContain("ALTER COLUMN moradores_ficha SET DEFAULT true");
    expect(MIG).not.toMatch(/UPDATE public\.locacoes /);
  });
  it("rollback volta as 3 funções e tira tudo o que foi criado", () => {
    expect((RB.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(3);
    for (const f of ["locacao_checklist_l", "locacao_partes_json", "locacao_contrato_salvar"])
      expect(RB).toContain(`FUNCTION public.${f}(`);
    expect(RB).toContain("COLUMN moradores_ficha");
    expect(RB).toContain("TABLE public.locacao_moradores");
  });
});

describe("PDF do pacote", () => {
  const dados = {
    codigo: "LOC-0042",
    locatario: {
      nome: "Locatário Fictício",
      cpf: "529.982.247-25",
      nascimento: "1985-02-01",
      email: "loc@exemplo.com",
      telefone: "(15) 98888-0000",
    },
    moradores: [
      m({}),
      m({
        id: "b",
        nome: "Criança Fictícia",
        cpf: "111.444.777-35",
        nascimento: "2016-04-04",
        email: "",
        telefone: "",
      }),
    ],
    endereco: "Rua Fictícia, 100 — Sorocaba",
    unidade: "Bloco B, apto 34",
    entrada: "2026-12-01",
  };
  it("gera um PDF com os dados e uma página por RG em imagem", async () => {
    const { PDFDocument } = await import("pdf-lib");
    // RG fictício em PDF de 1 página.
    const rg = await PDFDocument.create();
    rg.addPage([300, 200]);
    const bytes = await rg.save();
    expect(tipoArquivo(bytes)).toBe("pdf");
    const out = await montarPacotePdf(
      dados,
      [{ item: itemRgMorador("Ana Fictícia"), bytes, tipo: "pdf" }],
      "2026-11-20",
      "Corretor Teste",
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2); // 1 de dados + 1 do RG
    expect(doc.getTitle()).toContain("LOC-0042");
  });
  it("nome do arquivo e tipo pelo conteúdo", () => {
    expect(nomeArquivoPacote("LOC-0042")).toBe("pacote-administradora-LOC-0042.pdf");
    expect(tipoArquivo(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("jpg");
    expect(tipoArquivo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("png");
    expect(tipoArquivo(new Uint8Array([1, 2, 3, 4]))).toBe("outro");
  });
});
