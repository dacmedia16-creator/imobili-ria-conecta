// Ficha de moradores + pacote para a administradora (t_40cff7e4). Regras puras e espelho com a migration 20261216120000.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ehItemRgMorador,
  errosLista,
  errosMorador,
  itemRgMorador,
  lerMoradoresRpc,
  mascaraCpf,
  moradorAdulto,
  textoMoradores,
  type Morador,
} from "@/lib/locacao-moradores";
import { tipoDoItem, itemLidoPorIa } from "@/lib/locacao-ia";
import {
  AVISO_RG_FORA,
  PACOTE_MAX_BYTES,
  montarPacotePdf,
  nomeArquivoPacote,
  tipoArquivo,
} from "@/lib/locacao-pacote-pdf";

const MIG = readFileSync("supabase/migrations/20261216120000_locacao_moradores_pacote.sql", "utf8");
const RB = readFileSync("supabase/rollback/20261216120000_locacao_moradores_pacote.sql", "utf8");

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
    expect(MIG).toContain("coalesce(m.referencia, public.locacao_hoje_sp())");
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
  it("CPF sempre com máscara no contrato, mesmo digitado sem pontos", () => {
    expect(mascaraCpf("52998224725")).toBe("529.982.247-25");
    expect(mascaraCpf(" 529.982.247-25 ")).toBe("529.982.247-25");
    expect(textoMoradores([m({ cpf: "52998224725" })])).toBe("Ana Fictícia — CPF 529.982.247-25");
    expect(MIG).toContain("'cpf', public.locacao_cpf_mascara(p->>'cpf')");
  });
  it('banco gera o mesmo texto e grava no mesmo campo "moradores" do contrato', () => {
    expect(MIG).toContain(
      "btrim(p->>'nome') || ' — CPF ' || public.locacao_cpf_mascara(p->>'cpf'), chr(10)",
    );
    expect(MIG).toContain("jsonb_build_object('moradores', _txt)");
  });
});

describe("item do RG", () => {
  it('"Cópia do RG — <nome>" igual no front e no banco', () => {
    expect(itemRgMorador(" Ana Fictícia ")).toBe("Cópia do RG — Ana Fictícia");
    expect(MIG).toContain("SELECT 'Cópia do RG — ' || btrim(_nome)");
  });
  it("só adultos geram item e o item entra na parte do locatário", () => {
    expect(MIG).toContain(
      "AND public.locacao_morador_adulto(p->>'nascimento', coalesce(m.referencia",
    );
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
  it("RG do morador escondido de quem vê a locação mas não é da gestão (lista, histórico e link)", () => {
    expect(MIG).toContain("_rg := public.locacao_morador_pode(_l);");
    expect(MIG).toContain("AND (_rg OR NOT public.locacao_eh_rg_morador(d.item))");
    expect(MIG).toContain("AND (_rg OR position('Cópia do RG — ' IN e.descricao) = 0)");
    expect(MIG).toContain(
      "OR (public.locacao_eh_rg_morador(_d.item) AND NOT public.locacao_morador_pode(_l)) THEN",
    );
    expect(ehItemRgMorador("Cópia do RG — Ana")).toBe(true);
    expect(ehItemRgMorador("RG/CNH do locatário")).toBe(false);
  });
  it("idade congelada ao sair da Documentação (aniversário depois não trava a minuta)", () => {
    expect(MIG).toContain(
      "CREATE TRIGGER locacao_zz_moradores_ref AFTER UPDATE OF etapa ON public.locacoes",
    );
    expect(lerMoradoresRpc({ referencia: "2026-11-01", congelada: true })).toMatchObject({
      referencia: "2026-11-01",
      congelada: true,
    });
    expect(lerMoradoresRpc({ referencia: "lixo" }).referencia).toBe("");
  });
  it("trocar nome ou CPF com RG anexado exige remover o RG antes", () => {
    expect(MIG).toContain("Remova a cópia do RG de % antes de trocar o nome ou o CPF");
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
  it("rollback volta as 5 funções e tira tudo o que foi criado", () => {
    expect((RB.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(5);
    for (const f of [
      "locacao_checklist_l",
      "locacao_partes_json",
      "locacao_contrato_salvar",
      "locacao_detalhe",
      "locacao_documento_ver",
    ])
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
  it("RG em WEBP, PDF protegido ou danificado não derruba o pacote: entra um aviso", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const quebrado = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00]);
    const jpgRuim = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]);
    const out = await montarPacotePdf(
      dados,
      [
        { item: itemRgMorador("Ana Fictícia"), bytes: webp, tipo: tipoArquivo(webp) },
        { item: "Cópia do RG — Outra", bytes: quebrado, tipo: tipoArquivo(quebrado) },
        { item: "Cópia do RG — Terceira", bytes: jpgRuim, tipo: tipoArquivo(jpgRuim) },
      ],
      "2026-11-20",
      "Corretor Teste",
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4); // 1 de dados + 1 aviso por cópia que não entrou
    expect(AVISO_RG_FORA).toMatch(/não entrou no pacote/);
  });
  it("limite de tamanho do pacote", () => {
    expect(PACOTE_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
  it("menor pela data congelada continua menor no PDF", async () => {
    const out = await montarPacotePdf(
      { ...dados, moradores: [m({ nascimento: "2008-11-20" })], referencia: "2026-11-19" },
      [],
      "2026-11-20",
      "Corretor Teste",
    );
    expect(out.byteLength).toBeGreaterThan(0);
    expect(moradorAdulto("2008-11-20", "2026-11-19")).toBe(false);
  });
  it("nome do arquivo e tipo pelo conteúdo", () => {
    expect(nomeArquivoPacote("LOC-0042")).toBe("pacote-administradora-LOC-0042.pdf");
    expect(tipoArquivo(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("jpg");
    expect(tipoArquivo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("png");
    expect(tipoArquivo(new Uint8Array([1, 2, 3, 4]))).toBe("outro");
  });
});
