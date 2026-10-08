/**
 * Painel da Equipe (maquete t_941da55a aprovada por Denis em 08/10/2026). Fórmulas puras: nada
 * aqui lê o banco. A base é a mesma da Produção por pessoa (gerarPontas + equipe vigente na data
 * da venda), então VGV, VGC e imóveis vendidos da equipe batem com a Produção por pessoa filtrada
 * pela mesma equipe e pelo mesmo mês.
 *
 * Decisões aplicadas (recomendações apresentadas a Denis):
 * - Imóveis vendidos, VGV e VGC = só a parte (pontas) dos membros desta equipe; parceria com outra
 *   equipe conta só a fração da equipe, sem contar a mesma venda duas vezes.
 * - Mês da venda = mês da assinatura em America/Sao_Paulo. Recebimentos = data da parcela.
 * - Ganho do líder = vendas pessoais + comissões de líder já lançadas venda a venda (sem
 *   percentual automático sobre a equipe).
 * - Andamento: vendas abertas de qualquer mês + concluídas assinadas no mês.
 */
import { agruparPorPessoa, gerarPontas, totaisProducao } from "@/lib/producao-por-pessoa-calc";
import type { ProducaoPonta, ProducaoRawRow } from "@/lib/producao-por-pessoa-types";
import { criarResolverEquipe, type EquipeVigencia } from "@/lib/equipe-vigente";
import { dataCivilSaoPaulo } from "@/lib/hoje-sao-paulo";
import { proximoResponsavelRoles, type SaleStatus } from "@/lib/status";

/** Quem vê o Painel da Equipe. Líder auxiliar (co-leader) tem papel gestor/team_leader; a RPC
 * ainda confere se a pessoa lidera ou co-lidera a equipe pedida. */
export const PAPEIS_PAINEL_EQUIPE = ["gestor", "team_leader", "admin", "super_admin"] as const;

export function podeAcessarPainelEquipe(roles: readonly string[]): boolean {
  return roles.some((r) => (PAPEIS_PAINEL_EQUIPE as readonly string[]).includes(r));
}

export type PainelEquipeOpcao = {
  id: string;
  nome: string;
  lider_id: string | null;
  lider_nome: string | null;
  minha: boolean;
};

export type PainelMembro = {
  user_id: string;
  nome: string;
  papel: "lider" | "co_lider" | "membro";
  ultima_venda_em: string | null;
};

export type PainelGanho = {
  sale_id: string;
  user_id: string;
  pessoal: number;
  lider: number;
  outros: number;
};

export type PainelParcela = {
  sale_id: string;
  n: number;
  valor: number | null;
  data: string | null;
  recebido_em: string | null;
  recebido_valor: number | null;
};

export type PainelAndamento = {
  sale_id: string;
  codigo: string | null;
  bairro: string | null;
  modalidade: string | null;
  valor_negociado: number | null;
  status: SaleStatus;
  venda_em: string | null;
  etapa_desde: string | null;
  membros: string[];
  parceria: boolean;
  parceria_externa: boolean;
  midia_vazia: boolean;
  contrato_faltando: boolean;
  recebimento_sem_data: boolean;
};

export type PainelExclusiva = {
  id: string;
  captor_id: string;
  signed_on: string | null;
  prazo_dias: string | null;
  tipo: string | null;
  bairro: string | null;
};

export type PainelEquipeDados = {
  equipe: { id: string; nome: string; lider_id: string | null; lider_nome: string | null };
  viewer_id: string;
  eu_id: string | null;
  membros: PainelMembro[];
  vigencias: EquipeVigencia[];
  vendas: ProducaoRawRow[];
  ganhos: PainelGanho[];
  parcelas: PainelParcela[];
  andamento: PainelAndamento[];
  /** null = módulo de captação exclusiva desligado na imobiliária. */
  exclusivas: PainelExclusiva[] | null;
  meta: { meta_comissao: number | null; comissao_realizada: number | null } | null;
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** "2026-10" → { de: "2026-10-01", ate: "2026-10-31" }. */
export function limitesMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

export function mesAnterior(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export function mesDaData(valor: string | null | undefined): string | null {
  return dataCivilSaoPaulo(valor)?.slice(0, 7) ?? null;
}

/** Diferença em dias entre duas datas civis YYYY-MM-DD. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 864e5);
}

/** Todas as pontas (de todas as pessoas) das vendas devolvidas, com a equipe vigente na data. */
export function pontasDoPainel(d: PainelEquipeDados): ProducaoPonta[] {
  const resolver = criarResolverEquipe(d.vigencias);
  return gerarPontas(d.vendas, resolver, new Map([[d.equipe.id, d.equipe.nome]]));
}

/** Fração da comissão própria da venda que pertence à equipe (0 a 1). */
export function fracaoEquipePorVenda(pontas: ProducaoPonta[], teamId: string): Map<string, number> {
  const total = new Map<string, number>();
  const daEquipe = new Map<string, number>();
  for (const p of pontas) {
    total.set(p.saleId, (total.get(p.saleId) ?? 0) + p.comissao);
    if (p.teamId === teamId) daEquipe.set(p.saleId, (daEquipe.get(p.saleId) ?? 0) + p.comissao);
  }
  const out = new Map<string, number>();
  for (const [saleId, t] of total) {
    const e = daEquipe.get(saleId) ?? 0;
    if (e > 0) out.set(saleId, t > 0 ? Math.min(1, e / t) : 1);
  }
  return out;
}

export type ResumoMesEquipe = {
  vgv: number;
  vgc: number;
  qtd: number;
  ticket: number;
  recebeEquipe: number;
  comissaoPessoal: number;
};

function pontasDaEquipeNoMes(pontas: ProducaoPonta[], teamId: string, mes: string) {
  return pontas.filter((p) => p.teamId === teamId && mesDaData(p.concluidaEm) === mes);
}

/** Pessoa estava NESTA equipe na data da venda? (mesma regra das pontas). */
function membroNaData(d: PainelEquipeDados) {
  const resolver = criarResolverEquipe(d.vigencias);
  return (userId: string, em: string | null) => resolver(userId, em) === d.equipe.id;
}

export function resumoMes(
  d: PainelEquipeDados,
  pontas: ProducaoPonta[],
  mes: string,
): ResumoMesEquipe {
  const teamId = d.equipe.id;
  const daEquipe = pontasDaEquipeNoMes(pontas, teamId, mes);
  const t = totaisProducao(daEquipe);
  const fracao = fracaoEquipePorVenda(pontas, teamId);
  const recebeEquipe = d.parcelas
    .filter((pc) => pc.data && pc.data.slice(0, 7) === mes)
    .reduce((s, pc) => s + num(pc.valor) * (fracao.get(pc.sale_id) ?? 0), 0);
  const vendaEm = new Map(d.vendas.map((v) => [v.sale_id, v.concluida_em]));
  const naEquipe = membroNaData(d);
  const comissaoPessoal = d.ganhos
    .filter((g) => {
      const em = vendaEm.get(g.sale_id) ?? null;
      return mesDaData(em) === mes && naEquipe(g.user_id, em);
    })
    .reduce((s, g) => s + num(g.pessoal), 0);
  return {
    vgv: t.vgv,
    vgc: t.comissao,
    qtd: t.qtdVendas,
    ticket: t.qtdVendas > 0 ? round2(t.vgv / t.qtdVendas) : 0,
    recebeEquipe: round2(recebeEquipe),
    comissaoPessoal: round2(comissaoPessoal),
  };
}

/** Variação percentual vs mês anterior; null quando não há base. */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
}

export type GanhoVenda = { saleId: string; codigo: string | null; valor: number; tipo: string };

/** "Quanto EU vou ganhar": A = vendas pessoais; B = A + comissão de líder já lançada. */
export function ganhoDoLider(d: PainelEquipeDados, mes: string) {
  const eu = d.eu_id;
  const vendas = new Map(d.vendas.map((v) => [v.sale_id, v]));
  const pessoais: GanhoVenda[] = [];
  const lider: GanhoVenda[] = [];
  for (const g of d.ganhos) {
    if (!eu || g.user_id !== eu) continue;
    const v = vendas.get(g.sale_id);
    if (!v || mesDaData(v.concluida_em) !== mes) continue;
    const codigo = v.codigo_interno || v.imovel_id;
    if (num(g.pessoal) > 0)
      pessoais.push({ saleId: g.sale_id, codigo, valor: num(g.pessoal), tipo: "pessoal" });
    if (num(g.lider) > 0)
      lider.push({ saleId: g.sale_id, codigo, valor: num(g.lider), tipo: "lider" });
  }
  const a = round2(pessoais.reduce((s, x) => s + x.valor, 0));
  const b = round2(a + lider.reduce((s, x) => s + x.valor, 0));
  return { a, b, pessoais, lider };
}

export type LinhaRanking = {
  userId: string;
  nome: string;
  papel: PainelMembro["papel"] | null;
  vgv: number;
  vgc: number;
  qtd: number;
  ganho: number;
  parceria: boolean;
};

/** Vendas com alguém de fora da equipe (outra equipe ou imobiliária parceira). */
export function vendasEmParceria(d: PainelEquipeDados, pontas: ProducaoPonta[]): Set<string> {
  const out = new Set<string>();
  for (const p of pontas) if (p.teamId !== d.equipe.id) out.add(p.saleId);
  for (const v of d.vendas)
    if (v.parceria_externa_captacao || v.parceria_externa_venda) out.add(v.sale_id);
  return out;
}

export function rankingEquipe(
  d: PainelEquipeDados,
  pontas: ProducaoPonta[],
  mes: string,
): LinhaRanking[] {
  const daEquipe = pontasDaEquipeNoMes(pontas, d.equipe.id, mes);
  const resumo = agruparPorPessoa(daEquipe);
  const parcerias = vendasEmParceria(d, pontas);
  const vendaEm = new Map(d.vendas.map((v) => [v.sale_id, v.concluida_em]));
  const naEquipe = membroNaData(d);
  const papel = new Map(d.membros.map((m) => [m.user_id, m]));
  const linhas = new Map<string, LinhaRanking>();
  for (const m of d.membros) {
    linhas.set(m.user_id, {
      userId: m.user_id,
      nome: m.nome,
      papel: m.papel,
      vgv: 0,
      vgc: 0,
      qtd: 0,
      ganho: 0,
      parceria: false,
    });
  }
  for (const r of resumo) {
    if (!r.pessoaId) continue;
    const l = linhas.get(r.pessoaId) ?? {
      userId: r.pessoaId,
      nome: r.pessoaNome,
      papel: papel.get(r.pessoaId)?.papel ?? null,
      vgv: 0,
      vgc: 0,
      qtd: 0,
      ganho: 0,
      parceria: false,
    };
    l.vgv = r.vgv;
    l.vgc = r.comissao;
    l.qtd = r.qtdVendas;
    linhas.set(r.pessoaId, l);
  }
  for (const p of daEquipe) {
    const l = p.pessoaId ? linhas.get(p.pessoaId) : null;
    if (l && parcerias.has(p.saleId)) l.parceria = true;
  }
  for (const g of d.ganhos) {
    const em = vendaEm.get(g.sale_id) ?? null;
    const l = linhas.get(g.user_id);
    if (l && mesDaData(em) === mes && naEquipe(g.user_id, em))
      l.ganho = round2(l.ganho + num(g.pessoal));
  }
  return Array.from(linhas.values()).sort(
    (a, b) => b.vgc - a.vgc || b.ganho - a.ganho || a.nome.localeCompare(b.nome, "pt-BR"),
  );
}

export type ColunaFunil = "rascunho" | "andamento" | "financeiro" | "concluida";

export const COLUNAS_FUNIL: { k: ColunaFunil; titulo: string }[] = [
  { k: "rascunho", titulo: "Rascunho / ajuste" },
  { k: "andamento", titulo: "Em andamento" },
  { k: "financeiro", titulo: "Aguardando financeiro" },
  { k: "concluida", titulo: "Concluídas no mês" },
];

export function colunaDoStatus(status: SaleStatus): ColunaFunil {
  if (status === "rascunho" || status === "devolvida_ajuste") return "rascunho";
  if (status === "ocorrencia_analise_financeiro") return "financeiro";
  if (status === "ocorrencia_concluida") return "concluida";
  return "andamento";
}

export type VezFunil = "corretor" | "gestor" | "juridico" | "financeiro" | "concluida";

/** De quem é a vez — mesma regra da lista de vendas (proximoResponsavelRoles). */
export function vezDoStatus(status: SaleStatus): VezFunil {
  if (status === "ocorrencia_concluida") return "concluida";
  return proximoResponsavelRoles(status)[0] ?? "concluida";
}

export function pendenciasAndamento(a: PainelAndamento): string[] {
  const p: string[] = [];
  if (a.midia_vazia) p.push("Mídia em branco");
  if (a.contrato_faltando) p.push("Contrato assinado não anexado");
  if (a.recebimento_sem_data) p.push("Recebimento sem data");
  return p;
}

export type LinhaRecebimento = PainelParcela & {
  fracao: number;
  parteEquipe: number;
  codigo: string | null;
  membros: string[];
};

export function recebimentosDoMes(
  d: PainelEquipeDados,
  pontas: ProducaoPonta[],
  mes: string,
): LinhaRecebimento[] {
  const fracao = fracaoEquipePorVenda(pontas, d.equipe.id);
  const vendas = new Map(d.vendas.map((v) => [v.sale_id, v]));
  const membrosPorVenda = new Map<string, Set<string>>();
  for (const p of pontas) {
    if (p.teamId !== d.equipe.id) continue;
    const s = membrosPorVenda.get(p.saleId) ?? new Set<string>();
    s.add(p.pessoaNome);
    membrosPorVenda.set(p.saleId, s);
  }
  return d.parcelas
    .filter((pc) => pc.data && pc.data.slice(0, 7) === mes && (fracao.get(pc.sale_id) ?? 0) > 0)
    .map((pc) => {
      const f = fracao.get(pc.sale_id) ?? 0;
      const v = vendas.get(pc.sale_id);
      return {
        ...pc,
        fracao: f,
        parteEquipe: round2(num(pc.valor) * f),
        codigo: v ? v.codigo_interno || v.imovel_id : null,
        membros: Array.from(membrosPorVenda.get(pc.sale_id) ?? []),
      };
    })
    .sort((a, b) => (a.data ?? "").localeCompare(b.data ?? "") || a.n - b.n);
}

/** Dias sem vender (última assinatura válida). null = nunca vendeu. */
export function diasSemVender(d: PainelEquipeDados, hoje: string) {
  return d.membros
    .map((m) => {
      const ultima = dataCivilSaoPaulo(m.ultima_venda_em);
      return {
        userId: m.user_id,
        nome: m.nome,
        ultima,
        dias: ultima ? diasEntre(ultima, hoje) : null,
      };
    })
    .sort((a, b) => (b.dias ?? Number.MAX_SAFE_INTEGER) - (a.dias ?? Number.MAX_SAFE_INTEGER));
}

export function nivelSemVender(dias: number | null): "ok" | "atencao" | "alerta" {
  if (dias == null || dias > 30) return "alerta";
  if (dias > 14) return "atencao";
  return "ok";
}

/** Vencimento da exclusividade = assinatura + prazo em dias (padrão do contrato). */
export function vencimentoExclusiva(e: PainelExclusiva): string | null {
  const prazo = Number(e.prazo_dias);
  if (!e.signed_on || !Number.isFinite(prazo) || prazo <= 0) return null;
  const t = Date.parse(`${e.signed_on}T00:00:00Z`) + prazo * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}
