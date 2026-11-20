// Pedidos da reunião de 16/11 (t_8f09d406): tipo do imóvel, complemento, prazo 30/36, equipe gravada, lançamento da
// Fernanda na comissão e aviso de WhatsApp ao corretor. Parte pura + conferência do texto da migration.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IMOVEL_TIPO_LABEL,
  calcularComissao,
  enderecoCompleto,
  equipeTexto,
  faltasPreAprovacao,
  fichaParaBanco,
  lerFicha,
  lerLancamentoResumo,
  lerLista,
  prazoPadraoMeses,
  valoresParaComissao,
  type ConfigLocacao,
} from "./locacao";
import { faltasContrato } from "./locacao-contrato";
import {
  MAX_AVISOS_POR_CHAMADA,
  avisosLocacaoLigados,
  motivoParaNaoEnviar,
  textoAvisoLocacao,
} from "./locacao-avisos";
import { camposIniciais } from "./locacao-montagem";
import {
  faltasLancamento,
  lancamentoParaBanco,
  lerLancamentoCompleto,
  type LancamentoValores,
} from "@/components/locacao/LocacaoLancamento";

const MIG = readFileSync("supabase/migrations/20261201150000_locacao_reuniao_16_11.sql", "utf8");
const RB = readFileSync("supabase/rollback/20261201150000_locacao_reuniao_16_11.sql", "utf8");
const BOL = readFileSync(
  "supabase/migrations/20261211120000_locacao_boletos_condominio_gas.sql",
  "utf8",
);
const BOL_RB = readFileSync(
  "supabase/rollback/20261211120000_locacao_boletos_condominio_gas.sql",
  "utf8",
);

describe("item 2 — tipo do imóvel", () => {
  it("três tipos, iguais aos do banco", () => {
    expect(Object.keys(IMOVEL_TIPO_LABEL)).toEqual(["condominio", "casa", "comercial"]);
    expect(MIG).toContain("CHECK (imovel_tipo IN ('condominio', 'casa', 'comercial'))");
  });
  it("pré-aprovação cobra o tipo quando a tela informa que está vazio", () => {
    const base = {
      garantia: "seguro_fianca" as const,
      cep: "18000-000",
      endereco: "Rua Teste, 100",
      aluguel: 2000,
      condominio: 0,
      iptu: 0,
      candidato: {
        cpf: "529.982.247-25",
        nome: "Fulano Teste",
        nascimento: "1990-01-01",
        telefone: "(15) 90000-0000",
        email: "a@b.co",
        renda: "",
      },
      fiador: { nome: "", cpf: "", renda: "", matricula: "" },
      observacao: "",
    };
    expect(faltasPreAprovacao({ ...base, imovelTipo: null })).toEqual(["tipo do imóvel"]);
    expect(faltasPreAprovacao({ ...base, imovelTipo: "casa" })).toEqual([]);
    expect(faltasPreAprovacao(base)).toEqual([]);
  });
  it("condomínio: CND opcional (não trava) e só para condomínio", () => {
    expect(MIG).toContain("ARRAY['CND do condomínio (opcional)']");
    expect(MIG).toContain("AND (v.ordem <> 4 OR _l.imovel_tipo = 'condominio')");
  });
  // t_a0736d87: boleto do condomínio (obrigatório) e boleto do gás só quando há código de gás.
  // Suíte do banco: supabase/tests/locacao-boletos.sql (run-locacao-boletos.sh).
  it("boletos: condomínio obrigatório só em condomínio; gás só com código de gás", () => {
    expect(BOL).toContain("ARRAY['Boleto do condomínio', 'CND do condomínio (opcional)']");
    expect(BOL).toContain("AND (v.ordem <> 4 OR _l.imovel_tipo = 'condominio')");
    expect(BOL).toContain("AND (v.ordem <> 5 OR public.locacao_tem_gas(_l))");
    expect(BOL).toContain("IF _grupo = 'gas' THEN RETURN ARRAY['Boleto do gás']; END IF;");
    // O boleto não leva "(opcional)": trava o envio. A CND continua opcional.
    expect("Boleto do condomínio").not.toMatch(/\(opcional\)\s*$/);
  });
  it("sinal de gás: vazio, 'não possui'/'sem' e 'cobrado no condomínio' não pedem boleto", () => {
    const re =
      /SELECT coalesce\(s\.v <> '' AND s\.v !~\* '(.+?)' AND s\.v !~\* '(.+?)', false\)/.exec(BOL);
    expect(re).not.toBeNull();
    const nega = new RegExp(re![1].replace("[[:space:]]", "\\s"), "i");
    const condo = new RegExp(re![2], "i");
    const temGas = (v: string) => v.trim() !== "" && !nega.test(v.trim()) && !condo.test(v.trim());
    expect(temGas("123456")).toBe(true);
    expect(temGas("Comgás 0012345")).toBe(true);
    for (const v of [
      "",
      "   ",
      "não possui",
      "Não tem",
      "nao possui",
      "sem gás",
      "cobrado no condomínio",
    ])
      expect(temGas(v)).toBe(false);
  });
  it("rollback devolve o texto exato da 20261201150000 e apaga a função nova", () => {
    const fn = (sql: string, nome: string) =>
      new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${nome}\\([\\s\\S]*?\\n(\\$\\$;|END \\$\\$;)\\n`,
      ).exec(sql)?.[0];
    for (const nome of ["locacao_partes", "locacao_docs_grupo"]) {
      expect(fn(BOL_RB, nome)).toBeTruthy();
      expect(fn(BOL_RB, nome)).toBe(fn(MIG, nome));
    }
    expect(BOL_RB).toContain("DROP FUNCTION public.locacao_tem_gas(public.locacoes);");
  });
});

describe("item 1 — complemento", () => {
  it("vai e volta na ficha e entra no endereço", () => {
    const f = lerFicha({ complemento: "Bloco B, apto 42" });
    expect(f.complemento).toBe("Bloco B, apto 42");
    expect(fichaParaBanco(f).complemento).toBe("Bloco B, apto 42");
    expect(fichaParaBanco({ ...f, complemento: "  " }).complemento).toBeNull();
    expect(enderecoCompleto("Rua A, 10", "apto 3")).toBe("Rua A, 10 — apto 3");
    expect(enderecoCompleto("Rua A, 10", null)).toBe("Rua A, 10");
  });
  it("contrato montado usa o endereço com complemento", () => {
    const c = camposIniciais(
      {
        codigo: "LOC-0001",
        endereco: "Rua A, 10",
        aluguel: 1000,
        taxaAdm: 10,
        tipo: "residencial",
        garantia: "fiador",
        ficha: { imovelId: "", complemento: "apto 3" },
      },
      {
        campos: {},
        contrato: {},
        administradora: { nome: "", cnpj: "", creci: "", cidade: "", uf: "" },
      },
    );
    expect(c.imovel_endereco).toBe("Rua A, 10, apto 3");
  });
  it("banco aceita a chave complemento (até 100)", () => {
    expect(MIG).toMatch(/_e\.key = 'complemento' THEN[\s\S]*?length\(_t\) > 100/);
  });
});

describe("item 4 — prazo e trava", () => {
  it("prazo sugerido: 30 residencial, 36 comercial", () => {
    expect(prazoPadraoMeses("residencial")).toBe(30);
    expect(prazoPadraoMeses("comercial")).toBe(36);
  });
  it("prazo, vencimento e moradores em todas as garantias (front = banco)", () => {
    for (const g of ["caucao", "seguro_fianca", "loft", "titulo_capitalizacao", "outras"]) {
      expect(faltasContrato("residencial", g, {})).toEqual([
        "prazo (meses)",
        "dia de vencimento",
        "moradores",
      ]);
    }
    expect(MIG).toContain("_f := array_append(_f, 'moradores')");
  });
});

describe("item 5 — equipe gravada na abertura", () => {
  it("lê equipe, Gestor e TL; locação antiga aparece como 'aberta antes do registro'", () => {
    const [nova, antiga] = lerLista([
      {
        id: "1",
        equipe_id: "e1",
        equipe_nome: "Equipe Azul",
        equipe_gestor_nome: "Gestor Fictício",
        equipe_tl_nome: "TL Fictício",
        equipe_gravada_em: "2026-12-01T10:00:00Z",
      },
      { id: "2" },
    ]);
    expect(nova.equipe.gestorNome).toBe("Gestor Fictício");
    expect(nova.equipe.teamLeaderNome).toBe("TL Fictício");
    expect(equipeTexto(nova.equipe)).toBe("Equipe Azul");
    expect(equipeTexto(antiga.equipe)).toBe("aberta antes do registro");
    expect(
      equipeTexto({ id: null, nome: null, gestorNome: null, teamLeaderNome: null, gravadaEm: "x" }),
    ).toBe("sem equipe");
  });
  it("banco congela a equipe depois da criação", () => {
    expect(MIG).toContain("NEW.equipe_id := OLD.equipe_id");
    expect(MIG).toContain("BEFORE INSERT OR UPDATE ON public.locacoes");
  });
});

describe("item 6 — lançamento da Fernanda na comissão", () => {
  const cfg = {
    tabelaTaxa: { "10": 50, "8": 40 },
    parceriaDividePorDois: true,
    coordenadorNaParceria: true,
    pctCoordenador: 10,
    coordenadorSaiDoCorretor: true,
  } as unknown as ConfigLocacao;
  it("sem lançamento: valores da pré-análise", () => {
    const v = valoresParaComissao({
      aluguel: 2000,
      taxaAdm: 10,
      parceria: false,
      lancamento: null,
    });
    expect(v).toEqual({ aluguel: 2000, taxaAdm: 10, parceria: false, lancado: false });
  });
  it("com lançamento: valores lançados substituem; parceria RE/MAX divide 50/50", () => {
    const lancamento = lerLancamentoResumo({ aluguel: 3000, taxa_adm: 8, parceria: "remax" });
    const v = valoresParaComissao({ aluguel: 2000, taxaAdm: 10, parceria: false, lancamento });
    expect(v).toEqual({ aluguel: 3000, taxaAdm: 8, parceria: true, lancado: true });
    const r = calcularComissao(v, cfg);
    expect(r.base).toBe(1500);
    expect(r.parceiro).toBe(600);
  });
  it("lançamento inválido é ignorado", () => {
    expect(lerLancamentoResumo(null)).toBeNull();
    expect(lerLancamentoResumo({ aluguel: 0, taxa_adm: 10 })).toBeNull();
  });
  it("formulário: faltas e o que vai ao banco", () => {
    const v: LancamentoValores = {
      captadorId: "",
      locador: " Dono ",
      gestorId: "",
      teamLeaderId: "",
      aluguel: "2.500,00",
      taxaAdm: "10",
      parceria: "remax",
      parceriaUnidade: "",
      parceriaCorretor: "",
      parceriaImobiliaria: "sobra",
      observacao: "",
    };
    expect(faltasLancamento(v)).toEqual(["unidade RE/MAX parceira", "corretor parceiro"]);
    const b = lancamentoParaBanco({ ...v, parceriaUnidade: "RE/MAX X", parceriaCorretor: "Ana" });
    expect(b.aluguel).toBe("2500");
    expect(b.locador).toBe("Dono");
    expect(b.parceria_imobiliaria).toBeNull();
    expect(
      faltasLancamento({
        ...v,
        aluguel: "",
        taxaAdm: "40",
        parceria: "externa",
        parceriaImobiliaria: "",
      }),
    ).toEqual(["aluguel", "taxa de administração", "imobiliária parceira"]);
  });
  it("lê o retorno do banco", () => {
    const l = lerLancamentoCompleto({
      pode_editar: true,
      lancado: false,
      valores: { aluguel: 1800, taxa_adm: 10, parceria: "externa", locador: "Dono" },
      nomes: { gestor: "G" },
    });
    expect(l.valores.aluguel).toBe("1.800,00");
    expect(l.valores.parceria).toBe("externa");
    expect(l.nomes.gestor).toBe("G");
    expect(l.podeEditar).toBe(true);
  });
});

describe("item 7 — aviso de WhatsApp", () => {
  const a = {
    aviso_id: "a1",
    evento: "minuta_enviada" as const,
    texto: "Confira a minuta v2.",
    codigo: "LOC-0099",
    endereco: "Rua A, 10 — apto 3",
    telefone: "15900000000",
    ativo: true,
    quer_whatsapp: true,
    locacao_id: "l1",
  };
  it("texto curto com código, endereço e link", () => {
    const t = textoAvisoLocacao(a, "https://x/locacoes/l1");
    expect(t).toContain("*Minuta para conferir*");
    expect(t).toContain("LOC-0099 - Rua A, 10 — apto 3");
    expect(t).toContain("https://x/locacoes/l1");
  });
  it("não envia a inativo, sem telefone ou com WhatsApp desligado; no máx. 5 por chamada", () => {
    expect(motivoParaNaoEnviar(a, "5515900000000")).toBeNull();
    expect(motivoParaNaoEnviar({ ...a, ativo: false }, "x")).toBe("corretor inativo");
    expect(motivoParaNaoEnviar({ ...a, quer_whatsapp: false }, "x")).toMatch(/desligado/);
    expect(motivoParaNaoEnviar(a, null)).toBe("sem telefone");
    expect(MAX_AVISOS_POR_CHAMADA).toBe(5);
  });
  it("idempotência no banco: chave única por evento", () => {
    expect(MIG).toMatch(/CREATE TABLE public\.locacao_avisos[\s\S]*?UNIQUE/);
  });
  it("trava geral (t_3194d2d4): só envia com LOCACAO_AVISOS_WHATSAPP=on; padrão desligado", () => {
    expect(avisosLocacaoLigados(undefined)).toBe(false);
    expect(avisosLocacaoLigados(null)).toBe(false);
    expect(avisosLocacaoLigados("")).toBe(false);
    expect(avisosLocacaoLigados("off")).toBe(false);
    expect(avisosLocacaoLigados("true")).toBe(false);
    expect(avisosLocacaoLigados("ON")).toBe(false);
    expect(avisosLocacaoLigados("on")).toBe(true);
    const FN = readFileSync("src/lib/locacao-avisos.functions.ts", "utf8");
    const iTrava = FN.indexOf("avisosLocacaoLigados(process.env.LOCACAO_AVISOS_WHATSAPP)");
    expect(iTrava).toBeGreaterThan(0);
    // A trava vem antes de reservar a fila e antes de ler a chave do ZionTalk: nada muda de "pendente".
    expect(iTrava).toBeLessThan(FN.indexOf("locacao_avisos_reservar"));
    expect(iTrava).toBeLessThan(FN.indexOf("process.env.ZIONTALK_API_KEY"));
  });
});

describe("rollback", () => {
  it("desfaz tabelas, colunas e gatilho novos", () => {
    for (const x of [
      "locacao_avisos",
      "locacao_lancamentos",
      "locacao_clientes",
      "locacao_00_abertura",
      "imovel_tipo",
    ]) {
      expect(RB).toContain(x);
    }
  });
});
