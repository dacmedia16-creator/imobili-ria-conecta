// Locação "Sem administração" (t_ec2962bd, pedido de Denis 20/11/2026): casa cobra 1 aluguel (100% do 1º aluguel);
// a divisão da comissão é a mesma (coordenador, corretor, parceria ÷ 2). Sem contrato/repasse/taxa no Financeiro.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
  "supabase/migrations/20261211120000_locacao_sem_administracao.sql",
  "utf8",
);
const RB = readFileSync("supabase/rollback/20261211120000_locacao_sem_administracao.sql", "utf8");

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
