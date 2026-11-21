// Dados de pagamento do parceiro na parceria da locação (t_756c1c63). Parte pura + conferência do texto da migration.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIG_PADRAO, calcularComissao } from "./locacao";
import {
  PAGAMENTO_VAZIO,
  cnpjValido,
  documentoTela,
  faltasPagamento,
  lerParceirosPagar,
  lerPagamento,
  pagamentoParaBanco,
  valorParceiro,
} from "./locacao-parceiro";
import {
  faltasLancamento,
  lancamentoParaBanco,
  lerLancamentoCompleto,
  type LancamentoValores,
} from "@/components/locacao/LocacaoLancamento";

const MIG = readFileSync(
  "supabase/migrations/20261214140000_locacao_parceiro_pagamento.sql",
  "utf8",
);
const RB = readFileSync("supabase/rollback/20261214140000_locacao_parceiro_pagamento.sql", "utf8");

const base: LancamentoValores = {
  captadorId: "u-casa",
  locador: "Dono",
  gestorId: "",
  teamLeaderId: "",
  aluguel: "3.000,00",
  taxaAdm: "10",
  parceria: "externa",
  parceriaUnidade: "",
  parceriaCorretor: "Corretor Parceiro",
  parceriaImobiliaria: "Imob Parceira",
  semAdministracao: false,
  parceriaLado: "",
  parceriaCreci: " 12345-F ",
  observacao: "",
};

describe("lançamento — lado do parceiro", () => {
  it("parceria exige o lado; sem parceria não", () => {
    expect(faltasLancamento(base)).toEqual(["lado do parceiro"]);
    expect(faltasLancamento({ ...base, parceriaLado: "locatario" })).toEqual([]);
    expect(faltasLancamento({ ...base, parceria: "nenhuma" })).toEqual([]);
    expect(faltasLancamento({ ...base, parceria: "remax", parceriaUnidade: "RE/MAX X" })).toEqual([
      "lado do parceiro",
    ]);
  });
  it("lado captador: o captador é o parceiro, não vai captador da casa", () => {
    const b = lancamentoParaBanco({ ...base, parceriaLado: "captador" });
    expect(b.captador_id).toBeNull();
    expect(b.parceria_lado).toBe("captador");
    expect(b.parceria_creci).toBe("12345-F");
    expect(b.parceria_corretor).toBe("Corretor Parceiro");
  });
  it("lado locatário mantém o captador da casa", () => {
    const b = lancamentoParaBanco({ ...base, parceriaLado: "locatario" });
    expect(b.captador_id).toBe("u-casa");
    expect(b.parceria_lado).toBe("locatario");
  });
  it("sem parceria não manda lado, CRECI nem corretor parceiro", () => {
    const b = lancamentoParaBanco({ ...base, parceria: "nenhuma", parceriaLado: "captador" });
    expect(b.captador_id).toBe("u-casa");
    expect(b.parceria_lado).toBeNull();
    expect(b.parceria_creci).toBeNull();
    expect(b.parceria_corretor).toBeNull();
  });
  it("lê lado e CRECI do banco; lado desconhecido vira vazio", () => {
    const l = lerLancamentoCompleto({
      valores: { parceria: "externa", parceria_lado: "captador", parceria_creci: "9" },
    });
    expect(l.valores.parceriaLado).toBe("captador");
    expect(l.valores.parceriaCreci).toBe("9");
    expect(lerLancamentoCompleto({ valores: { parceria_lado: "x" } }).valores.parceriaLado).toBe(
      "",
    );
  });
});

describe("dados de pagamento", () => {
  const cpf = {
    ...PAGAMENTO_VAZIO,
    favorecidoTipo: "corretor" as const,
    favorecidoNome: "Corretor Parceiro",
    documento: "529.982.247-25",
    pix: "parceiro@exemplo.com",
    emiteNf: "nao" as const,
  };
  it("corretor (CPF) com PIX: ok; dígito errado recusa", () => {
    expect(faltasPagamento(cpf)).toEqual([]);
    expect(faltasPagamento({ ...cpf, documento: "529.982.247-26" })).toEqual(["CPF válido"]);
  });
  it("imobiliária (CNPJ) com banco/agência/conta: ok; CPF no lugar do CNPJ recusa", () => {
    const cnpj = {
      ...cpf,
      favorecidoTipo: "imobiliaria" as const,
      documento: "11.222.333/0001-81",
      pix: "",
      banco: "Banco X",
      agencia: "0001",
      conta: "123-4",
    };
    expect(faltasPagamento(cnpj)).toEqual([]);
    expect(faltasPagamento({ ...cnpj, documento: "529.982.247-25" })).toEqual(["CNPJ válido"]);
    expect(faltasPagamento({ ...cnpj, conta: "" })).toEqual(["PIX ou banco, agência e conta"]);
  });
  it("CNPJ numérico e alfanumérico (Receita 07/2026), igual ao banco", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValido("12abc34501de35")).toBe(true);
    expect(cnpjValido("12.ABC.345/01DE-34")).toBe(false);
    expect(cnpjValido("AB11.222.333/0001-81")).toBe(false);
    expect(cnpjValido("11111111111111")).toBe(false);
    expect(cnpjValido("11.222.333/0001-8#")).toBe(false);
    expect(documentoTela("imobiliaria", "12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });
  it("vazio lista tudo, na ordem do banco", () => {
    expect(faltasPagamento(PAGAMENTO_VAZIO)).toEqual([
      "favorecido (imobiliária ou corretor)",
      "nome do favorecido",
      "PIX ou banco, agência e conta",
      "emite nota fiscal?",
    ]);
  });
  it("vai ao banco com emite_nf booleano e campos vazios como null", () => {
    const b = pagamentoParaBanco({ ...cpf, telefone: " ", emiteNf: "sim" });
    expect(b.emite_nf).toBe(true);
    expect(b.telefone).toBeNull();
    expect(b.documento).toBe("529.982.247-25");
  });
  it("lê do banco formatando CPF/CNPJ", () => {
    const p = lerPagamento({
      favorecido_tipo: "imobiliaria",
      documento: "11222333000181",
      emite_nf: false,
    });
    expect(p?.documento).toBe("11.222.333/0001-81");
    expect(p?.emiteNf).toBe("nao");
    expect(documentoTela("corretor", "52998224725")).toBe("529.982.247-25");
    expect(lerPagamento(null)).toBeNull();
  });
});

describe("Financeiro — valor do parceiro", () => {
  it("metade de 1 aluguel independente da taxa/administração e sem alterar comissão da casa", () => {
    expect(valorParceiro(3000)).toBe(1500); // 10% com administração
    expect(valorParceiro(2200)).toBe(1100); // 8% com administração
    expect(valorParceiro(3000)).toBe(1500); // sem administração (taxa 0)
    expect(valorParceiro(2200.01)).toBe(1100.01); // arredonda centavos
    // Aba Comissão mostra o mesmo valor; o lado da casa continua pela tabela da taxa.
    const c = calcularComissao({ aluguel: 3000, taxaAdm: 10, parceria: true }, CONFIG_PADRAO);
    expect(c.parceiro).toBe(1500);
    expect(c.totalLado).toBe(750);
    expect(calcularComissao({ aluguel: 2200, taxaAdm: 8, parceria: true }, CONFIG_PADRAO).parceiro).toBe(1100);
    expect(calcularComissao({ aluguel: 3000, taxaAdm: 10, parceria: false }, CONFIG_PADRAO).parceiro).toBe(0);
  });
  it("lista: valor calculado e pagamento lido", () => {
    const r = lerParceirosPagar({
      config: {},
      itens: [
        {
          id: "l1",
          codigo: "LOC-0001",
          aluguel: 2200,
          taxa_adm: 8,
          valor_parceiro: 1100,
          parceria: "externa",
          parceria_lado: "locatario",
          parceria_imobiliaria: "Imob",
          situacao: "encerrada",
          pagamento: { favorecido_tipo: "corretor", documento: "52998224725", emite_nf: true },
        },
      ],
    });
    expect(r.itens[0].valorParceiro).toBe(1100);
    expect(r.itens[0].lado).toBe("locatario");
    expect(r.itens[0].encerrada).toBe(true);
    expect(r.itens[0].pagamento?.documento).toBe("529.982.247-25");
  });
});

describe("migration e rollback", () => {
  it("tabela fechada ao navegador; só Financeiro da locação e gestão", () => {
    expect(MIG).toContain(
      "ALTER TABLE public.locacao_parceiro_pagamento ENABLE ROW LEVEL SECURITY;",
    );
    expect(MIG).toContain(
      "REVOKE ALL ON public.locacao_parceiro_pagamento FROM PUBLIC, anon, authenticated;",
    );
    expect(MIG).toMatch(
      /locacao_parceiro_pag_pode[\s\S]*?locacao_fin_pode_regras\(_uid, _org\) OR public\.locacao_eh_gerencia\(_uid\)/,
    );
    expect(MIG).not.toMatch(/CREATE POLICY/i);
  });
  it("histórico não leva documento, PIX nem conta", () => {
    const ev = MIG.slice(MIG.indexOf("Histórico SEM o documento"));
    expect(ev.slice(0, ev.indexOf(";"))).not.toMatch(/_doc|_pix|_ct|_ban/);
  });
  it("lançamentos existentes não mudam (sem UPDATE retroativo)", () => {
    expect(MIG).not.toMatch(/UPDATE public\.locacao_lancamentos/);
    expect(MIG).not.toMatch(/UPDATE public\.locacoes/);
  });
  it("rollback apaga o novo e devolve as 2 funções", () => {
    for (const x of [
      "locacao_parceiros_pagar",
      "locacao_parceiro_pag_salvar",
      "locacao_parceiro_pag_ler",
      "locacao_cnpj_ok",
      "locacao_cnpj_limpo",
      "TABLE IF EXISTS public.locacao_parceiro_pagamento",
      "COLUMN IF EXISTS parceria_lado",
    ]) {
      expect(RB).toContain(x);
    }
    expect(RB.match(/CREATE OR REPLACE FUNCTION/g)?.length).toBe(2);
    expect(RB).not.toContain("parceria_lado', _x.parceria_lado");
  });
});
