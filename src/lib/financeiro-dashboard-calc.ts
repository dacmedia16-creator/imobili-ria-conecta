/**
 * Fórmulas puras da Central Financeira — nenhuma função aqui fala com o Supabase, todas
 * testáveis com dados soltos. Fonte única pra cards, tabelas, gráficos e CSV: nada é calculado
 * duas vezes com regras divergentes (ver PROMPT_ADM_MAX_CENTRAL_FINANCEIRA.md, item 13).
 */
import type {
  AgingBucketKey,
  AgingFaixa,
  AgrupamentoComissao,
  ClassificacaoVinculoBeneficiario,
  ComissaoCalculada,
  EfetivacaoVenda,
  FinanceiroFiltros,
  GrupoComissao,
  OrigemComissao,
  ParcelaRecebimento,
  ResumoFinanceiro,
  SituacaoParcela,
  SituacaoRecebimentoVenda,
} from "@/lib/financeiro-dashboard-types";
import {
  AGING_A_VENCER_ORDEM,
  AGING_BUCKET_LABEL,
  AGING_VENCIDO_ORDEM,
} from "@/lib/financeiro-dashboard-types";

/** Mesmo papel de `podeAcessarComparativo6pct` (comparativo-comissao-calc.ts) pro Comparativo 6% —
 * fonte única do controle de acesso à Central Financeira, usada tanto pelo item de menu
 * (AppShell.tsx) quanto pelo `beforeLoad` da rota (financeiro.tsx), pra nunca divergir. A checagem
 * de verdade contra dado de sessão real (login + user_roles) continua só no `beforeLoad` — essa
 * função é a parte pura/testável da regra, sem rede nem banco. */
const PAPEIS_COM_ACESSO_FINANCEIRO = new Set(["financeiro", "admin", "super_admin"]);
export function podeAcessarCentralFinanceira(roles: string[]): boolean {
  return roles.some((r) => PAPEIS_COM_ACESSO_FINANCEIRO.has(r));
}

/** Aparado + minúsculo pra comparar nome de beneficiário (texto livre) contra profiles.nome sem
 * falhar por causa de espaço extra ou capitalização diferente — mesmo tipo de normalização já
 * feita em montarComissaoCalculada (trim do nome), aqui só pra fins de correspondência. */
export function normalizarNomeParaCorrespondencia(nome: string): string {
  return nome.trim().toLowerCase();
}

/**
 * Por que um beneficiário sem `user_id` está sem vínculo — nunca classifica como "externo" só
 * porque não achou correspondência em profiles (regra explícita: precisa vir de dado auditável).
 *
 * `marcadoExplicitamenteExterno` vem de `occurrence_commissions.sem_cadastro_confirmado` (ver
 * migration 20260817020000_exige_confirmacao_sem_cadastro) — marcado só quando alguém escolhe
 * deliberadamente "Sem cadastro / parceiro externo" no seletor de beneficiário, nunca inferido por
 * nome/papel. Esse indicador é por LINHA de `occurrence_commissions` (um beneficiário específico);
 * é um conceito diferente de `occurrence_partners`/`sales.parceria_*`, que é da OCORRÊNCIA INTEIRA
 * (parceria com outra imobiliária/unidade, não um beneficiário individual sem cadastro).
 *
 * `correspondenciasNoNome` = quantos profiles ativos têm o mesmo nome normalizado. 1 = candidato
 * único e inequívoco ("vínculo pendente"); 0 ou 2+ = não dá pra inferir com segurança
 * ("sem correspondência — revisão necessária"), inclusive quando há nomes duplicados.
 */
export function classificarVinculoBeneficiario(args: {
  marcadoExplicitamenteExterno: boolean;
  correspondenciasNoNome: number;
}): {
  classificacao: ClassificacaoVinculoBeneficiario;
  tipo: string;
  explicacao: string;
  acaoRecomendada: string;
  gravidade: "alta" | "media" | "baixa";
} {
  if (args.marcadoExplicitamenteExterno) {
    return {
      classificacao: "externo_explicito",
      tipo: "Beneficiário externo sem usuário",
      explicacao:
        "Marcado como parceria/beneficiário externo — não ter usuário cadastrado é esperado, não é uma pendência.",
      acaoRecomendada: "Nenhuma ação necessária.",
      gravidade: "baixa",
    };
  }
  if (args.correspondenciasNoNome === 1) {
    return {
      classificacao: "vinculo_pendente",
      tipo: "Usuário correspondente encontrado — vínculo pendente",
      explicacao:
        "Existe exatamente um usuário cadastrado com esse nome — provável mesma pessoa, só falta vincular manualmente.",
      acaoRecomendada:
        "Revisar e vincular ao usuário correspondente, se confirmado que é a mesma pessoa.",
      gravidade: "media",
    };
  }
  return {
    classificacao: "sem_correspondencia",
    tipo: "Sem correspondência — revisão necessária",
    explicacao:
      args.correspondenciasNoNome > 1
        ? "Mais de um usuário cadastrado tem esse nome — vínculo ambíguo, não pode ser inferido automaticamente."
        : "Nenhum usuário cadastrado com esse nome, e nenhuma indicação explícita de parceria externa.",
    acaoRecomendada:
      "Revisar manualmente: confirmar se é pessoa interna sem cadastro ou parceiro externo, e registrar a decisão.",
    gravidade: "media",
  };
}

/** Dias corridos (UTC, data-only) de `de` até `ate` — positivo se `ate` é depois de `de`. Datas
 * comparadas por componentes Y/M/D em vez de `new Date(iso)` puro, pra nunca sofrer o deslocamento
 * de fuso horário que `new Date("2026-08-16")` (meia-noite UTC) causaria em fusos negativos. */
export function filtrosPadraoFinanceiro(): FinanceiroFiltros {
  return {
    dataDe: "",
    dataAte: "",
    modalidade: "todas",
    corretorId: null,
    gestorId: null,
    teamId: null,
    papel: null,
    situacaoRecebimento: "todas",
    busca: "",
    incluirCanceladas: false,
  };
}

export function diasEntre(de: string, ate: string): number {
  const [y1, m1, d1] = de.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = ate.slice(0, 10).split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

/**
 * Situação de uma parcela. "Recebido parcialmente" = valor recebido menor que o líquido previsto
 * (diferença negativa); "Recebido com diferença" cobre qualquer outra divergência de valor
 * (recebido maior que o previsto, caso incomum mas possível com correção manual) — os dois exigem
 * diferença acima de R$ 0,01, dentro disso conta como "Recebido" (arredondamento).
 */
export function classificarSituacaoParcela(args: {
  cancelada: boolean;
  dataPrevista: string | null;
  valorLiquidoPrevisto: number | null;
  dataRecebimento: string | null;
  valorRecebido: number | null;
  hoje: string;
}): SituacaoParcela {
  const { cancelada, dataPrevista, valorLiquidoPrevisto, dataRecebimento, valorRecebido, hoje } =
    args;
  if (cancelada) return "cancelado_arquivado";
  if (!dataPrevista || valorLiquidoPrevisto == null) return "sem_previsao";
  if (dataRecebimento) {
    if (valorRecebido == null) return "recebido";
    const diferenca = Number((valorRecebido - valorLiquidoPrevisto).toFixed(2));
    if (Math.abs(diferenca) <= 0.01) return "recebido";
    return diferenca < 0 ? "recebido_parcial" : "recebido_diferenca";
  }
  return dataPrevista < hoje ? "vencido" : "a_vencer";
}

/** Faixa de aging de uma parcela ainda não recebida — só chamar para situação "a_vencer"/"vencido".
 * Faixas não se sobrepõem (ex.: "próximos 30 dias" = 8 a 30, não 1 a 30 — já coberto por
 * "próximos 7 dias"), mesmo critério nos dois lados (a vencer/vencido). */
export function classificarFaixaAging(dataPrevista: string, hoje: string): AgingBucketKey {
  const dias = diasEntre(hoje, dataPrevista);
  if (dias >= 0) {
    if (dias === 0) return "vence_hoje";
    if (dias <= 7) return "prox_7";
    if (dias <= 30) return "prox_30";
    if (dias <= 60) return "d31_60";
    if (dias <= 90) return "d61_90";
    return "acima_90";
  }
  const atraso = -dias;
  if (atraso <= 7) return "venc_1_7";
  if (atraso <= 15) return "venc_8_15";
  if (atraso <= 30) return "venc_16_30";
  if (atraso <= 60) return "venc_31_60";
  return "venc_mais_60";
}

/** Monta uma linha de parcela já classificada. `fatorComissaoPropria` é o mesmo fator de
 * `src/lib/status.ts` (1 − parceria/comissão total da ocorrência) — calculado uma vez por
 * ocorrência pelo chamador e aplicado a cada uma das 3 parcelas, igual ao resto do sistema
 * (Relatórios, Comissões a Receber), pra nunca divergir de como "nossa parte" já é calculada ali. */
export function montarParcela(args: {
  saleId: string;
  occId: string;
  parcela: 1 | 2 | 3;
  imovelLabel: string;
  codigoInterno: string | null;
  corretorId: string;
  corretorNome: string;
  teamId: string | null;
  teamNome: string | null;
  gestorId: string | null;
  gestorNome: string | null;
  saleStatus: string;
  modalidade: string;
  cancelada: boolean;
  dataPrevista: string;
  formaPrevista: string | null;
  valorBrutoPrevisto: number;
  fatorComissaoPropria: number;
  dataRecebimento: string | null;
  valorRecebido: number | null;
  hoje: string;
}): ParcelaRecebimento {
  const valorLiquidoPrevisto = Number(
    (args.valorBrutoPrevisto * args.fatorComissaoPropria).toFixed(2),
  );
  const valorParceria = Number((args.valorBrutoPrevisto - valorLiquidoPrevisto).toFixed(2));
  const situacao = classificarSituacaoParcela({
    cancelada: args.cancelada,
    dataPrevista: args.dataPrevista,
    valorLiquidoPrevisto,
    dataRecebimento: args.dataRecebimento,
    valorRecebido: args.valorRecebido,
    hoje: args.hoje,
  });
  const diferenca =
    args.dataRecebimento && args.valorRecebido != null
      ? Number((args.valorRecebido - valorLiquidoPrevisto).toFixed(2))
      : null;

  return {
    key: `${args.occId}-${args.parcela}`,
    saleId: args.saleId,
    occId: args.occId,
    parcela: args.parcela,
    imovelLabel: args.imovelLabel,
    codigoInterno: args.codigoInterno,
    corretorId: args.corretorId,
    corretorNome: args.corretorNome,
    teamId: args.teamId,
    teamNome: args.teamNome,
    gestorId: args.gestorId,
    gestorNome: args.gestorNome,
    saleStatus: args.saleStatus,
    modalidade: args.modalidade,
    cancelada: args.cancelada,
    dataPrevista: args.dataPrevista,
    formaPrevista: args.formaPrevista,
    valorBrutoPrevisto: args.valorBrutoPrevisto,
    valorParceria,
    valorLiquidoPrevisto,
    dataRecebimento: args.dataRecebimento,
    valorRecebido: args.valorRecebido,
    diferenca,
    situacao,
  };
}

const PAPEIS_COM_VINCULO_ESPERADO = new Set([
  "corretor_captador",
  "corretor_vendedor",
  "gestor",
  "team_leader",
]);

/** Monta uma linha de comissão calculada (competência). `situacaoRecebimentoVenda` é derivada das
 * parcelas da MESMA venda (não da comissão em si — comissão não tem parcela própria), refletindo
 * quanto do dinheiro que sustenta essa comissão já entrou pra imobiliária. */
export function montarComissaoCalculada(args: {
  id: string;
  saleId: string;
  occId: string;
  imovelLabel: string;
  codigoInterno: string | null;
  dataEfetivacao: string | null;
  modalidade: string;
  saleCorretorId: string;
  teamId: string | null;
  teamNome: string | null;
  gestorId: string | null;
  gestorNome: string | null;
  papel: string;
  beneficiarioNome: string | null;
  beneficiarioUserId: string | null;
  percentual: number | null;
  valor: number;
  managedBySale: boolean;
  parcelasDaVenda: { dataRecebimento: string | null }[];
}): ComissaoCalculada {
  const origem: OrigemComissao = args.managedBySale ? "automatica" : "manual";
  const semVinculoUsuario = PAPEIS_COM_VINCULO_ESPERADO.has(args.papel) && !args.beneficiarioUserId;
  // Aparado uma vez aqui, na origem — "Fulano" e "Fulano " (espaço a mais, digitado no cadastro)
  // não podem virar dois beneficiários diferentes no agrupamento por nome.
  const beneficiarioNome = args.beneficiarioNome?.trim() || null;
  const totalParcelas = args.parcelasDaVenda.length;
  const recebidas = args.parcelasDaVenda.filter((p) => p.dataRecebimento).length;
  const situacaoRecebimentoVenda: SituacaoRecebimentoVenda =
    totalParcelas === 0 || recebidas === 0
      ? "nao_recebido"
      : recebidas === totalParcelas
        ? "recebido"
        : "parcial";

  return {
    id: args.id,
    saleId: args.saleId,
    occId: args.occId,
    imovelLabel: args.imovelLabel,
    codigoInterno: args.codigoInterno,
    dataEfetivacao: args.dataEfetivacao,
    modalidade: args.modalidade,
    saleCorretorId: args.saleCorretorId,
    papel: args.papel,
    beneficiarioNome,
    beneficiarioUserId: args.beneficiarioUserId,
    teamId: args.teamId,
    teamNome: args.teamNome,
    gestorId: args.gestorId,
    gestorNome: args.gestorNome,
    percentual: args.percentual,
    valor: args.valor,
    origem,
    semVinculoUsuario,
    situacaoRecebimentoVenda,
  };
}

export function aplicarFiltrosParcelas(
  parcelas: ParcelaRecebimento[],
  filtros: FinanceiroFiltros,
): ParcelaRecebimento[] {
  const buscaQ = filtros.busca.trim().toLowerCase();
  return parcelas.filter((p) => {
    if (!filtros.incluirCanceladas && p.cancelada) return false;
    if (filtros.dataDe && p.dataPrevista && p.dataPrevista < filtros.dataDe) return false;
    if (filtros.dataAte && p.dataPrevista && p.dataPrevista > filtros.dataAte) return false;
    if (filtros.modalidade !== "todas" && p.modalidade !== filtros.modalidade) return false;
    if (filtros.corretorId && p.corretorId !== filtros.corretorId) return false;
    if (filtros.gestorId && p.gestorId !== filtros.gestorId) return false;
    if (filtros.teamId && p.teamId !== filtros.teamId) return false;
    if (filtros.situacaoRecebimento !== "todas") {
      const alvo = filtros.situacaoRecebimento;
      const bate =
        (alvo === "recebido" &&
          (p.situacao === "recebido" || p.situacao === "recebido_diferenca")) ||
        (alvo === "parcial" && p.situacao === "recebido_parcial") ||
        (alvo === "a_vencer" && p.situacao === "a_vencer") ||
        (alvo === "vencido" && p.situacao === "vencido") ||
        (alvo === "sem_previsao" && p.situacao === "sem_previsao");
      if (!bate) return false;
    }
    if (
      buscaQ &&
      !(
        p.imovelLabel.toLowerCase().includes(buscaQ) ||
        (p.codigoInterno ?? "").toLowerCase().includes(buscaQ)
      )
    )
      return false;
    return true;
  });
}

export function aplicarFiltrosComissoes(
  rows: ComissaoCalculada[],
  filtros: FinanceiroFiltros,
): ComissaoCalculada[] {
  const buscaQ = filtros.busca.trim().toLowerCase();
  return rows.filter((r) => {
    if (filtros.dataDe && r.dataEfetivacao && r.dataEfetivacao < filtros.dataDe) return false;
    if (filtros.dataAte && r.dataEfetivacao && r.dataEfetivacao > filtros.dataAte) return false;
    if (filtros.modalidade !== "todas" && r.modalidade !== filtros.modalidade) return false;
    if (filtros.corretorId && r.saleCorretorId !== filtros.corretorId) return false;
    if (filtros.gestorId && r.gestorId !== filtros.gestorId) return false;
    if (filtros.teamId && r.teamId !== filtros.teamId) return false;
    if (filtros.papel && r.papel !== filtros.papel) return false;
    if (
      buscaQ &&
      !(
        r.imovelLabel.toLowerCase().includes(buscaQ) ||
        (r.codigoInterno ?? "").toLowerCase().includes(buscaQ)
      )
    )
      return false;
    return true;
  });
}

/** Filtro de nível-venda pra alimentar os cards de VGV efetivado/comissão bruta — só os campos que
 * fazem sentido numa venda (período por data de efetivação, modalidade, corretor, gestor, equipe,
 * busca); "situação do recebimento" e "papel" não se aplicam aqui (são por parcela/beneficiário). */
export function aplicarFiltrosEfetivacao(
  rows: EfetivacaoVenda[],
  filtros: FinanceiroFiltros,
): EfetivacaoVenda[] {
  const buscaQ = filtros.busca.trim().toLowerCase();
  return rows.filter((r) => {
    if (filtros.dataDe && r.dataEfetivacao < filtros.dataDe) return false;
    if (filtros.dataAte && r.dataEfetivacao > filtros.dataAte) return false;
    if (filtros.modalidade !== "todas" && r.modalidade !== filtros.modalidade) return false;
    if (filtros.corretorId && r.corretorId !== filtros.corretorId) return false;
    if (filtros.gestorId && r.gestorId !== filtros.gestorId) return false;
    if (filtros.teamId && r.teamId !== filtros.teamId) return false;
    if (
      buscaQ &&
      !(
        r.imovelLabel.toLowerCase().includes(buscaQ) ||
        (r.codigoInterno ?? "").toLowerCase().includes(buscaQ)
      )
    )
      return false;
    return true;
  });
}

export function calcularAging(
  parcelas: ParcelaRecebimento[],
  hoje: string,
): { aVencer: AgingFaixa[]; vencido: AgingFaixa[] } {
  const buckets = new Map<AgingBucketKey, ParcelaRecebimento[]>();
  for (const p of parcelas) {
    if (p.situacao !== "a_vencer" && p.situacao !== "vencido") continue;
    const key = classificarFaixaAging(p.dataPrevista, hoje);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p);
  }
  const build = (keys: AgingBucketKey[]): AgingFaixa[] =>
    keys.map((key) => {
      const ps = buckets.get(key) ?? [];
      return {
        key,
        label: AGING_BUCKET_LABEL[key],
        quantidade: ps.length,
        valor: Number(ps.reduce((s, p) => s + p.valorLiquidoPrevisto, 0).toFixed(2)),
        parcelas: ps,
      };
    });
  return { aVencer: build(AGING_A_VENCER_ORDEM), vencido: build(AGING_VENCIDO_ORDEM) };
}

function chaveAgrupamento(
  r: ComissaoCalculada,
  agrupamento: AgrupamentoComissao,
): { key: string; label: string } {
  switch (agrupamento) {
    case "beneficiario":
      return {
        key: r.beneficiarioUserId ?? `nome:${r.beneficiarioNome ?? "sem-nome"}`,
        label: r.beneficiarioNome ?? "Sem nome",
      };
    case "gestor":
      return { key: r.gestorId ?? "sem_gestor", label: r.gestorNome ?? "Sem gestor resolvido" };
    case "equipe":
      return { key: r.teamId ?? "sem_equipe", label: r.teamNome ?? "Sem equipe resolvida" };
    case "papel":
      return { key: r.papel, label: r.papel };
    case "mes": {
      const mes = r.dataEfetivacao ? r.dataEfetivacao.slice(0, 7) : "sem_data";
      return { key: mes, label: mes === "sem_data" ? "Sem data de efetivação" : mes };
    }
    case "geral":
    default:
      return { key: "geral", label: "Geral" };
  }
}

/** Agrupa a MESMA base de linhas (nunca recalcula) por qualquer um dos critérios pedidos, com
 * subtotal por grupo — usado tanto pela tabela agrupada quanto pelo gráfico "comissão por papel",
 * pra nunca ter dois números diferentes pro mesmo agrupamento. */
export function agruparComissoes(
  rows: ComissaoCalculada[],
  agrupamento: AgrupamentoComissao,
): GrupoComissao[] {
  const map = new Map<string, GrupoComissao>();
  for (const r of rows) {
    const { key, label } = chaveAgrupamento(r, agrupamento);
    const cur = map.get(key) ?? { chave: key, label, quantidade: 0, valorTotal: 0 };
    cur.quantidade += 1;
    cur.valorTotal = Number((cur.valorTotal + r.valor).toFixed(2));
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.valorTotal - a.valorTotal);
}

/** Cards da Visão Geral — mesma base (parcelas + comissões já filtradas) usada pelas tabelas,
 * nenhuma soma recalculada com regra própria. `vgvEfetivado`/`comissaoBruta` vêm de fora (base do
 * Comparativo 6%, já filtrada por data de efetivação) porque não têm relação com as parcelas de
 * recebimento — são o valor da VENDA, não da cobrança. */
export function calcularResumo(args: {
  parcelas: ParcelaRecebimento[];
  comissoes: ComissaoCalculada[];
  efetivadas: EfetivacaoVenda[];
  divergenciasAbertas: number;
  hoje: string;
}): ResumoFinanceiro {
  const { parcelas, comissoes, efetivadas, hoje } = args;
  const ativas = parcelas.filter((p) => !p.cancelada);
  const previstoImobiliaria = Number(
    ativas.reduce((s, p) => s + p.valorLiquidoPrevisto, 0).toFixed(2),
  );
  const recebidoImobiliaria = Number(
    ativas
      .filter((p) => p.dataRecebimento)
      .reduce((s, p) => s + (p.valorRecebido ?? 0), 0)
      .toFixed(2),
  );
  const vencido = Number(
    ativas
      .filter((p) => p.situacao === "vencido")
      .reduce((s, p) => s + p.valorLiquidoPrevisto, 0)
      .toFixed(2),
  );
  const aVencerRows = ativas.filter((p) => p.situacao === "a_vencer");
  const aVencer = Number(aVencerRows.reduce((s, p) => s + p.valorLiquidoPrevisto, 0).toFixed(2));

  const somaAteDias = (dias: number) =>
    Number(
      aVencerRows
        .filter((p) => diasEntre(hoje, p.dataPrevista) <= dias)
        .reduce((s, p) => s + p.valorLiquidoPrevisto, 0)
        .toFixed(2),
    );

  return {
    vgvEfetivado: Number(efetivadas.reduce((s, r) => s + r.valorNegociado, 0).toFixed(2)),
    comissaoBruta: Number(efetivadas.reduce((s, r) => s + r.valorTotalComissao, 0).toFixed(2)),
    previstoImobiliaria,
    recebidoImobiliaria,
    saldoAReceber: Number((previstoImobiliaria - recebidoImobiliaria).toFixed(2)),
    vencido,
    aVencer,
    previsao30: somaAteDias(30),
    previsao60: somaAteDias(60),
    previsao90: somaAteDias(90),
    comissoesCalculadasTotal: Number(comissoes.reduce((s, r) => s + r.valor, 0).toFixed(2)),
    divergenciasAbertas: args.divergenciasAbertas,
  };
}

/** "Previsto vs recebido por mês" — mesmo agrupamento usado no gráfico da Visão Geral, montado a
 * partir das parcelas já filtradas (não duplica a fonte). Mês = mês da data prevista. */
export function agruparParcelasPorMes(
  parcelas: ParcelaRecebimento[],
): { mes: string; previsto: number; recebido: number }[] {
  const map = new Map<string, { previsto: number; recebido: number }>();
  for (const p of parcelas.filter((p) => !p.cancelada)) {
    const mes = p.dataPrevista.slice(0, 7);
    const cur = map.get(mes) ?? { previsto: 0, recebido: 0 };
    cur.previsto = Number((cur.previsto + p.valorLiquidoPrevisto).toFixed(2));
    if (p.dataRecebimento)
      cur.recebido = Number((cur.recebido + (p.valorRecebido ?? 0)).toFixed(2));
    map.set(mes, cur);
  }
  return Array.from(map.entries())
    .map(([mes, v]) => ({ mes, ...v }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}
