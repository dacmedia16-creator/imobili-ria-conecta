import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO,
  ETAPAS,
  calcularComissao,
  dataPagamento,
  diasParado,
  extensaoDoc,
  cpfValido,
  faltasPreAprovacao,
  reaisNumero,
  reaisParaBanco,
  reaisParaTela,
  lerConfig,
  lerContexto,
  lerDetalhe,
  lerLocacao,
  pctPorTaxa,
  responsavelAtual,
  resumoPorEtapa,
  textoParado,
  titularidadePendente,
  tomParado,
} from "./locacao";
import { INVITE_MODULES_OFF } from "./org-invites";
import { ORGANIZATION_MODULES, ORGANIZATION_MODULE_LABELS } from "./platform-organizations";
import { montarMenuLateral } from "./menu-lateral";
import { docsParaTexto, ordemAssinatura, textoParaDocs } from "./locacao";

const MIG = readFileSync("supabase/migrations/20261110120000_locacao_fase1.sql", "utf8");
const RB = readFileSync("supabase/rollback/20261110120000_locacao_fase1.sql", "utf8");

describe("esteira da locação (maquete aprovada 09/11)", () => {
  it("9 etapas na ordem da maquete, cada uma com responsável", () => {
    expect(ETAPAS.map((e) => e.key)).toEqual([
      "pre_analise",
      "aprovacao",
      "documentacao",
      "conferencia",
      "minuta",
      "assinatura",
      "pos_assinatura",
      "chaves",
      "comissao",
    ]);
    expect(ETAPAS.map((e) => e.papel)).toEqual([
      "corretor",
      "gestora",
      "corretor",
      "gestora",
      "contratos",
      "contratos",
      "vistoria",
      "vistoria",
      "comissao",
    ]);
  });
  it("mesmas etapas no CHECK do banco", () => {
    const check = MIG.match(/locacoes_etapa_check CHECK \(etapa IN\s*\(([^)]*)\)/)?.[1] ?? "";
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(ETAPAS.map((e) => e.key));
  });
});

describe("comissão (taxa → % do 1º aluguel)", () => {
  it("tabela da maquete: 10→50, 9→45, 8→40, 7→35, 6→30", () => {
    expect([10, 9, 8, 7, 6].map((t) => pctPorTaxa(t))).toEqual([50, 45, 40, 35, 30]);
  });
  it("taxa fora da tabela usa taxa × 5", () => {
    expect(pctPorTaxa(5)).toBe(25);
  });
  it("exemplo da maquete: R$ 2.100, taxa 7% → 35% = R$ 735; coord. 10% → corretor R$ 661,50", () => {
    const r = calcularComissao({ aluguel: 2100, taxaAdm: 7, parceria: false }, CONFIG_PADRAO);
    expect(r).toMatchObject({
      pct: 35,
      totalLado: 735,
      coordenador: 73.5,
      corretor: 661.5,
      parceiro: 0,
    });
  });
  it("parceria: aluguel ÷ 2 × % para cada lado (a confirmar)", () => {
    const r = calcularComissao({ aluguel: 3000, taxaAdm: 8, parceria: true }, CONFIG_PADRAO);
    expect(r).toMatchObject({
      pct: 40,
      base: 1500,
      totalLado: 600,
      coordenador: 60,
      corretor: 540,
      parceiro: 600,
    });
  });
  it("regras configuráveis: coordenador pago à parte, sem coordenador na parceria, parceria sem dividir", () => {
    const cfg = { ...CONFIG_PADRAO, coordenadorSaiDoCorretor: false };
    expect(calcularComissao({ aluguel: 2000, taxaAdm: 10, parceria: false }, cfg).corretor).toBe(
      1000,
    );
    const cfg2 = { ...CONFIG_PADRAO, coordenadorNaParceria: false };
    expect(calcularComissao({ aluguel: 2000, taxaAdm: 10, parceria: true }, cfg2).coordenador).toBe(
      0,
    );
    const cfg3 = { ...CONFIG_PADRAO, parceriaDividePorDois: false };
    expect(calcularComissao({ aluguel: 2000, taxaAdm: 10, parceria: true }, cfg3)).toMatchObject({
      base: 2000,
      parceiro: 0,
    });
  });
  it("data de pagamento: 1–15 → dia 8 do mês seguinte; 16–31 → dia 6; virada do ano", () => {
    expect(dataPagamento("2026-10-10", CONFIG_PADRAO)).toBe("2026-11-08");
    expect(dataPagamento("2026-10-15", CONFIG_PADRAO)).toBe("2026-11-08");
    expect(dataPagamento("2026-10-16", CONFIG_PADRAO)).toBe("2026-11-06");
    expect(dataPagamento("2026-12-22", CONFIG_PADRAO)).toBe("2027-01-06");
    expect(
      dataPagamento("2026-10-10", {
        ...CONFIG_PADRAO,
        diaPagamento1a15: 23,
        diaPagamento16a31: 23,
      }),
    ).toBe("2026-11-23");
    expect(dataPagamento(null, CONFIG_PADRAO)).toBeNull();
  });
  it("titularidade sem protocolo só alerta (lista o que falta)", () => {
    const tit = {
      cpfl: { aplica: true, protocolo: "CPFL-1" },
      saae: { aplica: true, protocolo: null },
      gas: { aplica: false, protocolo: null },
    };
    expect(titularidadePendente(tit)).toEqual(["SAAE"]);
  });
});

describe("tempo parado e visão geral", () => {
  const agora = new Date("2026-11-09T12:00:00Z");
  it("dias parado e cores da venda (até 2 normal · 3–5 âmbar · >5 vermelho)", () => {
    expect(diasParado("2026-11-09T08:00:00Z", agora)).toBe(0);
    expect(diasParado("2026-11-03T12:00:00Z", agora)).toBe(6);
    expect([0, 2, 3, 5, 6].map(tomParado)).toEqual(["slate", "slate", "amber", "amber", "red"]);
    expect([0, 1, 4].map(textoParado)).toEqual(["hoje", "há 1 dia", "há 4 dias"]);
  });
  it("resumo por etapa: quantidade, média e máximo", () => {
    const l = (etapa: string, desde: string) =>
      lerLocacao({ id: desde, etapa, etapa_desde: desde });
    const r = resumoPorEtapa(
      [l("minuta", "2026-11-03T12:00:00Z"), l("minuta", "2026-11-07T12:00:00Z")],
      agora,
    );
    expect(r.find((x) => x.etapa === "minuta")).toEqual({
      etapa: "minuta",
      quantidade: 2,
      maxDias: 6,
      mediaDias: 4,
    });
    expect(r.find((x) => x.etapa === "aprovacao")?.quantidade).toBe(0);
  });
  it("responsável atual: corretor pelo nome; demais etapas pelo papel e pessoas", () => {
    expect(responsavelAtual(lerLocacao({ etapa: "documentacao", corretor_nome: "Carla" }))).toBe(
      "Carla",
    );
    expect(responsavelAtual(lerLocacao({ etapa: "aprovacao" }), { gestora: ["Paula"] })).toBe(
      "Gestora de locação · Paula",
    );
  });
});

describe("leitura fechada do banco", () => {
  it("etapa/garantia desconhecidas caem no padrão; números em texto viram número", () => {
    const l = lerLocacao({ etapa: "xyz", garantia: "boleto", aluguel: "2100.50", taxa_adm: "7" });
    expect(l).toMatchObject({
      etapa: "pre_analise",
      garantia: "fiador",
      aluguel: 2100.5,
      taxaAdm: 7,
    });
    expect(l.pos.tit).toEqual({
      cpfl: { aplica: true, protocolo: null },
      saae: { aplica: true, protocolo: null },
      gas: { aplica: false, protocolo: null },
    });
  });
  it("detalhe traz checklist, faltando, documentos e histórico", () => {
    const d = lerDetalhe({
      etapa: "documentacao",
      checklist: ["A", "B"],
      faltando: ["B"],
      documentos: [{ id: "1", item: "A", nome_arquivo: "a.pdf", enviado_em: "x" }],
      eventos: [
        {
          em: "2026-11-09",
          etapa: "documentacao",
          papel: "corretor",
          descricao: "ok",
          ator_nome: null,
        },
      ],
    });
    expect(d.faltando).toEqual(["B"]);
    expect(d.documentos[0].nomeArquivo).toBe("a.pdf");
    expect(d.eventos).toHaveLength(1);
  });
  it("config e contexto: padrão da maquete quando vazio; papéis só da lista", () => {
    expect(lerConfig({})).toMatchObject({
      pctCoordenador: 10,
      diaPagamento1a15: 8,
      diaPagamento16a31: 6,
      chaveAntesDoLaudo: true,
    });
    const c = lerContexto({ papeis: ["gestora", "hacker"], ve_comissao: true });
    expect(c.papeis).toEqual(["gestora"]);
    expect(c.veComissao).toBe(true);
  });
  it("pré-aprovação: lista o que falta pela garantia (o banco repete a regra)", () => {
    const semFiador = { nome: "", cpf: "", renda: "", matricula: "" };
    const vazio = {
      garantia: "seguro_fianca" as const,
      cep: "",
      endereco: "",
      aluguel: 0,
      condominio: null,
      iptu: null,
      candidato: { cpf: "", nome: "", nascimento: "", telefone: "", email: "", renda: "" },
      fiador: semFiador,
      observacao: "",
    };
    expect(faltasPreAprovacao(vazio)).toEqual([
      "CEP",
      "endereço do imóvel",
      "aluguel",
      "condomínio",
      "IPTU",
      "CPF do locatário",
      "nome completo do locatário",
      "data de nascimento do locatário",
      "telefone do locatário",
      "e-mail do locatário",
    ]);
    const ok = {
      ...vazio,
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
    };
    // Condomínio/IPTU zero valem (não tem); seguro fiança não pede renda.
    expect(faltasPreAprovacao(ok)).toEqual([]);
    expect(faltasPreAprovacao({ ...ok, garantia: "caucao" })).toEqual(["renda do locatário"]);
    expect(faltasPreAprovacao({ ...ok, garantia: "fiador" })).toEqual([
      "renda do locatário",
      "nome completo do fiador",
      "CPF do fiador",
      "renda do fiador",
      "nº da matrícula do imóvel do fiador",
    ]);
    expect(faltasPreAprovacao({ ...ok, garantia: "loft" })).toEqual([]);
    expect(faltasPreAprovacao({ ...ok, garantia: "outras" })).toEqual(["observação da garantia"]);
    expect(
      faltasPreAprovacao({ ...ok, candidato: { ...ok.candidato, cpf: "529.982.247-26" } }),
    ).toEqual(["CPF do locatário"]);
  });
  it("valores em R$: aceita 0 em condomínio/IPTU, renda precisa ser > 0", () => {
    expect(reaisNumero("0")).toBe(0);
    expect(reaisNumero("0,00")).toBe(0);
    expect(reaisNumero("R$ 7.800,50")).toBe(7800.5);
    expect(reaisNumero("2.500")).toBe(2500);
    expect(reaisNumero("12.5")).toBe(12.5);
    expect(reaisNumero("")).toBeNull();
    expect(reaisNumero("abc")).toBeNull();
    expect(reaisParaBanco("0")).toBe("");
    expect(reaisParaBanco("7.800,00")).toBe("7800.00");
    expect(reaisParaTela(0)).toBe("0,00");
    expect(reaisParaTela("")).toBe("");
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("111.111.111-11")).toBe(false);
  });
  it("arquivo: só PDF e imagem", () => {
    expect(extensaoDoc("RG.PDF")).toBe("pdf");
    expect(extensaoDoc("foto.jpeg")).toBe("jpeg");
    expect(extensaoDoc("virus.exe")).toBeNull();
  });
  it("lista de documentos: texto ↔ JSON (ida e volta)", () => {
    const docs = {
      locatario: ["RG", "CPF"],
      fiador: ["Renda"],
      caucao: [],
      seguro_fianca: ["Apólice"],
      proprietario: ["Matrícula"],
    };
    expect(textoParaDocs(docsParaTexto(docs))).toEqual(docs);
  });
});

describe("módulo por imobiliária", () => {
  const nomes = (x: string) => [...x.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();
  it("na lista do código, com rótulo, desligado no convite", () => {
    expect(ORGANIZATION_MODULES).toContain("locacao");
    expect(ORGANIZATION_MODULE_LABELS.locacao).toMatch(/Locação/);
    expect(INVITE_MODULES_OFF).toContain("locacao");
  });
  it("CHECK e RPC = lista do código; rollback volta à lista anterior e apaga a chave antes do CHECK", () => {
    // ajuda_max_locacao (t_b037935e) veio depois, na migration 20261116120000.
    const novo = [...ORGANIZATION_MODULES].filter((x) => x !== "ajuda_max_locacao").sort();
    expect(nomes(MIG.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "")).toEqual(novo);
    expect(nomes(MIG.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "")).toEqual(novo);
    const anterior = novo.filter((x) => x !== "locacao");
    expect(nomes(RB.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "")).toEqual(anterior);
    expect(nomes(RB.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "")).toEqual(anterior);
    const del = RB.indexOf("DELETE FROM public.organization_modules WHERE module = 'locacao'");
    expect(del).toBeGreaterThan(0);
    expect(del).toBeLessThan(RB.indexOf("ADD CONSTRAINT organization_modules_module_check"));
  });
  it("nasce desligado (sem seed) e não toca venda, captação nem papéis do sistema", () => {
    expect(MIG.match(/INSERT INTO public\.organization_modules/g)).toHaveLength(1);
    expect(MIG).not.toMatch(/ALTER TYPE public\.(sale_status|app_role)/);
    expect(MIG).not.toMatch(
      /(INSERT INTO|UPDATE|DELETE FROM) public\.(sales|sale_|exclusive_|leads|user_roles)\b/,
    );
    expect(MIG).not.toMatch(/CREATE POLICY/);
  });
  it("rollback derruba toda função e tabela criada", () => {
    const fns = [...MIG.matchAll(/CREATE OR REPLACE FUNCTION public\.(locacao_[a-z_]+)\(/g)].map(
      (m) => m[1],
    );
    expect(fns.length).toBeGreaterThan(30);
    for (const f of new Set(fns)) expect(RB, f).toContain(`DROP FUNCTION IF EXISTS public.${f}(`);
    for (const t of [
      "locacao_config",
      "locacao_papeis",
      "locacoes",
      "locacao_documentos",
      "locacao_eventos",
    ])
      expect(RB).toContain(`DROP TABLE IF EXISTS public.${t};`);
  });
  it("RLS ligada e nenhum grant de tabela ao navegador", () => {
    for (const t of [
      "locacao_config",
      "locacao_papeis",
      "locacoes",
      "locacao_documentos",
      "locacao_eventos",
    ])
      expect(MIG).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    expect(MIG).not.toMatch(/GRANT [A-Z, ]+ ON public\.locac[^;]* TO (authenticated|anon)/);
  });
  it("assinatura: registro manual DocuSign (sem integração nova nesta fase)", () => {
    expect(MIG).toMatch(/'modo', 'manual'/);
    expect(MIG).not.toMatch(/clicksign/i);
    expect(MIG).toMatch(/registrado \(manual, DocuSign\)/);
  });
  it("ordem de assinatura segue o setor de contratos; fiador só com garantia fiador", () => {
    expect(ordemAssinatura("fiador")).toEqual([
      "Proprietário (+ cônjuge)",
      "Locatário (+ cônjuge)",
      "Fiador(es) (+ cônjuge)",
      "Testemunhas",
      "Diretoria RE/MAX",
    ]);
    expect(ordemAssinatura("caucao")).not.toContain("Fiador(es) (+ cônjuge)");
    expect(ordemAssinatura("seguro_fianca").at(-1)).toBe("Diretoria RE/MAX");
  });
});

describe("menu", () => {
  const ctx = {
    roles: ["corretor"],
    platformAdmin: false,
    exclusiveVisible: false,
    roomVisible: false,
    feedbackVisible: false,
  };
  const itens = (c: Parameters<typeof montarMenuLateral>[0]) =>
    montarMenuLateral(c).flatMap((g) => g.items.filter((i) => i.show).map((i) => i.to));
  it("Locação só aparece com o módulo ligado", () => {
    expect(itens(ctx)).not.toContain("/locacoes");
    expect(itens({ ...ctx, locacaoVisible: true })).toContain("/locacoes");
  });
  it("nome do menu = título da tela", () => {
    const fonte = readFileSync("src/routes/_authenticated/locacoes.index.tsx", "utf8");
    expect(fonte).toContain('title="Locação"');
    expect(fonte).toContain('title: "Locação"');
  });
  it("no celular o detalhe reserva espaço para o checklist não ficar atrás da barra", () => {
    const tela = readFileSync("src/components/locacao/LocacaoDetalhe.tsx", "utf8");
    const check = readFileSync("src/components/locacao/LocacaoChecklist.tsx", "utf8");
    expect(tela).toContain("max-md:pb-24");
    expect(check).toContain("max-md:pb-16");
    expect(check).toContain("max-md:scroll-mt-20");
  });
  it("telas marcam as regras não confirmadas com 'a confirmar'", () => {
    const tela = readFileSync("src/components/locacao/LocacaoDetalhe.tsx", "utf8");
    const regras = readFileSync("src/components/locacao/LocacaoRegras.tsx", "utf8");
    expect(tela).toContain("a confirmar");
    // 4 campos com a marca direta + 6 caixas pelo helper chk() (que sempre põe a marca).
    expect((regras.match(/<AConfirmar \/>/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((regras.match(/\{chk\(/g) ?? []).length).toBe(6);
    expect(regras).toMatch(/\{label\} <AConfirmar \/>/);
  });
});
