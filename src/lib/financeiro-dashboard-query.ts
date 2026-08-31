/**
 * Busca/montagem de dados da Central Financeira — único módulo que fala com o Supabase aqui.
 * Só leitura: nenhuma função faz insert/update/delete. Reaproveita as duas RPCs do Comparativo 6%
 * (já restritas a financeiro/admin/super_admin, ver migration 20260813020000) em vez de reescrever
 * a regra de "data de efetivação" — e reaproveita `RECEBIDO_COLS` de status.ts. `parceriaPorOcc` soma
 * duas fontes de parceria externa por ocorrência: `occurrence_partners` (parceria da ocorrência
 * inteira, outra imobiliária/unidade) e `occurrence_commissions.sem_cadastro_confirmado`
 * (beneficiário individual sem cadastro, ex.: Wilson Grecchi — ver `agruparParceriaExternaPorOcorrencia`).
 * Nenhuma das duas é receita da imobiliária, e nenhuma das duas passa pela conta dela — o parceiro
 * cobra a fatia dele direto, então prev_recebimento{1,2,3}_valor já vem SEM essa parte (nunca precisa
 * de desconto em cima do valor previsto, só de subtração na comissão esperada pra reconciliar contra
 * ele — ver comissaoEsperada abaixo). Resolução de equipe/gestor por corretor é uma cópia local do
 * mesmo cálculo já feito em comparativo-comissao-query.ts e vendas.index.tsx — o projeto não tem hoje
 * um helper compartilhado pra isso (2 cópias já existentes), então uma 3ª local segue a convenção
 * real do repo.
 */
import { supabase } from "@/integrations/supabase/client";
import { agruparParceriaExternaPorOcorrencia } from "@/lib/comissao-por-beneficiario";
import {
  classificarVinculoBeneficiario,
  montarComissaoCalculada,
  montarParcela,
  normalizarNomeParaCorrespondencia,
} from "@/lib/financeiro-dashboard-calc";
import type {
  ComissaoCalculada,
  DivergenciaFinanceira,
  EfetivacaoVenda,
  ParcelaRecebimento,
} from "@/lib/financeiro-dashboard-types";

type TeamRow = { id: string; nome: string; parent_team_id: string | null; lider_id: string | null };
type TeamMemberRow = { membro_id: string; team_id: string };
type CoLeaderRow = { user_id: string; team_id: string };

type EfetivacaoRawRow = {
  sale_id: string;
  codigo_interno: string | null;
  imovel_id: string | null;
  modalidade: string;
  status: string;
  corretor_id: string;
  valor_negociado: number;
  valor_total_comissao: number;
  data_fechamento: string;
};

type InconsistenciaRawRow = {
  sale_id: string;
  codigo_interno: string | null;
  modalidade: string;
  motivo: string;
};

type DistribuicaoRawRow = {
  sale_id: string;
  saldo_inicial_imobiliaria: number;
  saldo_liquido_imobiliaria: number;
};

/** occurrences, tipado à mão: o select usa uma `const` com a lista de colunas (não um literal
 * inline), e o gerador de tipos do supabase-js só infere colunas a partir de um literal de string
 * no próprio call site — com uma variável, cai no overload genérico (`GenericStringError`). Mesmo
 * problema não ocorre nos outros `.select("...")` deste arquivo, que já são literais inline. */
type OccRow = {
  id: string;
  sale_id: string;
  valor_comissao: number | null;
  // Só existe (e só é diferente de zero) em vendas de Lançamento — "Prêmio/bônus da venda de
  // lançamento, somado à comissão na previsão de recebimento — fora da conta percentual normal"
  // (comentário oficial da coluna, migration 20260811020000_lancamento_schema.sql). Por desenho,
  // prev_recebimento_valor = valor_comissao + premio_valor quando premio_valor existe — nunca tratar
  // isso como divergência.
  premio_valor: number | null;
  prev_recebimento_valor: number | null;
  prev_recebimento_data: string | null;
  prev_recebimento_forma: string | null;
  prev_recebimento_recebido_em: string | null;
  prev_recebimento_recebido_valor: number | null;
  prev_recebimento2_valor: number | null;
  prev_recebimento2_data: string | null;
  prev_recebimento2_forma: string | null;
  prev_recebimento2_recebido_em: string | null;
  prev_recebimento2_recebido_valor: number | null;
  prev_recebimento3_valor: number | null;
  prev_recebimento3_data: string | null;
  prev_recebimento3_forma: string | null;
  prev_recebimento3_recebido_em: string | null;
  prev_recebimento3_recebido_valor: number | null;
};

// Mesmo motivo do "as any" em comparativo-comissao-query.ts: as RPCs existem no banco mas nunca
// foram regeneradas em src/integrations/supabase/types.ts (arquivo gerado). Some sozinho na próxima geração.
async function callRpc<T>(name: string): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await supabase.rpc(name as any)) as {
    data: T[] | null;
    error: { message: string } | null;
  };
  if (error) throw error;
  return data ?? [];
}

function exigirDados<T>(
  resultado: { data: T | null; error: { message: string } | null },
  origem: string,
): T {
  if (resultado.error) {
    throw new Error(`Dados financeiros incompletos (${origem}): ${resultado.error.message}`);
  }
  if (resultado.data == null) {
    throw new Error(`Dados financeiros incompletos (${origem}): resposta vazia inesperada.`);
  }
  return resultado.data;
}

function resolverEquipePorCorretor(
  teams: TeamRow[],
  members: TeamMemberRow[],
  coLeaders: CoLeaderRow[],
) {
  const teamIdByCorretor = new Map<string, string>();
  for (const m of members)
    if (!teamIdByCorretor.has(m.membro_id)) teamIdByCorretor.set(m.membro_id, m.team_id);
  for (const t of teams)
    if (t.lider_id && !teamIdByCorretor.has(t.lider_id)) teamIdByCorretor.set(t.lider_id, t.id);
  for (const c of coLeaders)
    if (!teamIdByCorretor.has(c.user_id)) teamIdByCorretor.set(c.user_id, c.team_id);
  return teamIdByCorretor;
}

const ETAPAS_FINANCEIRAS = [
  "contrato_assinado",
  "ocorrencia_pendente",
  "ocorrencia_analise_financeiro",
  "ocorrencia_devolvida_gestor",
  "ocorrencia_concluida",
];

const OCC_COLUMNS =
  "id, sale_id, valor_comissao, premio_valor, " +
  "prev_recebimento_valor, prev_recebimento_data, prev_recebimento_forma, prev_recebimento_recebido_em, prev_recebimento_recebido_valor, " +
  "prev_recebimento2_valor, prev_recebimento2_data, prev_recebimento2_forma, prev_recebimento2_recebido_em, prev_recebimento2_recebido_valor, " +
  "prev_recebimento3_valor, prev_recebimento3_data, prev_recebimento3_forma, prev_recebimento3_recebido_em, prev_recebimento3_recebido_valor";

export type FinanceiroBundle = {
  efetivadas: EfetivacaoVenda[];
  parcelas: ParcelaRecebimento[];
  comissoes: ComissaoCalculada[];
  divergencias: DivergenciaFinanceira[];
  corretorOptions: { id: string; label: string }[];
  gestorOptions: { id: string; label: string }[];
  teamOptions: { id: string; label: string }[];
};

export async function fetchFinanceiroBundle(): Promise<FinanceiroBundle> {
  const hoje = new Date().toISOString().slice(0, 10);

  const [
    efetivadasRaw,
    inconsistencias,
    distribuicoes,
    occsResult,
    salesResult,
    commissionsResult,
    partnersResult,
    extrasResult,
    profilesResult,
    teamsResult,
    membersResult,
    coLeadersResult,
  ] = await Promise.all([
    callRpc<EfetivacaoRawRow>("comparativo_comissao_6pct"),
    callRpc<InconsistenciaRawRow>("comparativo_comissao_6pct_inconsistencias"),
    callRpc<DistribuicaoRawRow>("financeiro_distribuicao_vendas"),
    supabase.from("occurrences").select(OCC_COLUMNS) as unknown as Promise<{
      data: OccRow[] | null;
      error: { message: string } | null;
    }>,
    supabase.from("sales").select("id, status, corretor_id, imovel_id, codigo_interno, modalidade"),
    supabase
      .from("occurrence_commissions")
      .select(
        "id, occurrence_id, papel, nome, percentual, valor, user_id, managed_by_sale, sale_commission_extra_id, sem_cadastro_confirmado",
      ),
    supabase.from("occurrence_partners").select("occurrence_id, valor"),
    supabase.from("sale_commission_extras").select("id"),
    supabase.from("profiles").select("id, nome"),
    supabase.from("teams").select("id, nome, parent_team_id, lider_id"),
    supabase.from("team_members").select("membro_id, team_id"),
    supabase.from("team_co_leaders").select("user_id, team_id"),
  ]);

  const occs = exigirDados(occsResult, "ocorrências");
  const sales = exigirDados(salesResult, "vendas");
  const commissions = exigirDados(commissionsResult, "comissões");
  const partners = exigirDados(partnersResult, "parcerias");
  const extras = exigirDados(extrasResult, "comissões extras");
  const profiles = exigirDados(profilesResult, "usuários");
  const teams = exigirDados(teamsResult, "equipes");
  const members = exigirDados(membersResult, "membros das equipes");
  const coLeaders = exigirDados(coLeadersResult, "colíderes das equipes");

  const nomePorId = new Map<string, string>();
  for (const p of profiles ?? []) nomePorId.set(p.id, p.nome ?? p.id);

  // Contagem de profiles por nome normalizado — só pra saber se a correspondência de um
  // beneficiário sem user_id é única (1) ou ambígua (2+), nunca pra vincular automaticamente.
  const contagemPorNomeNormalizado = new Map<string, number>();
  for (const p of profiles ?? []) {
    if (!p.nome) continue;
    const chave = normalizarNomeParaCorrespondencia(p.nome);
    contagemPorNomeNormalizado.set(chave, (contagemPorNomeNormalizado.get(chave) ?? 0) + 1);
  }

  const teamsArr = (teams ?? []) as TeamRow[];
  const teamById = new Map(teamsArr.map((t) => [t.id, t]));
  const teamIdByCorretor = resolverEquipePorCorretor(
    teamsArr,
    (members ?? []) as TeamMemberRow[],
    (coLeaders ?? []) as CoLeaderRow[],
  );
  const equipeDoCorretor = (corretorId: string) => {
    const teamId = teamIdByCorretor.get(corretorId) ?? null;
    const team = teamId ? (teamById.get(teamId) ?? null) : null;
    const gestorId = team?.lider_id ?? null;
    return {
      teamId,
      teamNome: team?.nome ?? null,
      gestorId,
      gestorNome: gestorId ? (nomePorId.get(gestorId) ?? gestorId) : null,
    };
  };

  const saleById = new Map((sales ?? []).map((s) => [s.id, s]));
  const occBySaleId = new Map((occs ?? []).map((o) => [o.sale_id, o]));
  const occByOccId = new Map((occs ?? []).map((o) => [o.id, o]));
  const extraIds = new Set((extras ?? []).map((e) => e.id));

  // Duas fontes de parceria externa somadas na mesma chave por ocorrência — nenhuma das duas é
  // receita da imobiliária, ver comentário no topo do arquivo. occurrence_partners é da ocorrência
  // inteira; occurrence_commissions (sem_cadastro_confirmado) é de um beneficiário específico.
  const parceriaPorOcc = new Map<string, number>();
  for (const p of partners ?? [])
    parceriaPorOcc.set(
      p.occurrence_id,
      (parceriaPorOcc.get(p.occurrence_id) ?? 0) + Number(p.valor ?? 0),
    );
  for (const [occId, valor] of Object.entries(
    agruparParceriaExternaPorOcorrencia(commissions ?? []),
  )) {
    parceriaPorOcc.set(occId, (parceriaPorOcc.get(occId) ?? 0) + valor);
  }

  const distribuicaoPorVenda = new Map(distribuicoes.map((r) => [r.sale_id, r]));

  const saleLabel = (sale: {
    imovel_id: string | null;
    codigo_interno: string | null;
    id: string;
  }) => sale.imovel_id || sale.codigo_interno || `Venda #${sale.id.slice(0, 8)}`;

  const divergencias: DivergenciaFinanceira[] = [];

  // ---- Parcelas de recebimento (aba Recebimentos + Aging) ----
  const parcelas: ParcelaRecebimento[] = [];
  for (const occ of occs ?? []) {
    const sale = saleById.get(occ.sale_id);
    if (!sale) {
      divergencias.push({
        id: `occ-sem-venda:${occ.id}`,
        gravidade: "alta",
        saleId: null,
        imovelLabel: null,
        tipo: "Ocorrência sem venda correspondente",
        explicacao: `A ocorrência ${occ.id.slice(0, 8)} referencia uma venda que não foi encontrada.`,
        valorAfetado: occ.valor_comissao ?? null,
        acaoRecomendada: "Verificar com o suporte técnico — possível inconsistência de dado.",
        linkTo: null,
      });
      continue;
    }
    const cancelada = sale.status === "cancelada" || sale.status === "arquivada";
    const { teamId, teamNome, gestorId, gestorNome } = equipeDoCorretor(sale.corretor_id);
    const parceriaOcc = parceriaPorOcc.get(occ.id) ?? 0;
    const imovelLabel = saleLabel(sale);

    let somaParcelasPrevistas = 0;
    const parcelasDaVenda: { dataRecebimento: string | null }[] = [];
    ([1, 2, 3] as const).forEach((n) => {
      const suf = n === 1 ? "" : String(n);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = occ as any;
      const data: string | null = o[`prev_recebimento${suf}_data`];
      const valor: number | null = o[`prev_recebimento${suf}_valor`];
      const forma: string | null = o[`prev_recebimento${suf}_forma`];
      const recebidoEm: string | null = o[`prev_recebimento${suf}_recebido_em`];
      const recebidoValor: number | null = o[`prev_recebimento${suf}_recebido_valor`];

      if ((data && valor == null) || (!data && valor != null)) {
        divergencias.push({
          id: `parcela-previsao-incompleta:${occ.id}:${n}`,
          gravidade: "media",
          saleId: sale.id,
          imovelLabel,
          tipo: "Previsão de recebimento sem data ou sem valor",
          explicacao: `Parcela ${n}ª da venda ${imovelLabel}: ${data ? "tem data prevista mas falta o valor" : "tem valor previsto mas falta a data"}.`,
          valorAfetado: valor ?? null,
          acaoRecomendada: "Completar a previsão de recebimento na venda antes do fechamento financeiro.",
          linkTo: `/vendas/${sale.id}`,
        });
      }

      // Parcela marcada como recebida com só metade do par (data sem valor, ou valor sem data) —
      // dado inconsistente, independente de a parcela ter previsão completa ou não.
      if ((recebidoEm && recebidoValor == null) || (!recebidoEm && recebidoValor != null)) {
        divergencias.push({
          id: `parcela-recebido-incompleto:${occ.id}:${n}`,
          gravidade: "media",
          saleId: sale.id,
          imovelLabel,
          tipo: "Parcela marcada como recebida sem data ou sem valor",
          explicacao: `Parcela ${n}ª da venda ${imovelLabel}: ${recebidoEm ? "tem data de recebimento mas falta o valor recebido" : "tem valor recebido mas falta a data"}.`,
          valorAfetado: recebidoValor ?? null,
          acaoRecomendada: "Completar o registro de recebimento em Relatórios (Fluxo de caixa).",
          linkTo: `/vendas/${sale.id}`,
        });
      }
      if (recebidoValor != null && (!Number.isFinite(recebidoValor) || recebidoValor < 0)) {
        divergencias.push({
          id: `parcela-recebido-invalido:${occ.id}:${n}`,
          gravidade: "alta",
          saleId: sale.id,
          imovelLabel,
          tipo: "Recebimento com valor negativo ou não numérico",
          explicacao: `Parcela ${n}ª da venda ${imovelLabel} tem valor recebido inválido (${String(recebidoValor)}).`,
          valorAfetado: recebidoValor,
          acaoRecomendada: "Corrigir o valor recebido em Relatórios (Fluxo de caixa).",
          linkTo: `/vendas/${sale.id}`,
        });
      }
      if (cancelada && recebidoEm) {
        divergencias.push({
          id: `parcela-cancelada-recebida:${occ.id}:${n}`,
          gravidade: "media",
          saleId: sale.id,
          imovelLabel,
          tipo: "Recebimento em venda cancelada/arquivada",
          explicacao: `A venda ${imovelLabel} está ${sale.status} mas tem a parcela ${n}ª marcada como recebida.`,
          valorAfetado: recebidoValor,
          acaoRecomendada:
            "Confirmar se o cancelamento/arquivamento está correto ou se o recebimento é anterior a ele.",
          linkTo: `/vendas/${sale.id}`,
        });
      }

      if (!data || valor == null) return;
      somaParcelasPrevistas += Number(valor);
      parcelasDaVenda.push({ dataRecebimento: recebidoEm });
      parcelas.push(
        montarParcela({
          saleId: sale.id,
          occId: occ.id,
          parcela: n,
          imovelLabel,
          codigoInterno: sale.codigo_interno,
          corretorId: sale.corretor_id,
          corretorNome: nomePorId.get(sale.corretor_id) ?? sale.corretor_id,
          teamId,
          teamNome,
          gestorId,
          gestorNome,
          saleStatus: sale.status,
          modalidade: sale.modalidade,
          cancelada,
          dataPrevista: data,
          formaPrevista: forma,
          valorBrutoPrevisto: Number(valor),
          dataRecebimento: recebidoEm,
          valorRecebido: recebidoValor != null ? Number(recebidoValor) : null,
          hoje,
        }),
      );
    });

    // Em vendas de Lançamento, o prêmio/bônus (occurrences.premio_valor) é somado à comissão só na
    // previsão de recebimento, por desenho (comentário oficial da coluna) — nunca comparar a soma das
    // parcelas só contra valor_comissao quando há prêmio, senão toda venda com prêmio vira falso
    // positivo aqui. Parceria externa (parceriaOcc) é subtraída porque nunca passa pela conta desta
    // imobiliária — prev_recebimento{1,2,3}_valor já vem só com a fatia própria.
    const comissaoEsperada = Math.max(
      Number(occ.valor_comissao ?? 0) + Number(occ.premio_valor ?? 0) - parceriaOcc,
      0,
    );
    if (
      (occ.valor_comissao != null || occ.premio_valor != null) &&
      Math.abs(somaParcelasPrevistas - comissaoEsperada) > 0.01
    ) {
      const premioTxt = occ.premio_valor
        ? ` + premio_valor (R$ ${Number(occ.premio_valor).toFixed(2)})`
        : "";
      const parceriaTxt = parceriaOcc > 0 ? ` − parceria externa (R$ ${parceriaOcc.toFixed(2)})` : "";
      divergencias.push({
        id: `soma-parcelas-incompativel:${occ.id}`,
        gravidade: "media",
        saleId: sale.id,
        imovelLabel,
        tipo: "Soma das parcelas incompatível com a comissão da ocorrência",
        explicacao:
          `Soma de prev_recebimento{1,2,3}_valor (R$ ${somaParcelasPrevistas.toFixed(2)}) difere de ` +
          `occurrences.valor_comissao (R$ ${Number(occ.valor_comissao ?? 0).toFixed(2)})${premioTxt}${parceriaTxt} em R$ ${(somaParcelasPrevistas - comissaoEsperada).toFixed(2)}.`,
        valorAfetado: Number((somaParcelasPrevistas - comissaoEsperada).toFixed(2)),
        acaoRecomendada:
          "Revisar as parcelas previstas ou o valor de comissão/prêmio da ocorrência.",
        linkTo: `/vendas/${sale.id}`,
      });
    }
  }

  // Parcela com diferença entre previsto e recebido (recebido_parcial / recebido_diferenca) —
  // reaproveita a classificação já feita em montarParcela, não recalcula.
  for (const p of parcelas) {
    if (p.situacao === "recebido_parcial" || p.situacao === "recebido_diferenca") {
      divergencias.push({
        id: `parcela-diferenca:${p.key}`,
        gravidade: "media",
        saleId: p.saleId,
        imovelLabel: p.imovelLabel,
        tipo:
          p.situacao === "recebido_parcial"
            ? "Recebido abaixo do previsto"
            : "Recebido com diferença do previsto",
        explicacao: `Parcela ${p.parcela}ª: previsto R$ ${p.valorLiquidoPrevisto.toFixed(2)}, recebido R$ ${(p.valorRecebido ?? 0).toFixed(2)} (diferença R$ ${(p.diferenca ?? 0).toFixed(2)}).`,
        valorAfetado: p.diferenca,
        acaoRecomendada: "Confirmar o motivo da diferença com o financeiro.",
        linkTo: `/vendas/${p.saleId}`,
      });
    }
  }

  // Venda em etapa financeira sem a ocorrência esperada (occurrences.sale_id é UNIQUE — nunca há
  // mais de uma ocorrência por venda, por isso esse cenário nem entra na lista de checagens).
  for (const sale of sales ?? []) {
    if (!ETAPAS_FINANCEIRAS.includes(sale.status)) continue;
    if (!occBySaleId.has(sale.id)) {
      divergencias.push({
        id: `venda-sem-ocorrencia:${sale.id}`,
        gravidade: "alta",
        saleId: sale.id,
        imovelLabel: saleLabel(sale),
        tipo: "Venda em etapa financeira sem ocorrência",
        explicacao: `A venda está em "${sale.status}" mas não tem registro de ocorrência.`,
        valorAfetado: null,
        acaoRecomendada:
          "Verificar com o suporte técnico — a ocorrência deveria existir nesta etapa.",
        linkTo: `/vendas/${sale.id}`,
      });
    }
    if (!teamIdByCorretor.has(sale.corretor_id)) {
      divergencias.push({
        id: `equipe-nao-resolvida:${sale.id}`,
        gravidade: "baixa",
        saleId: sale.id,
        imovelLabel: saleLabel(sale),
        tipo: "Equipe/gestor não resolvido",
        explicacao:
          "O corretor desta venda não está vinculado a nenhuma equipe (nem como membro, nem como líder).",
        valorAfetado: null,
        acaoRecomendada: "Conferir o cadastro de equipes do corretor.",
        linkTo: `/vendas/${sale.id}`,
      });
    }
  }

  // ---- Comissões calculadas (aba Comissões Calculadas) — só vendas já efetivadas, mesma
  // população do Comparativo 6% (ver comentário no topo do arquivo). ----
  const efetivacaoBySaleId = new Map((efetivadasRaw ?? []).map((r) => [r.sale_id, r]));
  const comissoes: ComissaoCalculada[] = [];
  for (const row of commissions ?? []) {
    // Parceiro externo é controle apartado: nunca entra em comissão calculada, ranking ou total
    // principal da unidade. O valor continua disponível em parceriaPorOcc para reconciliação.
    if (row.sem_cadastro_confirmado === true) continue;
    const occ = occByOccId.get(row.occurrence_id);
    if (!occ) continue;
    const sale = saleById.get(occ.sale_id);
    if (!sale) continue;
    const efet = efetivacaoBySaleId.get(sale.id);
    if (!efet) continue;
    const { teamId, teamNome, gestorId, gestorNome } = equipeDoCorretor(sale.corretor_id);

    const parcelasDaVenda = ([1, 2, 3] as const)
      .map((n) => {
        const suf = n === 1 ? "" : String(n);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const o = occ as any;
        return {
          data: o[`prev_recebimento${suf}_data`],
          valor: o[`prev_recebimento${suf}_valor`],
          dataRecebimento: o[`prev_recebimento${suf}_recebido_em`] as string | null,
        };
      })
      .filter((p) => p.data && p.valor != null)
      .map((p) => ({ dataRecebimento: p.dataRecebimento }));

    const comissao = montarComissaoCalculada({
      id: row.id,
      saleId: sale.id,
      occId: occ.id,
      imovelLabel: saleLabel(sale),
      codigoInterno: sale.codigo_interno,
      dataEfetivacao: efet.data_fechamento,
      modalidade: sale.modalidade,
      saleCorretorId: sale.corretor_id,
      teamId,
      teamNome,
      gestorId,
      gestorNome,
      papel: row.papel,
      beneficiarioNome: row.nome,
      beneficiarioUserId: row.user_id,
      percentual: row.percentual,
      valor: Number(row.valor ?? 0),
      managedBySale: row.managed_by_sale,
      parcelasDaVenda,
    });
    comissoes.push(comissao);

    if (!comissao.beneficiarioNome && !comissao.beneficiarioUserId) {
      divergencias.push({
        id: `comissao-sem-beneficiario:${row.id}`,
        gravidade: "alta",
        saleId: sale.id,
        imovelLabel: comissao.imovelLabel,
        tipo: "Comissão sem beneficiário",
        explicacao: `Linha de comissão (papel: ${row.papel}) sem nome nem vínculo de usuário.`,
        valorAfetado: comissao.valor,
        acaoRecomendada: "Revisar a divisão de comissão dessa venda.",
        linkTo: `/vendas/${sale.id}`,
      });
    } else if (comissao.semVinculoUsuario) {
      // marcadoExplicitamenteExterno vem de occurrence_commissions.sem_cadastro_confirmado —
      // marcado só quando alguém escolhe deliberadamente "Sem cadastro / parceiro externo" no
      // seletor (ver migration 20260817020000_exige_confirmacao_sem_cadastro e
      // lib/lancamento-pessoas.ts). Nunca inferido por nome/papel — só esse indicador explícito
      // distingue um parceiro externo confirmado (ex.: Wilson Grecchi) de um vínculo esquecido
      // (ex.: Aline, que tem cadastro e só não foi selecionada).
      const correspondencias = comissao.beneficiarioNome
        ? (contagemPorNomeNormalizado.get(
            normalizarNomeParaCorrespondencia(comissao.beneficiarioNome),
          ) ?? 0)
        : 0;
      const c = classificarVinculoBeneficiario({
        // Linhas explicitamente externas já foram excluídas deste laço acima; qualquer linha que
        // chega aqui sem usuário é, portanto, um vínculo pendente de revisão.
        marcadoExplicitamenteExterno: false,
        correspondenciasNoNome: correspondencias,
      });
      divergencias.push({
        id: `beneficiario-sem-vinculo:${row.id}`,
        gravidade: c.gravidade,
        saleId: sale.id,
        imovelLabel: comissao.imovelLabel,
        tipo: c.tipo,
        explicacao: `"${comissao.beneficiarioNome}" (papel: ${row.papel}) — ${c.explicacao}`,
        valorAfetado: comissao.valor,
        acaoRecomendada: c.acaoRecomendada,
        linkTo: `/vendas/${sale.id}`,
      });
    }
    if (
      row.managed_by_sale &&
      row.sale_commission_extra_id &&
      !extraIds.has(row.sale_commission_extra_id)
    ) {
      divergencias.push({
        id: `linha-automatica-orfa:${row.id}`,
        gravidade: "media",
        saleId: sale.id,
        imovelLabel: comissao.imovelLabel,
        tipo: "Linha automática sem origem válida",
        explicacao:
          "Esta linha automática referencia um ajuste extra que não existe mais no cadastro da venda.",
        valorAfetado: comissao.valor,
        acaoRecomendada: "Reabrir a venda para ressincronizar a divisão de comissão.",
        linkTo: `/vendas/${sale.id}`,
      });
    }
  }

  // ---- Reaproveita as inconsistências já detectadas pelo Comparativo 6% ----
  for (const inc of inconsistencias) {
    divergencias.push({
      id: `comparativo6pct:${inc.sale_id}`,
      gravidade: inc.motivo === "sem_historico_fechamento" ? "alta" : "media",
      saleId: inc.sale_id,
      imovelLabel: inc.codigo_interno,
      tipo:
        inc.motivo === "sem_historico_fechamento"
          ? "Sem histórico de envio ao financeiro"
          : "Valores inválidos para o Comparativo 6%",
      explicacao:
        inc.motivo === "sem_historico_fechamento"
          ? "A venda está em etapa financeira mas não tem entrada em 'ocorrência em análise (financeiro)' no histórico."
          : "Valor negociado ou comissão total inválidos (nulo, zero ou negativo).",
      valorAfetado: null,
      acaoRecomendada: "Revisar no Comparativo de Comissão — Padrão 6%.",
      linkTo: "/comparativo-comissao",
    });
  }

  const efetivadas: EfetivacaoVenda[] = (efetivadasRaw ?? []).map((r) => {
    const { teamId, gestorId } = equipeDoCorretor(r.corretor_id);
    const occ = occBySaleId.get(r.sale_id);
    const distribuicao = distribuicaoPorVenda.get(r.sale_id);
    return {
      saleId: r.sale_id,
      imovelLabel: r.imovel_id || r.codigo_interno || `Venda #${r.sale_id.slice(0, 8)}`,
      codigoInterno: r.codigo_interno,
      dataEfetivacao: r.data_fechamento,
      modalidade: r.modalidade,
      corretorId: r.corretor_id,
      teamId,
      gestorId,
      valorNegociado: Number(r.valor_negociado),
      valorTotalComissao: Number(r.valor_total_comissao),
      parceriaExterna: occ ? (parceriaPorOcc.get(occ.id) ?? 0) : 0,
      saldoInicialImobiliaria: Number(distribuicao?.saldo_inicial_imobiliaria ?? 0),
      receitaLiquidaImobiliaria: Number(distribuicao?.saldo_liquido_imobiliaria ?? 0),
    };
  });

  const corretorOptions = Array.from(new Set((sales ?? []).map((s) => s.corretor_id)))
    .map((id) => ({ id, label: nomePorId.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const gestorIds = new Set<string>();
  teamsArr.forEach((t) => {
    if (t.lider_id) gestorIds.add(t.lider_id);
  });
  const gestorOptions = Array.from(gestorIds)
    .map((id) => ({ id, label: nomePorId.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const teamOptions = teamsArr
    .map((t) => ({ id: t.id, label: t.nome }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    efetivadas,
    parcelas,
    comissoes,
    divergencias,
    corretorOptions,
    gestorOptions,
    teamOptions,
  };
}
