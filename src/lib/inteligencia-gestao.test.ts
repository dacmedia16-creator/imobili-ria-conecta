import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calcularFarol,
  captacoesEsperadas,
  DICA_ETAPA,
  farolGeral,
  gargalo,
  metaDesatualizada,
  montarPauta,
  normalizarCombinados,
  ordenarFarol,
  previsaoTrimestre,
  proximaSugerida,
  resumoGestoes,
  sinalAtividade,
  sinalCaptacoes,
  sinalGestoes,
  sinalLeads,
  sinalSemVender,
  trimestreDe,
  umAUmAtrasada,
  type CaptacaoFarol,
  type EntradaFarol,
  type LeadFarol,
  type Sinal,
} from "./inteligencia-gestao";
import { metasDoSnapshot, type Feito, type MetasSemana } from "./meta-atividades";
import { nivelSemVender } from "./painel-equipe-calc";
import { CONFIG_PADRAO } from "./leads";
import { ORGANIZATION_MODULES } from "./platform-organizations";

const HOJE = "2026-11-08";
const AGORA = new Date("2026-11-08T15:00:00Z");

const METAS: MetasSemana = metasDoSnapshot({
  "ms.lig": 12,
  "ms.v1": 4,
  "ms.v2": 3,
  "ms.capt": 3,
  "ms.ligMes": 48,
  "ms.v1Mes": 13,
  "ms.v2Mes": 11,
})!;
const semana = (p: Partial<Feito> = {}): Feito => ({
  ligacoes: 12,
  v1: 4,
  v2: 3,
  acm: 3,
  visitaComprador: 0,
  captMes: 0,
  ...p,
});
const s = (cor: Sinal["cor"]): Sinal => ({ chave: "leads", cor, texto: "" });

describe("sinal 1: dias sem vender (regra atual do Painel da Equipe)", () => {
  it("mesmas faixas de nivelSemVender: >14 amarelo, >30 ou nunca vendeu vermelho", () => {
    expect(sinalSemVender(14).cor).toBe("verde");
    expect(sinalSemVender(15).cor).toBe("amarelo");
    expect(sinalSemVender(30).cor).toBe("amarelo");
    expect(sinalSemVender(31).cor).toBe("vermelho");
    expect(sinalSemVender(null).cor).toBe("vermelho");
    expect(sinalSemVender(null).texto).toBe("Ainda não vendeu");
    for (const d of [0, 14, 15, 30, 31, null])
      expect(sinalSemVender(d).cor).toBe(
        { ok: "verde", atencao: "amarelo", alerta: "vermelho" }[nivelSemVender(d)],
      );
  });
});

describe("sinal 2: atividade da semana × meta do plano (cores do Sua semana)", () => {
  it("verde >= 100%, amarelo >= 70%, vermelho < 70%", () => {
    expect(sinalAtividade(semana(), METAS).cor).toBe("verde");
    // ligações 6/12 = 0,5; demais 100% → média 0,875
    expect(sinalAtividade(semana({ ligacoes: 6 }), METAS).cor).toBe("amarelo");
    expect(sinalAtividade(semana({ ligacoes: 0, v1: 0, v2: 3, acm: 3 }), METAS).cor).toBe(
      "vermelho",
    );
    expect(sinalAtividade(semana({ ligacoes: 6 }), METAS).texto).toBe(
      "Atividade da semana em 88% da meta",
    );
  });
  it("sem plano: 'sem plano', sem cor", () => {
    expect(sinalAtividade(semana(), null)).toEqual({
      chave: "atividade",
      cor: "sem_plano",
      texto: "Sem plano",
    });
  });
});

describe("sinal 3: leads sem resposta (regra de prazo do Painel de leads)", () => {
  const lead = (p: Partial<LeadFarol>): LeadFarol => ({
    etapa: "novo",
    no_banco_desde: null,
    responsavel_id: "u1",
    atribuido_em: null,
    aceito_em: null,
    ultima_interacao_em: null,
    created_at: "2026-11-08T14:00:00Z",
    ...p,
  });
  it("aceite vencido (> 24 h) = vermelho; vence em 24 h = amarelo; em dia = verde", () => {
    const vencido = lead({ atribuido_em: "2026-11-06T15:00:00Z" });
    const vencendo = lead({ atribuido_em: "2026-11-08T10:00:00Z" });
    const emDia = lead({ aceito_em: "2026-11-07T10:00:00Z" }); // 1ª interação em 7 dias
    expect(sinalLeads([vencido, emDia], CONFIG_PADRAO, AGORA).cor).toBe("vermelho");
    expect(sinalLeads([vencido], CONFIG_PADRAO, AGORA).texto).toBe(
      "1 lead sem resposta (prazo vencido há 1 dia)",
    );
    expect(sinalLeads([vencendo, emDia], CONFIG_PADRAO, AGORA).cor).toBe("amarelo");
    expect(sinalLeads([emDia], CONFIG_PADRAO, AGORA).cor).toBe("verde");
    expect(sinalLeads([], CONFIG_PADRAO, AGORA).cor).toBe("verde");
  });
  it("lead ganho/perdido ou no banco não conta; módulo de leads desligado = sem cor", () => {
    const velho = { atribuido_em: "2026-10-01T00:00:00Z" };
    expect(sinalLeads([lead({ ...velho, etapa: "ganho" })], CONFIG_PADRAO, AGORA).cor).toBe(
      "verde",
    );
    expect(
      sinalLeads([lead({ ...velho, no_banco_desde: "2026-10-05T00:00:00Z" })], CONFIG_PADRAO, AGORA)
        .cor,
    ).toBe("verde");
    expect(sinalLeads(null, null, AGORA).cor).toBe("sem_dado");
  });
});

describe("sinal 4: gestões (exclusividade + reunião de 45 dias do PR #285)", () => {
  const cap = (p: Partial<CaptacaoFarol>): CaptacaoFarol => ({
    id: "c",
    status: "aprovada",
    signed_on: "2026-10-20",
    prazo_dias: "180",
    vendida: false,
    reunioes: [],
    ...p,
  });
  it("vencida = vermelho; vence em até 15 dias = amarelo", () => {
    expect(sinalGestoes([cap({ signed_on: "2026-05-01", prazo_dias: "180" })], HOJE).cor).toBe(
      "vermelho",
    );
    // vence 11/11; reunião em dia (registrada em 01/11)
    const vence = cap({ signed_on: "2026-05-15", prazo_dias: "180", reunioes: ["2026-11-01"] });
    expect(sinalGestoes([vence], HOJE).cor).toBe("amarelo");
    expect(sinalGestoes([vence], HOJE).texto).toBe("1 exclusividade vence em até 15 dias");
    expect(sinalGestoes([cap({})], HOJE).cor).toBe("verde");
  });
  it("reunião de 45 dias atrasada = vermelho; vence em até 15 dias = amarelo; registrada = em dia", () => {
    expect(sinalGestoes([cap({ signed_on: "2026-09-01" })], HOJE).cor).toBe("vermelho"); // 68 dias
    expect(
      sinalGestoes([cap({ signed_on: "2026-09-01", reunioes: ["2026-10-20"] })], HOJE).cor,
    ).toBe("verde");
    expect(sinalGestoes([cap({ signed_on: "2026-10-01" })], HOJE).cor).toBe("amarelo"); // 38 dias, faltam 7
  });
  it("vendida, não aprovada e módulo de reunião desligado não acendem a reunião", () => {
    expect(sinalGestoes([cap({ signed_on: "2026-09-01", vendida: true })], HOJE).cor).toBe("verde");
    expect(sinalGestoes([cap({ signed_on: "2026-09-01", status: "enviada" })], HOJE).cor).toBe(
      "verde",
    );
    expect(sinalGestoes([cap({ signed_on: "2026-09-01", reunioes: null })], HOJE).cor).toBe(
      "verde",
    );
    expect(sinalGestoes(null, HOJE).cor).toBe("sem_dado");
  });
  it("conta tudo junto", () => {
    expect(
      resumoGestoes(
        [
          cap({ signed_on: "2026-05-01" }),
          cap({ signed_on: "2026-09-01" }),
          cap({ signed_on: "2026-05-15", reunioes: ["2026-11-01"] }),
        ],
        HOJE,
      ),
    ).toEqual({ vencidas: 1, vencem: 1, reunioesAtrasadas: 1, reunioesProximas: 0 });
  });
});

describe("sinal 5: captações no mês proporcional aos dias passados", () => {
  it("meta 3 no dia 8 de 30 = 0 esperadas; no dia 10 = 1; no fim do mês = 3", () => {
    expect(captacoesEsperadas(3, "2026-11-08")).toBe(0);
    expect(captacoesEsperadas(3, "2026-11-10")).toBe(1);
    expect(captacoesEsperadas(3, "2026-11-30")).toBe(3);
    expect(captacoesEsperadas(11, "2026-02-14")).toBe(5); // 11 × 14/28
  });
  it("cores pelo esperado até hoje; esperado 0 = verde; sem plano = sem cor", () => {
    expect(sinalCaptacoes(0, METAS, "2026-11-08").cor).toBe("verde");
    expect(sinalCaptacoes(0, METAS, "2026-11-20").cor).toBe("vermelho"); // esperado 2
    expect(sinalCaptacoes(1, METAS, "2026-11-20").cor).toBe("vermelho"); // 50%
    expect(sinalCaptacoes(2, METAS, "2026-11-30").cor).toBe("vermelho"); // 2/3 = 67%
    expect(sinalCaptacoes(3, METAS, "2026-11-30").cor).toBe("verde");
    expect(sinalCaptacoes(2, METAS, "2026-11-20").texto).toBe(
      "2 de 2 esperadas até hoje (meta do mês: 3)",
    );
    expect(sinalCaptacoes(5, null, HOJE).cor).toBe("sem_plano");
  });
});

describe("farol geral", () => {
  it("2+ vermelhos = risco; 1 vermelho ou 2+ amarelos = atenção; resto = tranquilo", () => {
    expect(farolGeral([s("vermelho"), s("vermelho"), s("verde")], 400)).toBe("risco");
    expect(farolGeral([s("vermelho"), s("verde")], 400)).toBe("atencao");
    expect(farolGeral([s("amarelo"), s("amarelo")], 400)).toBe("atencao");
    expect(farolGeral([s("amarelo"), s("verde"), s("sem_plano")], 400)).toBe("tranquilo");
    expect(farolGeral([], null)).toBe("tranquilo");
  });
  it("menos de 60 dias na equipe = novo (mesmo com vermelhos); 60 dias já conta", () => {
    expect(farolGeral([s("vermelho"), s("vermelho")], 22)).toBe("novo");
    expect(farolGeral([s("vermelho"), s("vermelho")], 59)).toBe("novo");
    expect(farolGeral([s("vermelho"), s("vermelho")], 60)).toBe("risco");
  });
  it("'sem plano' e 'sem dado' não pesam", () => {
    expect(farolGeral([s("sem_plano"), s("sem_plano"), s("sem_dado")], 400)).toBe("tranquilo");
  });
});

describe("calcularFarol + ordem", () => {
  const base: EntradaFarol = {
    user_id: "u",
    nome: "Carla",
    entrou_em: "2025-01-01",
    dias_sem_vender: 5,
    semana: semana(),
    capt_mes: 3,
    metas: METAS,
    leads: [],
    lead_config: CONFIG_PADRAO,
    captacoes: [],
  };
  it("monta os 5 sinais na ordem e só os acesos vão para a pauta", () => {
    const l = calcularFarol(
      { ...base, dias_sem_vender: 41, semana: semana({ ligacoes: 0, v1: 0 }) },
      HOJE,
      AGORA,
    );
    expect(l.sinais.map((x) => x.chave)).toEqual([
      "sem_vender",
      "atividade",
      "leads",
      "gestoes",
      "captacoes",
    ]);
    expect(l.farol).toBe("risco");
    expect(l.acesos.map((x) => x.chave)).toEqual(["sem_vender", "atividade"]);
  });
  it("sem plano: sinais 2 e 5 = 'sem plano' e o farol segue pelos outros", () => {
    const l = calcularFarol({ ...base, metas: null }, HOJE, AGORA);
    expect(l.sinais[1].cor).toBe("sem_plano");
    expect(l.sinais[4].cor).toBe("sem_plano");
    expect(l.farol).toBe("tranquilo");
  });
  it("novo (< 60 dias): aparece, sem farol de produção e sem sinais acesos", () => {
    const l = calcularFarol(
      { ...base, entrou_em: "2026-10-17", dias_sem_vender: null },
      HOJE,
      AGORA,
    );
    expect(l.farol).toBe("novo");
    expect(l.diasNaEquipe).toBe(22);
    expect(l.acesos).toEqual([]);
  });
  it("ordena risco → atenção → tranquilo → novo, sem ranking por produção", () => {
    const L = (nome: string, cores: Sinal["cor"][], dias = 400) => ({
      nome,
      sinais: cores.map(s),
      farol: farolGeral(cores.map(s), dias),
    });
    const ord = ordenarFarol([
      L("Diego", ["vermelho", "vermelho"], 10),
      L("Carla", ["verde"]),
      L("Ana", ["vermelho"]),
      L("Bruno", ["vermelho", "vermelho", "vermelho"]),
      L("Beto", ["vermelho", "vermelho"]),
    ]);
    expect(ord.map((x) => x.nome)).toEqual(["Bruno", "Beto", "Ana", "Carla", "Diego"]);
  });
});

describe("meta desatualizada (cópia ms.* do team leader)", () => {
  it("mostra 'meta de DD/MM' se a cópia é anterior à mudança das taxas ou tem mais de 30 dias", () => {
    expect(metaDesatualizada("2026-11-01", "2026-11-05", HOJE)).toBe("meta de 01/11");
    expect(metaDesatualizada("2026-10-01", null, HOJE)).toBe("meta de 01/10");
    expect(metaDesatualizada("2026-11-06", "2026-11-05", HOJE)).toBeNull();
    expect(metaDesatualizada("2026-10-09", null, HOJE)).toBeNull(); // 30 dias
    expect(metaDesatualizada(null, "2026-11-05", HOJE)).toBeNull();
  });
  it("vem na linha do farol", () => {
    const l = calcularFarol(
      {
        user_id: "u",
        nome: "Ana",
        entrou_em: null,
        dias_sem_vender: 1,
        semana: semana(),
        capt_mes: 0,
        metas: METAS,
        metas_em: "2026-09-30",
        taxas_em: null,
        leads: null,
        lead_config: null,
        captacoes: null,
      },
      HOJE,
      AGORA,
    );
    expect(l.metaDe).toBe("meta de 30/09");
  });
});

describe("gargalo (90 dias)", () => {
  const equipe = { ligacoes: 400, v1: 100, v2: 58, captacoes: 29 };
  it("aponta a etapa >= 30% abaixo da equipe, com dica fixa", () => {
    // V1→V2: 8/25 = 32% × equipe 58% → queda 45%
    const g = gargalo({ ligacoes: 100, v1: 25, v2: 8, captacoes: 4 }, equipe);
    expect(g.tipo).toBe("gargalo");
    if (g.tipo !== "gargalo") return;
    expect(g.etapa).toBe("v1_v2");
    expect(g.texto).toBe("de V1 para V2. Você converte 32%, a equipe 58%.");
    expect(g.dica).toBe(DICA_ETAPA.v1_v2);
  });
  it("menos de 5 no início da etapa: não aponta; nenhuma etapa com 5: 'pouco dado ainda'", () => {
    expect(gargalo({ ligacoes: 4, v1: 0, v2: 0, captacoes: 0 }, equipe)).toEqual({
      tipo: "pouco_dado",
      texto: "pouco dado ainda",
    });
    // V1→V2 seria gargalo, mas só 4 V1
    expect(gargalo({ ligacoes: 16, v1: 4, v2: 0, captacoes: 0 }, equipe).tipo).toBe("sem_gargalo");
  });
  it("exatamente 30% abaixo aponta; 29% não", () => {
    // equipe lig→V1 = 25%. 30% abaixo = 17,5%: 7/40 = 17,5%
    expect(
      gargalo({ ligacoes: 40, v1: 7, v2: 5, captacoes: 3 }, { ...equipe, ligacoes: 400, v1: 100 })
        .tipo,
    ).toBe("gargalo");
    // 71/400 = 17,75% → queda 29% (V1→V2 71→41 = 58% igual à equipe)
    expect(
      gargalo(
        { ligacoes: 400, v1: 71, v2: 41, captacoes: 21 },
        { ...equipe, ligacoes: 400, v1: 100 },
      ).tipo,
    ).toBe("sem_gargalo");
  });
  it("entre várias quedas, aponta a maior; equipe sem dado na etapa não conta", () => {
    const g = gargalo({ ligacoes: 100, v1: 10, v2: 2, captacoes: 1 }, equipe);
    expect(g.tipo === "gargalo" && g.etapa).toBe("v1_v2"); // lig→V1 queda 60%, V1→V2 queda 66%
    expect(
      gargalo(
        { ligacoes: 100, v1: 10, v2: 2, captacoes: 1 },
        { ligacoes: 0, v1: 0, v2: 0, captacoes: 0 },
      ).tipo,
    ).toBe("sem_gargalo");
  });
});

describe("previsão do trimestre", () => {
  it("trimestre civil e meses que faltam", () => {
    expect(trimestreDe("2026-11-08")).toMatchObject({
      numero: 4,
      meses: ["2026-10", "2026-11", "2026-12"],
      inicio: "2026-10-01",
      fim: "2026-12-31",
      mesesRestantes: 1,
    });
    expect(trimestreDe("2026-01-31").mesesRestantes).toBe(2);
    expect(trimestreDe("2026-06-30")).toMatchObject({
      numero: 2,
      fim: "2026-06-30",
      mesesRestantes: 0,
    });
  });
  it("recebido + 80% do andamento + 50% do ritmo × meses que faltam, com a frase", () => {
    const p = previsaoTrimestre({
      recebido: 300000,
      andamento: 200000,
      ritmoMensal: 160000,
      mesesRestantes: 1,
      meta: 600000,
    });
    expect(p.valor).toBe(300000 + 160000 + 80000);
    expect(p.pctMeta).toBe(90);
    expect(p.frase).toMatch(
      /^= R\$\s?300\.000 já recebidos \+ 80% de R\$\s?200\.000 em vendas em andamento/,
    );
    expect(p.frase).toMatch(/metade do ritmo médio \(R\$\s?160\.000\/mês\) × 1 mês que falta\.$/);
  });
  it("sem meta: só o valor; último mês: sem a parte do ritmo; valores inválidos viram 0", () => {
    const p = previsaoTrimestre({
      recebido: 100,
      andamento: 100,
      ritmoMensal: 100,
      mesesRestantes: 0,
      meta: null,
    });
    expect(p.valor).toBe(180);
    expect(p.meta).toBeNull();
    expect(p.pctMeta).toBeNull();
    expect(p.frase).not.toMatch(/ritmo/);
    expect(
      previsaoTrimestre({
        recebido: NaN,
        andamento: -5,
        ritmoMensal: 0,
        mesesRestantes: 2,
        meta: 0,
      }).valor,
    ).toBe(0);
  });
});

describe("conversa 1:1", () => {
  it("próxima sugerida em 14 dias (também na virada de mês/ano)", () => {
    expect(proximaSugerida("2026-11-08")).toBe("2026-11-22");
    expect(proximaSugerida("2026-12-25")).toBe("2027-01-08");
  });
  it("atrasada quando a próxima data já passou", () => {
    expect(umAUmAtrasada("2026-11-07", HOJE)).toBe(true);
    expect(umAUmAtrasada("2026-11-08", HOJE)).toBe(false);
    expect(umAUmAtrasada(null, HOJE)).toBe(false);
  });
  it("combinados: vazios fora, texto cortado em 300, no máximo 20", () => {
    const c = normalizarCombinados([
      { texto: "  Ligar 20  " },
      { texto: " " },
      { texto: "x".repeat(400), feito: true },
    ]);
    expect(c).toEqual([
      { texto: "Ligar 20", feito: null },
      { texto: "x".repeat(300), feito: true },
    ]);
    expect(
      normalizarCombinados(Array.from({ length: 25 }, (_, i) => ({ texto: `c${i}` }))),
    ).toHaveLength(20);
  });
  it("pauta: números, sinais acesos, pendências e combinados anteriores com feito/não feito", () => {
    const p = montarPauta({
      numeros: { vgc_mes: 12000 },
      farol: { acesos: [{ chave: "leads", cor: "vermelho", texto: "2 leads sem resposta" }] },
      pendencias: [{ kind: "vencendo", imovel: "Casa — Centro", detalhe: "Exclusividade vencida" }],
      anteriores: [{ texto: "Ligar 20", feito: false }],
    });
    expect(p).toEqual({
      versao: 1,
      numeros: { vgc_mes: 12000 },
      sinais: [{ chave: "leads", cor: "vermelho", texto: "2 leads sem resposta" }],
      pendencias: [{ kind: "vencendo", imovel: "Casa — Centro", detalhe: "Exclusividade vencida" }],
      combinados_anteriores: [{ texto: "Ligar 20", feito: false }],
    });
  });
});

describe("migration 20261108180000", () => {
  const MIG = readFileSync(
    new URL("../../supabase/migrations/20261108180000_inteligencia_gestao.sql", import.meta.url),
    "utf8",
  );
  const RB = readFileSync(
    new URL("../../supabase/rollback/20261108180000_inteligencia_gestao.sql", import.meta.url),
    "utf8",
  );
  it("CHECK e lista da RPC iguais à lista do código", () => {
    const nomes = (x: string) => [...x.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();
    const check = MIG.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "";
    const rpc = MIG.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "";
    // link_acompanhamento (t_54c79bdc) veio depois, na migration 20261108200000.
    // proposta_compra (t_4cff61a6) veio depois, na migration 20261109120000.
    const lista = [...ORGANIZATION_MODULES]
      .filter((x) => x !== "link_acompanhamento" && x !== "proposta_compra" && x !== "locacao")
      .sort();
    expect(nomes(check)).toEqual(lista);
    expect(nomes(rpc)).toEqual(lista);
  });
  it("nasce desligado (sem seed) e o rollback tira a chave", () => {
    // O único INSERT em organization_modules é o da RPC do super-admin (valores por parâmetro, sem seed).
    expect(MIG.match(/INSERT INTO public\.organization_modules/g)).toHaveLength(1);
    expect(MIG).toMatch(/VALUES \(_org, _module, _enabled, now\(\), _actor\)/);
    expect(RB).toMatch(
      /DELETE FROM public\.organization_modules WHERE module = 'inteligencia_gestao'/,
    );
    expect(RB).not.toMatch(/'inteligencia_gestao'\)\)/);
  });
  it("próxima 1:1 = +14 dias por padrão; tabela com RLS restritiva por imobiliária e módulo", () => {
    expect(MIG).toMatch(
      /proxima_data date NOT NULL DEFAULT \(\(now\(\) AT TIME ZONE 'America\/Sao_Paulo'\)::date \+ 14\)/,
    );
    expect(MIG).toMatch(/_prox := coalesce\(_proxima, _data \+ 14\)/);
    expect(MIG).toMatch(
      /CREATE POLICY org_isolation ON public\.gestao_conversas_1a1 AS RESTRICTIVE FOR ALL/,
    );
    expect(MIG).toMatch(
      /CREATE POLICY modulo_ligado ON public\.gestao_conversas_1a1 AS RESTRICTIVE FOR ALL/,
    );
  });
  it("minhas_pendencias mantém a assinatura; o corpo antigo vai inteiro para carreira_pendencias_de", () => {
    const antigo = readFileSync(
      new URL(
        "../../supabase/migrations/20261029200000_captacao_data_assinatura_pdf.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const corpo = (sql: string, de: string) => {
      const i = sql.indexOf("RETURN QUERY", sql.indexOf(de));
      return sql.slice(i, sql.indexOf("END $function$;", i)).replace(/\s+/g, " ");
    };
    expect(corpo(MIG, "FUNCTION public.carreira_pendencias_de")).toBe(
      corpo(antigo, "FUNCTION public.minhas_pendencias"),
    );
    expect(corpo(RB, "FUNCTION public.minhas_pendencias")).toBe(
      corpo(antigo, "FUNCTION public.minhas_pendencias"),
    );
  });
});
