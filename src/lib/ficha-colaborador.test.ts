import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  NAO_INFORMADO,
  TODOS,
  camposFichaFaltando,
  descreverFiltros,
  faixaFilhos,
  filtrarColaboradores,
  filtrosVazios,
  formDaSituacao,
  formVazio,
  inputSpParaIso,
  isoParaInputSp,
  linhaExport,
  mensagemErroFicha,
  mesDaData,
  mesNoPeriodo,
  modoFicha,
  paramsSalvarFicha,
  type Colaborador,
  type FichaForm,
  type SituacaoFicha,
} from "./ficha-colaborador";
import { gerarXlsx } from "./xlsx-simples";
import { buildFichasPdf } from "./ficha-colaborador-pdf";

type SituacaoAplica = Extract<SituacaoFicha, { aplica: true }>;
const pendente = (bloqueia: boolean): SituacaoAplica => ({
  aplica: true,
  completa: false,
  bloqueia,
  obrigatoria_a_partir_de: "2026-10-30T04:30:00+00:00",
  data_nascimento: null,
  ficha: null,
});

describe("porteiro da ficha: os dois estados do prazo (decididos pelo banco)", () => {
  it("ANTES do prazo: aparece com 'Preencher depois' (lembrete)", () => {
    expect(modoFicha(pendente(false), false)).toBe("lembrete");
  });
  it("ANTES do prazo e já adiada neste login: não aparece de novo", () => {
    expect(modoFicha(pendente(false), true)).toBeNull();
  });
  it("DEPOIS do prazo: bloqueia, mesmo que tenha clicado 'Preencher depois' antes", () => {
    expect(modoFicha(pendente(true), false)).toBe("bloqueio");
    expect(modoFicha(pendente(true), true)).toBe("bloqueio");
  });
  it("ficha completa nunca aparece; sem aplicação (plataforma/Entrar como) nunca aparece", () => {
    expect(modoFicha({ ...pendente(true), completa: true }, false)).toBeNull();
    expect(modoFicha({ aplica: false, motivo: "sessao_restrita" }, false)).toBeNull();
    expect(modoFicha(null, false)).toBeNull();
  });
  it("o porteiro não usa o relógio do navegador (só o 'bloqueia' do banco)", () => {
    const src = readFileSync(
      new URL("../components/ficha/FichaColaboradorGate.tsx", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/Date\.now|new Date\(/);
    expect(src).toContain("Preencher depois");
    expect(src).toContain("Sair");
    expect(src).toMatch(/!bloqueio && \(/); // "Preencher depois" só fora do bloqueio
  });
  it("porteiro fica dentro de /_authenticated (login, troca de senha e convite não passam por ele)", () => {
    const rota = readFileSync(
      new URL("../routes/_authenticated/route.tsx", import.meta.url),
      "utf8",
    );
    expect(rota).toContain("<FichaColaboradorGate>");
    const trocar = readFileSync(new URL("../routes/trocar-senha.tsx", import.meta.url), "utf8");
    expect(trocar).not.toContain("FichaColaboradorGate");
  });
});

const valido = (): FichaForm => ({
  data_nascimento: "1990-05-17",
  qtd_filhos: "0",
  filhos_faixas: [],
  tem_plano_saude: "nao",
  plano_saude: "",
  emergencia_nome: "Maria Exemplo",
  emergencia_parentesco: "Mãe",
  emergencia_telefone: "(15) 99123-4567",
  hospital_preferencia: "Hospital Exemplo",
  religiao: "",
  ciente: true,
});
const nasc = (d: string) => (d ? null : "obrigatória");

describe("validação do formulário (mesmas regras do banco)", () => {
  it("0 filhos e sem religião é válido", () => {
    expect(camposFichaFaltando(valido(), nasc)).toEqual([]);
  });
  it("todos obrigatórios menos religião", () => {
    const falta = camposFichaFaltando({ ...formVazio() }, nasc);
    expect(falta).toEqual(
      expect.arrayContaining([
        "data_nascimento",
        "qtd_filhos",
        "tem_plano_saude",
        "emergencia_nome",
        "emergencia_parentesco",
        "emergencia_telefone",
        "hospital_preferencia",
        "ciente",
      ]),
    );
    expect(falta).not.toContain("religiao");
    expect(falta).not.toContain("plano_saude");
  });
  it("'qual plano' só é obrigatório quando tem plano", () => {
    expect(camposFichaFaltando({ ...valido(), tem_plano_saude: "sim" }, nasc)).toEqual([
      "plano_saude",
    ]);
    expect(
      camposFichaFaltando({ ...valido(), tem_plano_saude: "sim", plano_saude: "Unimed" }, nasc),
    ).toEqual([]);
  });
  it("telefone de emergência precisa de DDD", () => {
    expect(camposFichaFaltando({ ...valido(), emergencia_telefone: "99123-4567" }, nasc)).toEqual([
      "emergencia_telefone",
    ]);
  });
  it("parâmetros da RPC: sem plano manda null no 'qual'; religião vazia vira null", () => {
    const p = paramsSalvarFicha({ ...valido(), plano_saude: "sobrou" });
    expect(p._plano_saude).toBeNull();
    expect(p._religiao).toBeNull();
    expect(p._qtd_filhos).toBe(0);
    expect(p._ciente).toBe(true);
  });
  it("formulário a partir da ficha salva (Meu acesso)", () => {
    const f = formDaSituacao({
      ...pendente(false),
      completa: true,
      data_nascimento: "1990-05-17",
      ficha: {
        qtd_filhos: 2,
        tem_plano_saude: true,
        plano_saude: "Unimed",
        emergencia_nome: "Maria",
        emergencia_parentesco: "Mãe",
        emergencia_telefone: "15991234567",
        hospital_preferencia: "Hosp",
        religiao: null,
        aceite_em: "2026-10-29T10:00:00Z",
      },
    });
    expect(f).toMatchObject({
      qtd_filhos: "2",
      tem_plano_saude: "sim",
      religiao: "",
      ciente: true,
    });
  });
  it("mensagens do banco viram texto amigável", () => {
    expect(
      mensagemErroFicha({ code: "22023", message: "Informe qual e o plano de saude" }),
    ).toMatch(/qual é o plano/);
    expect(mensagemErroFicha({ code: "42501", message: "x" })).toMatch(/permissão/);
  });
});

const colab = (o: Partial<Colaborador>): Colaborador => ({
  user_id: "u",
  nome: "Fulano",
  email: "f@x.test",
  telefone: null,
  papeis: ["corretor"],
  equipes: [],
  data_nascimento: null,
  completa: false,
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

const LISTA = [
  colab({
    user_id: "1",
    nome: "Ana",
    data_nascimento: "1990-01-10",
    completa: true,
    qtd_filhos: 0,
    tem_plano_saude: true,
    plano_saude: "Unimed",
    religiao: "Católica",
    hospital_preferencia: "Santa Casa",
    equipes: ["Azul"],
  }),
  colab({
    user_id: "2",
    nome: "Bia",
    data_nascimento: "1985-11-03",
    completa: true,
    qtd_filhos: 4,
    tem_plano_saude: false,
    hospital_preferencia: "santa casa",
    papeis: ["staff"],
  }),
  colab({ user_id: "3", nome: "Caio", data_nascimento: "1992-06-20" }),
  colab({ user_id: "4", nome: "Duda", papeis: ["gestor"], equipes: ["Azul"] }),
];

describe("filtros da tela do staff", () => {
  const nomes = (f: Partial<ReturnType<typeof filtrosVazios>>) =>
    filtrarColaboradores(LISTA, { ...filtrosVazios(), ...f }).map((c) => c.nome);
  it("aniversário por mês e por período que vira o ano (nov→jan)", () => {
    expect(nomes({ mesDe: 6, mesAte: 6 })).toEqual(["Caio"]);
    expect(nomes({ mesDe: 11, mesAte: 1 })).toEqual(["Ana", "Bia"]);
    expect(mesNoPeriodo(12, 11, 2)).toBe(true);
    expect(mesNoPeriodo(5, 11, 2)).toBe(false);
    expect(mesDaData("1990-01-10")).toBe(1);
  });
  it("plano, qual plano, filhos, religião, hospital (sem diferenciar acento/maiúscula)", () => {
    expect(nomes({ temPlano: "sim" })).toEqual(["Ana"]);
    expect(nomes({ temPlano: "nao" })).toEqual(["Bia"]);
    expect(nomes({ plano: "unimed" })).toEqual(["Ana"]);
    expect(nomes({ filhos: "3+" })).toEqual(["Bia"]);
    expect(nomes({ filhos: NAO_INFORMADO })).toEqual(["Caio", "Duda"]);
    expect(nomes({ religiao: "catolica" })).toEqual(["Ana"]);
    expect(nomes({ religiao: NAO_INFORMADO })).toEqual(["Bia", "Caio", "Duda"]);
    expect(nomes({ hospital: "Santa Casa" })).toEqual(["Ana", "Bia"]);
    expect(faixaFilhos(2)).toBe("2");
  });
  it("completa/pendente, papel e equipe", () => {
    expect(nomes({ situacao: "pendente" })).toEqual(["Caio", "Duda"]);
    expect(nomes({ papel: "staff" })).toEqual(["Bia"]);
    expect(nomes({ equipe: "Azul" })).toEqual(["Ana", "Duda"]);
    expect(nomes({ papel: TODOS })).toHaveLength(4);
  });
  it("descrição do filtro para o PDF", () => {
    expect(
      descreverFiltros({ ...filtrosVazios(), mesDe: 11, mesAte: 1, situacao: "pendente" }, {}),
    ).toBe("Aniversário de Novembro a Janeiro · Fichas pendentes");
    expect(descreverFiltros(filtrosVazios(), {})).toMatch(/Sem filtros/);
  });
  it("prazo no fuso de São Paulo (ida e volta)", () => {
    expect(isoParaInputSp("2026-10-30T04:30:00+00:00")).toBe("2026-10-30T01:30");
    expect(inputSpParaIso("2026-10-30T01:30")).toBe("2026-10-30T01:30:00-03:00");
    expect(inputSpParaIso("lixo")).toBeNull();
  });
});

describe("exportação", () => {
  it("Excel: arquivo .xlsx (ZIP) com as linhas e caracteres escapados", () => {
    const linhas = LISTA.map((c) => linhaExport(c, { corretor: "Corretor" }));
    linhas[0][0] = 'Ana <&> "teste"';
    const bytes = gerarXlsx(
      "Colaboradores",
      ["Nome", "E-mail"],
      linhas.map((l) => l.slice(0, 2)),
    );
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const texto = new TextDecoder().decode(bytes);
    expect(texto).toContain("xl/worksheets/sheet1.xml");
    expect(texto).toContain("Ana &lt;&amp;&gt; &quot;teste&quot;");
    expect(texto).toContain("Bia");
  });
  it("PDF: gera com várias páginas quando a lista é grande", async () => {
    const muitos = Array.from({ length: 60 }, (_, i) =>
      colab({
        user_id: String(i),
        nome: `Pessoa ${i}`,
        completa: i % 2 === 0,
        emergencia_nome: "Contato",
        hospital_preferencia: "Hospital",
      }),
    );
    const bytes = await buildFichasPdf({
      colaboradores: muitos,
      totalImobiliaria: 60,
      filtros: "Sem filtros",
      roleLabels: { corretor: "Corretor" },
      agencyName: "Imobiliária Exemplo",
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});

describe("migration da ficha (contrato de segurança)", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20261029130000_ficha_colaborador.sql", import.meta.url),
    "utf8",
  );
  it("tabela separada do profile, RLS ligada e sem acesso direto", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.colaborador_fichas/);
    expect(sql).toMatch(/ALTER TABLE public\.colaborador_fichas ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(
      /REVOKE ALL ON public\.colaborador_fichas FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).not.toMatch(/GRANT [A-Z, ]+ ON public\.colaborador_fichas/);
  });
  it("só staff/admin/administrador principal leem a lista; nunca na visão da plataforma ou 'Entrar como'", () => {
    expect(sql).toContain("ARRAY['staff', 'admin', 'super_admin']");
    expect(sql).toContain("operational_impersonation_sessions");
    expect(sql).toContain("mt_pc_in_context()");
  });
  it("prazo padrão 30/10/2026 01:30 São Paulo e comparado com now() do banco", () => {
    expect(sql).toContain("timestamptz '2026-10-30 01:30:00 America/Sao_Paulo'");
    expect(sql).toContain("'bloqueia', NOT _completa AND now() >= _desde");
  });
  it("log de exportação sem dados pessoais", () => {
    expect(sql).toContain("jsonb_build_object('formato', _formato, 'total', _total)");
  });
  it("rollback existe", () => {
    const rb = readFileSync(
      new URL(
        "../../docs/sql/rollback/20261029130000_ficha_colaborador.rollback.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(rb).toContain("DROP TABLE IF EXISTS public.colaborador_fichas");
    // A data de nascimento já existia antes: o rollback não pode apagá-la.
    expect(rb).not.toContain("DROP TABLE IF EXISTS public.profile_birthdates");
  });
});
