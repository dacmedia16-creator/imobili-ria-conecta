// Locação "Sem administração" (t_ec2962bd, pedido de Denis 20/11/2026): casa cobra 1 aluguel (100% do 1º aluguel);
// a divisão da comissão é a mesma (coordenador, corretor, parceria ÷ 2). Sem contrato/repasse/taxa no Financeiro.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modeloPadrao } from "./locacao-modelos";
import { textoTesteModelo } from "./locacao-modelos-preview";
import {
  CONFIG_PADRAO,
  PCT_SEM_ADMINISTRACAO,
  TEXTO_SEM_ADMINISTRACAO,
  calcularComissao,
  lerLancamentoResumo,
  lerLocacao,
  textoAdministracao,
  valoresParaComissao,
} from "./locacao";
import {
  CAMPOS_ADMINISTRACAO,
  camposIniciais,
  gerarPdfContrato,
  modeloDaMontagem,
  type LocacaoBase,
  type Montagem,
} from "./locacao-montagem";
import {
  faltasLancamento,
  lancamentoParaBanco,
  lerLancamentoCompleto,
  type LancamentoValores,
} from "@/components/locacao/LocacaoLancamento";

const MIG = readFileSync(
  "supabase/migrations/20261215120000_locacao_sem_administracao.sql",
  "utf8",
);
const RB = readFileSync("supabase/rollback/20261215120000_locacao_sem_administracao.sql", "utf8");

describe("comissão sem administração (1 aluguel, mesma divisão)", () => {
  it("R$ 2.000 com administração 10% → 50% = R$ 1.000; coord. R$ 100; corretor R$ 900", () => {
    expect(
      calcularComissao({ aluguel: 2000, taxaAdm: 10, parceria: false }, CONFIG_PADRAO),
    ).toEqual({
      pct: 50,
      base: 2000,
      totalLado: 1000,
      coordenador: 100,
      corretor: 900,
      parceiro: 0,
    });
  });
  it("R$ 2.000 sem administração → 100% = R$ 2.000; coord. R$ 200; corretor R$ 1.800", () => {
    expect(PCT_SEM_ADMINISTRACAO).toBe(100);
    expect(
      calcularComissao(
        { aluguel: 2000, taxaAdm: 0, semAdministracao: true, parceria: false },
        CONFIG_PADRAO,
      ),
    ).toEqual({
      pct: 100,
      base: 2000,
      totalLado: 2000,
      coordenador: 200,
      corretor: 1800,
      parceiro: 0,
    });
  });
  it("sem administração com parceria: aluguel ÷ 2 × 100% para cada lado", () => {
    expect(
      calcularComissao(
        { aluguel: 2000, taxaAdm: 0, semAdministracao: true, parceria: true },
        CONFIG_PADRAO,
      ),
    ).toEqual({
      pct: 100,
      base: 1000,
      totalLado: 1000,
      coordenador: 100,
      corretor: 900,
      parceiro: 1000,
    });
  });
  it("sem administração ignora a tabela de taxas (taxa 0 nunca vira 0% nem 10%)", () => {
    const cfg = { ...CONFIG_PADRAO, tabelaTaxa: { "0": 0, "10": 50 } };
    expect(
      calcularComissao({ aluguel: 2000, taxaAdm: 0, semAdministracao: true, parceria: false }, cfg)
        .pct,
    ).toBe(100);
  });
});

describe("leitura: o zero não vira mais 10%", () => {
  it("locação sem administração lê taxa 0 e a flag; com administração mantém o padrão antigo", () => {
    expect(lerLocacao({ taxa_adm: 0, sem_administracao: true })).toMatchObject({
      taxaAdm: 0,
      semAdministracao: true,
    });
    expect(lerLocacao({ taxa_adm: 8 })).toMatchObject({ taxaAdm: 8, semAdministracao: false });
    expect(lerLocacao({})).toMatchObject({ taxaAdm: 10, semAdministracao: false });
  });
  it("lançamento resumido sem administração é válido (antes era descartado por taxa 0)", () => {
    expect(lerLancamentoResumo({ aluguel: 2000, taxa_adm: 0, sem_administracao: true })).toEqual({
      aluguel: 2000,
      taxaAdm: 0,
      semAdministracao: true,
      parceria: "nenhuma",
    });
    expect(lerLancamentoResumo({ aluguel: 2000, taxa_adm: 0 })).toBeNull();
  });
  it("lançamento substitui a pré-análise também na escolha com/sem administração", () => {
    const lancamento = lerLancamentoResumo({ aluguel: 2000, taxa_adm: 0, sem_administracao: true });
    const v = valoresParaComissao({ aluguel: 2000, taxaAdm: 10, parceria: false, lancamento });
    expect(v).toMatchObject({ semAdministracao: true, lancado: true });
    expect(calcularComissao(v, CONFIG_PADRAO).corretor).toBe(1800);
    const pre = valoresParaComissao({
      aluguel: 2000,
      taxaAdm: 0,
      semAdministracao: true,
      parceria: false,
      lancamento: null,
    });
    expect(pre).toMatchObject({ semAdministracao: true, lancado: false });
  });
  it("texto do detalhe", () => {
    expect(textoAdministracao({ semAdministracao: true, taxaAdm: 0 })).toBe(
      TEXTO_SEM_ADMINISTRACAO,
    );
    expect(TEXTO_SEM_ADMINISTRACAO).toBe("Sem administração (intermediação: 1 aluguel)");
    expect(textoAdministracao({ semAdministracao: false, taxaAdm: 8 })).toBe("Taxa adm. 8%");
  });
});

describe("lançamento da Fernanda aceita sem administração", () => {
  const v: LancamentoValores = {
    captadorId: "",
    locador: "",
    gestorId: "",
    teamLeaderId: "",
    aluguel: "2.000,00",
    taxaAdm: "",
    semAdministracao: true,
    parceria: "nenhuma",
    parceriaUnidade: "",
    parceriaCorretor: "",
    parceriaImobiliaria: "",
    parceriaLado: "",
    parceriaCreci: "",
    observacao: "",
  };
  it("não cobra a taxa e manda a flag ao banco", () => {
    expect(faltasLancamento(v)).toEqual([]);
    expect(lancamentoParaBanco(v)).toMatchObject({ sem_administracao: true, taxa_adm: null });
    expect(faltasLancamento({ ...v, semAdministracao: false })).toEqual(["taxa de administração"]);
  });
  it("lê a flag do banco; ao voltar para com administração, sugere 10", () => {
    const l = lerLancamentoCompleto({
      valores: { aluguel: 2000, taxa_adm: 0, sem_administracao: true },
    });
    expect(l.valores).toMatchObject({ semAdministracao: true, taxaAdm: "10" });
    expect(lerLancamentoCompleto({ valores: { taxa_adm: 8 } }).valores.semAdministracao).toBe(
      false,
    );
  });
});

describe("montagem do contrato sem a parte de administração", () => {
  const base: LocacaoBase = {
    codigo: "TESTE-001",
    endereco: "Rua Inventada, 1",
    aluguel: 2000,
    taxaAdm: 0,
    semAdministracao: true,
    tipo: "residencial",
    garantia: "fiador",
    ficha: { imovelId: "IM-EXEMPLO" },
  };
  const m: Montagem = {
    campos: { repasse_taxa: "10", repasse_tipo: "split" },
    contrato: {},
    administradora: {
      nome: "Imobiliária Exemplo",
      cnpj: "x",
      creci: "",
      cidade: "Cidade",
      uf: "XX",
    },
  };
  it("repasse e taxa ficam vazios (nem o que estava salvo antes volta)", () => {
    const c = camposIniciais(base, m);
    for (const k of CAMPOS_ADMINISTRACAO) expect(c[k]).toBe("");
  });
  it("com administração continua como antes (taxa da locação, salvo prevalece)", () => {
    const c = camposIniciais(
      { ...base, semAdministracao: false, taxaAdm: 8 },
      { ...m, campos: {} },
    );
    expect(c.repasse_taxa).toBe("8");
    expect(c.repasse_tipo).toBe("manual");
    expect(camposIniciais({ ...base, semAdministracao: false, taxaAdm: 8 }, m).repasse_taxa).toBe(
      "10",
    );
  });
});

describe("modelo só intermediação (parte 2, t_f76e8b36)", () => {
  const base: LocacaoBase = {
    codigo: "TESTE-002",
    endereco: "Rua Inventada, 2",
    aluguel: 2000,
    taxaAdm: 0,
    semAdministracao: true,
    tipo: "residencial",
    garantia: "fiador",
    ficha: { imovelId: "IM-EXEMPLO" },
  };
  const modelos = {
    fiador: { ...modeloPadrao("fiador"), versao: 0, padrao: true },
    fiador_intermediacao: { ...modeloPadrao("fiador_intermediacao"), versao: 0, padrao: true },
  };
  const m: Montagem = {
    campos: {},
    contrato: {},
    modelos,
    administradora: { nome: "Imobiliária Exemplo", cnpj: "x", creci: "", cidade: "Cidade", uf: "XX" },
  };
  it("sem administração usa a variante _intermediacao; com administração, o modelo atual", () => {
    expect(modeloDaMontagem(base, m, {})?.chave).toBe("fiador_intermediacao");
    expect(modeloDaMontagem({ ...base, semAdministracao: false, taxaAdm: 10 }, m, {})?.chave).toBe("fiador");
  });
  it("texto sai sem ADMINISTRADORA, boleto da imobiliária e repasse; numeração recomeça em sequência", async () => {
    const texto = textoTesteModelo(modeloPadrao("fiador_intermediacao"), "residencial");
    const junto = texto.join("\n");
    expect(junto).not.toMatch(/ADMINISTRADORA|boleto|repasse/i);
    const nums = [...junto.matchAll(/^Cláusula (\d+)º/gm)].map((x) => Number(x[1]));
    expect(nums.length).toBeGreaterThan(20);
    expect(nums).toEqual(nums.map((_, i) => i + 1));
    const fonte = readFileSync("src/assets/fonts/DejaVuSans.ttf");
    const negrito = readFileSync("src/assets/fonts/DejaVuSans-Bold.ttf");
    const logo = readFileSync("public/remax-logo-transparent.png");
    const bytes = await gerarPdfContrato(texto, fonte, { negrito, logo });
    expect(bytes.byteLength).toBeGreaterThan(10000);
    if (process.env.EXEMPLO_PDF_PATH) writeFileSync(process.env.EXEMPLO_PDF_PATH, bytes);
  });
  it("parte 3 (t_1574da63): pagamento direto ao LOCADOR e fiador p008/p010 de volta sem a ADMINISTRADORA", () => {
    const junto = textoTesteModelo(modeloPadrao("fiador_intermediacao"), "residencial").join("\n");
    expect(junto).toMatch(
      /^Cláusula 4º - O pagamento dos aluguéis e encargos locatícios será feito diretamente à LOCADORA, na forma e na conta indicadas por escrito pela LOCADORA\.$/m,
    );
    expect(junto).toContain("respondendo até a efetiva devolução das chaves à LOCADORA, observados");
    expect(junto).toContain("MATRÍCULA FICTÍCIA");
    expect(junto).toContain("compromete-se a comunicar por escrito à LOCADORA eventual alienação");
  });
  it("os 8 modelos têm exatamente 1 texto novo (pag_locador) e nenhuma menção editável à administradora", () => {
    for (const chave of [
      "fiador",
      "caucao_dinheiro",
      "caucao_imovel",
      "seguro_porto",
      "seguro_pottencial",
      "seguro_tokio",
      "seguro_almada",
      "loft",
    ] as const) {
      const m = modeloPadrao(`${chave}_intermediacao`);
      expect(m.paragrafos.filter((p) => p.id === "pag_locador")).toHaveLength(1);
      const editaveis = m.paragrafos.filter((p) => !p.trava).map((p) => p.t);
      expect(editaveis.join("\n")).not.toMatch(/ADMINISTRADORA|boleto|repasse|imobili/i);
    }
  });
});

describe("migration e rollback", () => {
  it("padrão com administração; sem administração = taxa 0 explícita", () => {
    expect(MIG).toContain("ADD COLUMN sem_administracao boolean NOT NULL DEFAULT false");
    expect(MIG).toContain(
      "(sem_administracao AND taxa_adm = 0) OR (NOT sem_administracao AND taxa_adm > 0 AND taxa_adm <= 30)",
    );
    expect(MIG).toContain("IF _l.sem_administracao THEN RETURN NULL; END IF;");
  });
  it("rollback devolve as 5 funções e o CHECK antigo", () => {
    expect((RB.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(5);
    expect(RB).toContain("DROP COLUMN sem_administracao");
    expect(RB).toContain("CHECK (taxa_adm > 0 AND taxa_adm <= 30)");
  });
});
