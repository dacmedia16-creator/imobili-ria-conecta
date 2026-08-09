/**
 * Suíte de integração das regras financeiras — chama as RPCs reais (calcular_distribuicao_venda,
 * sync_occurrence_commissions, visao_executiva_stats, metas_progresso) contra o Supabase do projeto
 * (mesmo processo usado manualmente durante o desenvolvimento: INSERT de vendas de teste marcadas
 * com codigo_interno único, nunca UPDATE — trg_sales_comissao_lock/trg_validate_sale_status bloqueiam
 * UPDATE fora do fluxo autenticado da tela, mas não bloqueiam INSERT). Cada teste cria seus próprios
 * dados e limpa tudo no final, mesmo se a asserção falhar.
 *
 * Os valores do CENÁRIO BASE abaixo são só dados de um teste, não regras fixas — os cálculos em si
 * são variáveis por natureza (não existe percentual padrão de captador/vendedor/gestor/indicador).
 *
 * ranking_corretor e metas_progresso agregam TODAS as vendas do período no banco compartilhado (não
 * só as deste teste) — por isso os testes que os usam comparam ANTES/DEPOIS (delta), nunca um valor
 * absoluto. Isso evita falso-negativo/positivo por causa de dados reais de produção no mesmo período,
 * sem deixar de comparar números explicitamente (nada de snapshot).
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const HAS_SUPABASE_ADMIN_ENV = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// Formato de retorno das RPCs (jsonb) — só os campos usados nesta suíte, não o schema inteiro.
type Distribuicao = {
  comissao_bruta: number;
  parceria_externa: number;
  parte_remax: number | null;
  comissao_bruta_captador: number;
  comissao_bruta_vendedor: number;
  indicador_captador: number;
  indicador_vendedor: number;
  liquido_captador: number;
  liquido_vendedor: number;
  gestores_team_leaders: number;
  outros_extras: number;
  descontos_extra_captador: number;
  descontos_extra_vendedor: number;
  descontos_extra_imobiliaria: number;
  saldo_inicial_imobiliaria: number;
  saldo_liquido_imobiliaria: number;
  diferenca_restante: number;
  inconsistencias: string[];
  calculo_valido: boolean;
};
type VisaoExecutivaStats = {
  ranking_corretor: { corretor_id: string; comissao: number }[];
  ranking_equipe: { team_id: string | null; comissao: number }[];
  resumo_operacional: { vgv: number; comissao_bruta_operacao: number; parceria_externa: number; parte_unidade: number; receita_liquida_imobiliaria: number; quantidade_vendas: number; quantidade_captacoes: number };
};
type MetasProgresso = { corretor: { corretor_id: string; comissao_realizada: number }[] };

describe.skipIf(!HAS_SUPABASE_ADMIN_ENV)("Regras financeiras (integração via RPCs reais)", () => {
  let supabaseAdmin: typeof import("@/integrations/supabase/client.server").supabaseAdmin;
  let PROFILES: string[] = [];
  const createdSaleIds: string[] = [];
  const createdMetaIds: string[] = [];

  beforeAll(async () => {
    ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));
    const { data, error } = await supabaseAdmin.from("profiles").select("id").limit(6);
    if (error) throw error;
    PROFILES = (data ?? []).map((p) => p.id);
    if (PROFILES.length < 5) {
      throw new Error("Preciso de pelo menos 5 profiles cadastrados pra rodar a suíte de integração das regras financeiras.");
    }
  }, 30000);

  afterEach(async () => {
    while (createdSaleIds.length > 0) {
      const saleId = createdSaleIds.pop()!;
      const { data: occs } = await supabaseAdmin.from("occurrences").select("id").eq("sale_id", saleId);
      const occIds = (occs ?? []).map((o) => o.id);
      if (occIds.length > 0) {
        await supabaseAdmin.from("occurrence_commissions").delete().in("occurrence_id", occIds);
      }
      await supabaseAdmin.from("occurrences").delete().eq("sale_id", saleId);
      await supabaseAdmin.from("sale_commission_extras").delete().eq("sale_id", saleId);
      await supabaseAdmin.from("sale_status_history").delete().eq("sale_id", saleId);
      await supabaseAdmin.from("sales").delete().eq("id", saleId);
    }
    while (createdMetaIds.length > 0) {
      await supabaseAdmin.from("metas").delete().eq("id", createdMetaIds.pop()!);
    }
  }, 30000);

  // ---- Helpers ----

  const codigoTeste = () => `TESTE-VITEST-${randomUUID()}`;

  // As tabelas de venda têm dezenas de campos financeiros opcionais — cada teste só precisa preencher
  // um subconjunto pequeno e variável deles. Tipar "overrides" estritamente como TablesInsert<"sales">
  // obrigaria repetir os campos obrigatórios em todo call site; "any" aqui é o mesmo tipo de bag livre
  // já usado nos `patch: any` das telas reais (vendas.$id.tsx) — não é um tipo de dado desconhecido,
  // é uma composição parcial deliberada.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function criarVenda(overrides: Record<string, any> = {}) {
    const { data, error } = await supabaseAdmin
      .from("sales")
      .insert({ corretor_id: PROFILES[0], status: "contrato_assinado", codigo_interno: codigoTeste(), ...overrides })
      .select("id")
      .single();
    if (error) throw error;
    createdSaleIds.push(data.id);
    return data.id as string;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function criarExtra(saleId: string, overrides: Record<string, any>) {
    const { error } = await supabaseAdmin.from("sale_commission_extras").insert({ sale_id: saleId, ...overrides });
    if (error) throw error;
  }

  async function distribuicao(saleId: string) {
    const { data, error } = await supabaseAdmin.rpc("calcular_distribuicao_venda", { p_sale_id: saleId });
    if (error) throw error;
    return data as unknown as Distribuicao;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function criarOcorrencia(saleId: string, overrides: Record<string, any> = {}) {
    const { data, error } = await supabaseAdmin
      .from("occurrences")
      .insert({ sale_id: saleId, status: "concluida", data_assinatura: new Date().toISOString().slice(0, 10), ...overrides })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function sync(saleId: string) {
    const { error } = await supabaseAdmin.rpc("sync_occurrence_commissions", { _sale_id: saleId });
    if (error) throw error;
  }

  async function fecharVendaNoPeriodo(saleId: string, diasAtras = 2) {
    const data = new Date();
    data.setDate(data.getDate() - diasAtras);
    const { error } = await supabaseAdmin
      .from("sale_status_history")
      .insert({ sale_id: saleId, para: "contrato_assinado", created_at: data.toISOString() });
    if (error) throw error;
  }

  async function visaoExecutiva() {
    const { data, error } = await supabaseAdmin.rpc("visao_executiva_stats");
    if (error) throw error;
    return data as unknown as VisaoExecutivaStats;
  }

  async function comissaoRankingCorretor(userId: string) {
    const stats = await visaoExecutiva();
    const row = (stats.ranking_corretor ?? []).find((r) => r.corretor_id === userId);
    return row ? Number(row.comissao) : 0;
  }

  async function comissaoRankingEquipe(teamId: string) {
    const stats = await visaoExecutiva();
    const row = (stats.ranking_equipe ?? []).find((r) => r.team_id === teamId);
    return row ? Number(row.comissao) : 0;
  }

  async function resumoOperacional() {
    const stats = await visaoExecutiva();
    return stats.resumo_operacional;
  }

  async function metasProgressoCorretor(userId: string, mes = new Date().toISOString().slice(0, 8) + "01") {
    const { data, error } = await supabaseAdmin.rpc("metas_progresso", { _mes: mes });
    if (error) throw error;
    const row = ((data as unknown as MetasProgresso).corretor ?? []).find((r) => r.corretor_id === userId);
    return row ? Number(row.comissao_realizada) : 0;
  }

  // Cenário base do pedido: venda R$730.000, comissão 6% (R$43.800), parceria 3% (R$21.900), parte
  // RE/MAX 3% (R$21.900), captador/vendedor R$4.927,50 cada. Saldo inicial da imobiliária: R$12.045.
  const CENARIO_BASE = {
    valor_negociado: 730000,
    percentual_comissao: 6,
    parceria_tipo: "imobiliaria_externa",
    parceria_percentual: 3,
    percentual_remax: 3,
    valor_comissao_captador: 4927.5,
    valor_comissao_vendedor: 4927.5,
  };

  // ---- Regra 1: comissão sobre o valor negociado ----
  it("regra 1 — comissão bruta = percentual × valor negociado", async () => {
    const saleId = await criarVenda({ valor_negociado: 730000, percentual_comissao: 6 });
    const dist = await distribuicao(saleId);
    expect(dist.comissao_bruta).toBe(43800);
  });

  // ---- Regra 2: parceria externa ----
  it("regra 2 — parceria externa = percentual × valor negociado, nunca receita da unidade", async () => {
    const saleId = await criarVenda({ valor_negociado: 730000, parceria_tipo: "imobiliaria_externa", parceria_percentual: 3 });
    const dist = await distribuicao(saleId);
    expect(dist.parceria_externa).toBe(21900);
  });

  // ---- Regra 3: parte da RE/MAX/unidade ----
  it("regra 3 — parte da unidade = percentual REMAX × negociado; saldo inicial = parte da unidade − captador − vendedor", async () => {
    const saleId = await criarVenda({ ...CENARIO_BASE, parceria_tipo: null, parceria_percentual: null });
    const dist = await distribuicao(saleId);
    expect(dist.parte_remax).toBe(21900);
    expect(dist.saldo_inicial_imobiliaria).toBe(12045);
  });

  // ---- Regra 4: valores variáveis de captador e vendedor ----
  it("regra 4 — captador e vendedor são valores livres em reais, nunca um percentual fixo", async () => {
    const saleAId = await criarVenda({ ...CENARIO_BASE, valor_comissao_captador: 3000, valor_comissao_vendedor: 7000 });
    const saleBId = await criarVenda({ ...CENARIO_BASE, valor_comissao_captador: 9500, valor_comissao_vendedor: 500 });
    const distA = await distribuicao(saleAId);
    const distB = await distribuicao(saleBId);
    expect(distA.comissao_bruta_captador).toBe(3000);
    expect(distA.comissao_bruta_vendedor).toBe(7000);
    expect(distB.comissao_bruta_captador).toBe(9500);
    expect(distB.comissao_bruta_vendedor).toBe(500);
  });

  // ---- Regra 5: gestor saindo da imobiliária ----
  it("regra 5 — gestor é descontado do saldo da imobiliária, nunca do captador/vendedor", async () => {
    const saleId = await criarVenda(CENARIO_BASE);
    await criarExtra(saleId, { papel: "gestor", origem: "imobiliaria", valor: 1000, nome: "Gestor Teste", user_id: PROFILES[4] });
    const dist = await distribuicao(saleId);
    expect(dist.gestores_team_leaders).toBe(1000);
    expect(dist.saldo_liquido_imobiliaria).toBe(11045); // 12045 - 1000
    expect(dist.liquido_captador).toBe(4927.5); // gestor não desconta do captador
    expect(dist.liquido_vendedor).toBe(4927.5); // nem do vendedor
  });

  it("regra 5b — gestor só pode ter origem imobiliária (constraint do banco)", async () => {
    const saleId = await criarVenda(CENARIO_BASE);
    await expect(criarExtra(saleId, { papel: "gestor", origem: "captador", valor: 1000, nome: "Gestor Inválido" })).rejects.toBeTruthy();
  });

  // ---- Regra 6: Team Leader saindo da imobiliária ----
  it("regra 6 — Team Leader é descontado do saldo da imobiliária, nunca do captador/vendedor", async () => {
    const saleId = await criarVenda(CENARIO_BASE);
    await criarExtra(saleId, { papel: "team_leader", origem: "imobiliaria", valor: 700, nome: "TL Teste", user_id: PROFILES[4] });
    const dist = await distribuicao(saleId);
    expect(dist.gestores_team_leaders).toBe(700);
    expect(dist.saldo_liquido_imobiliaria).toBe(12045 - 700);
    expect(dist.liquido_captador).toBe(4927.5);
    expect(dist.liquido_vendedor).toBe(4927.5);
  });

  // ---- Regra 7: indicador do captador saindo do captador ----
  it("regra 7 — indicador do captador desconta do captador, não da imobiliária", async () => {
    const saleId = await criarVenda({ ...CENARIO_BASE, valor_comissao_indicador_captador: 500 });
    const dist = await distribuicao(saleId);
    expect(dist.indicador_captador).toBe(500);
    expect(dist.liquido_captador).toBe(4427.5); // 4927.50 - 500
    expect(dist.saldo_inicial_imobiliaria).toBe(12045); // não mexe na imobiliária
  });

  // ---- Regra 8: indicador do vendedor saindo do vendedor ----
  it("regra 8 — indicador do vendedor desconta do vendedor, não da imobiliária", async () => {
    const saleId = await criarVenda({ ...CENARIO_BASE, valor_comissao_indicador_vendedor: 300 });
    const dist = await distribuicao(saleId);
    expect(dist.indicador_vendedor).toBe(300);
    expect(dist.liquido_vendedor).toBe(4627.5); // 4927.50 - 300
    expect(dist.saldo_inicial_imobiliaria).toBe(12045);
  });

  // ---- Regra 9: outros extras respeitando a origem ----
  it("regra 9 — extras 'outro' descontam exatamente da origem gravada (captador/vendedor/imobiliária)", async () => {
    const saleId = await criarVenda(CENARIO_BASE);
    await criarExtra(saleId, { papel: "outro", origem: "captador", valor: 200, nome: "Extra captador" });
    await criarExtra(saleId, { papel: "outro", origem: "vendedor", valor: 150, nome: "Extra vendedor" });
    await criarExtra(saleId, { papel: "outro", origem: "imobiliaria", valor: 300, nome: "Extra imobiliária" });
    const dist = await distribuicao(saleId);
    expect(dist.descontos_extra_captador).toBe(200);
    expect(dist.descontos_extra_vendedor).toBe(150);
    expect(dist.descontos_extra_imobiliaria).toBe(300);
    expect(dist.outros_extras).toBe(650);
    expect(dist.liquido_captador).toBe(4727.5); // 4927.50 - 200
    expect(dist.liquido_vendedor).toBe(4777.5); // 4927.50 - 150
    expect(dist.saldo_liquido_imobiliaria).toBe(12045 - 300);
  });

  // ---- Regra 10: remoção de comissão após criação da Ocorrência ----
  it("regra 10 — remover um extra depois de sincronizado remove a linha correspondente em occurrence_commissions", async () => {
    const saleId = await criarVenda(CENARIO_BASE);
    await criarOcorrencia(saleId, { valor_comissao: 43800 });
    const { data: extraRows, error: extraErr } = await supabaseAdmin
      .from("sale_commission_extras")
      .insert({ sale_id: saleId, papel: "outro", origem: "imobiliaria", valor: 300, nome: "Extra removível" })
      .select("id")
      .single();
    if (extraErr) throw extraErr;
    const extraId = extraRows.id as string;

    await sync(saleId);
    const antes = await supabaseAdmin.from("occurrence_commissions").select("id, valor").eq("sale_commission_extra_id", extraId).maybeSingle();
    expect(antes.data?.valor).toBe(300);

    await supabaseAdmin.from("sale_commission_extras").delete().eq("id", extraId);
    await sync(saleId);
    const depois = await supabaseAdmin.from("occurrence_commissions").select("id").eq("sale_commission_extra_id", extraId).maybeSingle();
    expect(depois.data).toBeNull();
  });

  // ---- Regra 12: venda cancelada ----
  it("regra 12 — venda cancelada não entra no ranking da Visão Executiva mesmo com comissão sincronizada", async () => {
    const captadorId = PROFILES[1];
    const antes = await comissaoRankingCorretor(captadorId);
    const saleId = await criarVenda({ ...CENARIO_BASE, status: "cancelada", corretor_captador_id: captadorId, corretor_captador: "Captador Cancelado" });
    await fecharVendaNoPeriodo(saleId);
    await criarOcorrencia(saleId, { valor_comissao: 43800 });
    await sync(saleId);
    const depois = await comissaoRankingCorretor(captadorId);
    expect(depois - antes).toBe(0);
  });

  // ---- Regra 13: venda arquivada ----
  it("regra 13 — venda arquivada não entra no ranking da Visão Executiva mesmo com comissão sincronizada", async () => {
    const captadorId = PROFILES[1];
    const antes = await comissaoRankingCorretor(captadorId);
    const saleId = await criarVenda({ ...CENARIO_BASE, status: "arquivada", corretor_captador_id: captadorId, corretor_captador: "Captador Arquivado" });
    await fecharVendaNoPeriodo(saleId);
    await criarOcorrencia(saleId, { valor_comissao: 43800 });
    await sync(saleId);
    const depois = await comissaoRankingCorretor(captadorId);
    expect(depois - antes).toBe(0);
  });

  // ---- Regra 14: venda reaberta ----
  it("regra 14 — venda cancelada e reaberta (status atual voltou a ativo) volta a contar no ranking", async () => {
    const captadorId = PROFILES[1];
    const antes = await comissaoRankingCorretor(captadorId);
    const saleId = await criarVenda({ ...CENARIO_BASE, status: "contrato_assinado", corretor_captador_id: captadorId, corretor_captador: "Captador Reaberto" });
    // Histórico real de uma reabertura: cancelou há 10 dias, reabriu e assinou de novo há 2 dias.
    const cancelou = new Date(); cancelou.setDate(cancelou.getDate() - 10);
    await supabaseAdmin.from("sale_status_history").insert({ sale_id: saleId, para: "cancelada", created_at: cancelou.toISOString() });
    await fecharVendaNoPeriodo(saleId, 2);
    await criarOcorrencia(saleId, { valor_comissao: 43800 });
    await sync(saleId);
    const depois = await comissaoRankingCorretor(captadorId);
    expect(depois - antes).toBe(4927.5); // líquido do captador reaparece, pois o status ATUAL é ativo
  });

  // ---- Regra 16: parceria maior que a comissão ----
  it("regra 16 — parceria maior que a comissão bruta é sinalizada como inconsistência, não aceita silenciosamente", async () => {
    const saleId = await criarVenda({ valor_negociado: 730000, percentual_comissao: 6, parceria_tipo: "imobiliaria_externa", parceria_valor: 60000 });
    const dist = await distribuicao(saleId);
    expect(dist.calculo_valido).toBe(false);
    expect(dist.inconsistencias.some((m: string) => m.includes("parceria externa ultrapassa a comissão bruta"))).toBe(true);
  });

  // ---- Regra 17: saldos negativos ----
  it("regra 17a — indicador maior que a comissão do captador deixa o líquido negativo e é sinalizado", async () => {
    const saleId = await criarVenda({ valor_negociado: 730000, valor_comissao_captador: 1000, valor_comissao_indicador_captador: 1500 });
    const dist = await distribuicao(saleId);
    expect(dist.liquido_captador).toBe(-500);
    expect(dist.calculo_valido).toBe(false);
    expect(dist.inconsistencias.some((m: string) => m.includes("líquido do captador ficou negativo"))).toBe(true);
  });

  it("regra 17b — gestor/extras maiores que o saldo da imobiliária deixam o saldo líquido negativo e é sinalizado", async () => {
    const saleId = await criarVenda(CENARIO_BASE); // saldo inicial 12045
    await criarExtra(saleId, { papel: "gestor", origem: "imobiliaria", valor: 20000, nome: "Gestor Excedente" });
    const dist = await distribuicao(saleId);
    expect(dist.saldo_liquido_imobiliaria).toBe(12045 - 20000);
    expect(dist.calculo_valido).toBe(false);
    expect(dist.inconsistencias.some((m: string) => m.includes("ultrapassam o saldo disponível"))).toBe(true);
  });

  // ---- Regra 18: arredondamento ----
  it("regra 18a — cenário oficial completo bate exatamente (diferença zero, cálculo válido)", async () => {
    const saleId = await criarVenda({ ...CENARIO_BASE, valor_comissao_indicador_captador: 500, valor_comissao_indicador_vendedor: 300 });
    await criarExtra(saleId, { papel: "gestor", origem: "imobiliaria", valor: 1000, nome: "Gestor Teste", user_id: PROFILES[4] });
    const dist = await distribuicao(saleId);
    expect(dist.liquido_captador).toBe(4427.5);
    expect(dist.liquido_vendedor).toBe(4627.5);
    expect(dist.saldo_liquido_imobiliaria).toBe(11045);
    expect(dist.diferenca_restante).toBe(0);
    expect(dist.calculo_valido).toBe(true);
  });

  it("regra 18b — diferença de até R$0,01 é tolerada; a partir de R$0,02 é sinalizada", async () => {
    // percentual_comissao null + valor_total_comissao fixo em reais: comissao_bruta passa a ser
    // controlada diretamente, independente da soma captador+vendedor+saldo+parceria (que dá 43800).
    const baseSemPercentual = { ...CENARIO_BASE, percentual_comissao: null };
    const saleTolerado = await criarVenda({ ...baseSemPercentual, valor_total_comissao: 43800.01 });
    const distTolerado = await distribuicao(saleTolerado);
    expect(distTolerado.diferenca_restante).toBe(0.01);
    expect(distTolerado.calculo_valido).toBe(true);

    const saleFlagrado = await criarVenda({ ...baseSemPercentual, valor_total_comissao: 43800.02 });
    const distFlagrado = await distribuicao(saleFlagrado);
    expect(distFlagrado.diferenca_restante).toBe(0.02);
    expect(distFlagrado.calculo_valido).toBe(false);
  });

  // ---- Regra 19: ranking com criador, captador e vendedor diferentes ----
  it("regra 19 — quem criou a venda no sistema não recebe a comissão de quem participou de fato", async () => {
    const criadorId = PROFILES[0];
    const captadorId = PROFILES[1];
    const vendedorId = PROFILES[2];
    const [criadorAntes, captadorAntes, vendedorAntes] = await Promise.all([
      comissaoRankingCorretor(criadorId), comissaoRankingCorretor(captadorId), comissaoRankingCorretor(vendedorId),
    ]);

    const saleId = await criarVenda({
      ...CENARIO_BASE, corretor_id: criadorId,
      corretor_captador_id: captadorId, corretor_captador: "Captador Teste",
      corretor_vendedor_id: vendedorId, corretor_vendedor: "Vendedor Teste",
    });
    await fecharVendaNoPeriodo(saleId);
    await criarOcorrencia(saleId, { valor_comissao: 43800 });
    await sync(saleId);

    const [criadorDepois, captadorDepois, vendedorDepois] = await Promise.all([
      comissaoRankingCorretor(criadorId), comissaoRankingCorretor(captadorId), comissaoRankingCorretor(vendedorId),
    ]);

    expect(criadorDepois - criadorAntes).toBe(0); // criador não participou financeiramente — não aparece
    expect(captadorDepois - captadorAntes).toBe(4927.5);
    expect(vendedorDepois - vendedorAntes).toBe(4927.5);
  });

  // ---- Regra 20: corretor com mais de um vínculo de equipe ----
  it("regra 20a — team_members.membro_id é único: um segundo vínculo pro mesmo corretor é rejeitado pelo banco", async () => {
    const { data: existente, error } = await supabaseAdmin.from("team_members").select("membro_id, team_id").limit(1).maybeSingle();
    if (error) throw error;
    if (!existente) return; // sem nenhum vínculo cadastrado ainda — nada pra verificar aqui.
    const { error: dupError } = await supabaseAdmin.from("team_members").insert({ membro_id: existente.membro_id, team_id: existente.team_id, tipo: "membro" });
    expect(dupError).toBeTruthy();
    expect(dupError?.code).toBe("23505");
  });

  it("regra 20b — a comissão do corretor cai inteira e uma única vez na equipe dele, sem duplicar", async () => {
    const { data: membro, error } = await supabaseAdmin.from("team_members").select("membro_id, team_id").limit(1).maybeSingle();
    if (error) throw error;
    if (!membro) return; // ambiente sem equipes cadastradas — regra não observável aqui.

    const [corretorAntes, equipeAntes] = await Promise.all([
      comissaoRankingCorretor(membro.membro_id), comissaoRankingEquipe(membro.team_id),
    ]);

    const saleId = await criarVenda({ ...CENARIO_BASE, corretor_captador_id: membro.membro_id, corretor_captador: "Membro de Equipe Teste" });
    await fecharVendaNoPeriodo(saleId);
    await criarOcorrencia(saleId, { valor_comissao: 43800 });
    await sync(saleId);

    const [corretorDepois, equipeDepois] = await Promise.all([
      comissaoRankingCorretor(membro.membro_id), comissaoRankingEquipe(membro.team_id),
    ]);

    const deltaCorretor = corretorDepois - corretorAntes;
    const deltaEquipe = equipeDepois - equipeAntes;
    expect(deltaCorretor).toBe(4927.5);
    expect(deltaEquipe).toBe(deltaCorretor); // mesma origem, sem duplicar em outra equipe
  });

  // ---- Regra 21: consistência entre Resumo, Ocorrência, Relatórios e Visão Executiva ----
  it("regra 21 — Resumo/Ocorrência (RPC) e Visão Executiva (ranking) concordam sobre a mesma venda", async () => {
    const captadorId = PROFILES[1];
    const vendedorId = PROFILES[2];

    // metas_progresso() só devolve linha pra quem tem meta cadastrada no mês — sem isso o captador
    // simplesmente não apareceria no array 'corretor', mesmo tendo comissão real no período.
    const mesAtual = new Date().toISOString().slice(0, 8) + "01";
    const { data: metaRow, error: metaErr } = await supabaseAdmin
      .from("metas")
      .insert({ tipo: "corretor", corretor_id: captadorId, mes: mesAtual, meta_comissao: 1 })
      .select("id")
      .single();
    if (metaErr) throw metaErr;
    createdMetaIds.push(metaRow.id);

    const [captadorAntes, vendedorAntes, resumoAntes, metaCaptadorAntes] = await Promise.all([
      comissaoRankingCorretor(captadorId), comissaoRankingCorretor(vendedorId), resumoOperacional(), metasProgressoCorretor(captadorId),
    ]);

    const saleId = await criarVenda({
      ...CENARIO_BASE,
      corretor_captador_id: captadorId, corretor_captador: "Captador Consistência",
      corretor_vendedor_id: vendedorId, corretor_vendedor: "Vendedor Consistência",
    });
    await criarExtra(saleId, { papel: "gestor", origem: "imobiliaria", valor: 1000, nome: "Gestor Consistência", user_id: PROFILES[4] });
    const dist = await distribuicao(saleId); // fonte usada por Resumo e Ocorrência
    const occId = await criarOcorrencia(saleId, { valor_comissao: dist.comissao_bruta });
    await sync(saleId);
    await fecharVendaNoPeriodo(saleId);

    // Resumo/Ocorrência: occurrence_commissions grava exatamente o líquido calculado pela RPC.
    const { data: linhaCaptador } = await supabaseAdmin.from("occurrence_commissions").select("valor").eq("occurrence_id", occId).eq("papel", "corretor_captador").single();
    const { data: linhaVendedor } = await supabaseAdmin.from("occurrence_commissions").select("valor").eq("occurrence_id", occId).eq("papel", "corretor_vendedor").single();
    expect(Number(linhaCaptador?.valor)).toBe(dist.liquido_captador);
    expect(Number(linhaVendedor?.valor)).toBe(dist.liquido_vendedor);

    // Visão Executiva: o ranking do captador/vendedor bate com o mesmo líquido gravado acima.
    const [captadorDepois, vendedorDepois, resumoDepois, metaCaptadorDepois] = await Promise.all([
      comissaoRankingCorretor(captadorId), comissaoRankingCorretor(vendedorId), resumoOperacional(), metasProgressoCorretor(captadorId),
    ]);
    expect(captadorDepois - captadorAntes).toBe(dist.liquido_captador);
    expect(vendedorDepois - vendedorAntes).toBe(dist.liquido_vendedor);
    // Metas (coluna "Meta do mês", ao lado da coluna "Comissão" na mesma tela): mesma atribuição por
    // pessoa, mesmo líquido — não pode divergir do ranking_corretor acima.
    expect(metaCaptadorDepois - metaCaptadorAntes).toBe(dist.liquido_captador);

    // resumo_operacional (mesma tela) usa a mesma calcular_distribuicao_venda() por baixo — os
    // agregados da operação também batem com o que a RPC calculou pra essa venda especificamente.
    expect(resumoDepois.comissao_bruta_operacao - resumoAntes.comissao_bruta_operacao).toBe(dist.comissao_bruta);
    expect(resumoDepois.receita_liquida_imobiliaria - resumoAntes.receita_liquida_imobiliaria).toBe(dist.saldo_liquido_imobiliaria);
  });
});
