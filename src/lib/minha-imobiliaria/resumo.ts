/**
 * "Minha imobiliária" — avisos, números do mês e termômetro da EMPRESA TODA (cartão t_f7f1b3e4, maquete v2
 * aprovada por Denis em 20/11/2026). Puro, sem banco: a tela só mostra o que sai de montarResumo().
 *
 * Fontes: minha_imobiliaria_resumo() (avisos, exclusivas, leads, produtivos), metas_equipe_realizado (VGV do mês 1 vez
 * por venda; comissão = soma da parte de comissão das pessoas, a MESMA base que o painel Metas 2027 compara com a meta
 * da direção) e metas_direcao (meta anual ÷ 12).
 * Regras (Denis, 20/11): meta mensal da empresa = meta ANUAL da direção ÷ 12; lead no prazo = prazo de aceite da
 * imobiliária; admin que vende entra em "corretores produtivos"; o filtro do bloco Metas do mês NÃO muda isto aqui.
 */
import { STATUS_LABEL, type SaleStatus } from "@/lib/status";
import type { RealizadoRpc } from "@/lib/metas-2027/painel-gestor";
import { mesNoAno } from "@/lib/metas-2027/realizado";

/** Limites (proposta da maquete v1, aprovada com a v2). Trocar aqui muda tela e testes juntos. */
export const LIMITES_RESUMO = {
  maxAvisos: 5,
  leadHoras: 24,
  vencendoDias: 15,
  paradaDias: 5,
  novoDias: 60,
  produtivoDias: 90,
  /** Meta no ritmo: % da meta ÷ % do mês. */
  metaVerde: 1,
  metaAmarelo: 0.85,
  /** Estoque: queda em 30 dias. */
  estoqueAmarelo: 0.1,
  /** Leads no prazo. */
  leadsVerde: 0.85,
  leadsAmarelo: 0.7,
  /** Corretores produtivos. */
  produtivosVerde: 0.7,
  produtivosAmarelo: 0.5,
  /** Vendas paradas: até 2 = verde; 3 a 5 = amarelo; 6+ = vermelho. */
  paradasVerde: 2,
  paradasAmarelo: 5,
} as const;

// --- O que o banco devolve -------------------------------------------------------------------------------------

export type ResumoRpc = {
  hoje: string;
  mes_inicio: string;
  ant_inicio: string;
  ant_fim: string;
  modulos: { captacao: boolean; leads: boolean; locacao: boolean };
  exclusivas: {
    ativas: number;
    ativas_30d: number;
    novas_mes: number;
    novas_ant: number;
    vencendo: number;
    vencendo_primeira_dias: number | null;
    vencendo_primeira_imovel: string | null;
  } | null;
  leads: {
    prazo_aceite_min: number;
    sem_atendimento: number;
    mais_antigo_horas: number | null;
    mais_antigo_origem: string | null;
    recebidos_mes: number;
    recebidos_ant: number;
    elegiveis_mes: number;
    no_prazo_mes: number;
    elegiveis_ant: number;
    no_prazo_ant: number;
  } | null;
  vendas_paradas: { qtd: number; maior_dias: number | null; maior_status: string | null } | null;
  alugueis: { qtd: number; valor: number; maior_dias: number | null } | null;
  produtivos: {
    ativos: number;
    produtivos: number;
    admins_que_venderam: number;
    ativos_ant: number;
    produtivos_ant: number;
  } | null;
  novos_sem_venda: number;
};

export type DirecaoMes = { comissao: number | null; vgv: number | null };

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nn = (v: unknown) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

function numerosDe<T extends Record<string, unknown>>(
  o: T | null | undefined,
  nulos: string[] = [],
): T | null {
  if (!o) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o))
    out[k] =
      typeof v === "string" && !nulos.includes(k) && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  return out as T;
}

export function normalizarResumoRpc(x: unknown): ResumoRpc {
  const o = (x ?? {}) as Partial<ResumoRpc>;
  return {
    hoje: String(o.hoje ?? ""),
    mes_inicio: String(o.mes_inicio ?? ""),
    ant_inicio: String(o.ant_inicio ?? ""),
    ant_fim: String(o.ant_fim ?? ""),
    modulos: {
      captacao: !!o.modulos?.captacao,
      leads: !!o.modulos?.leads,
      locacao: !!o.modulos?.locacao,
    },
    exclusivas: numerosDe(o.exclusivas, ["vencendo_primeira_imovel"]),
    leads: numerosDe(o.leads, ["mais_antigo_origem"]),
    vendas_paradas: numerosDe(o.vendas_paradas, ["maior_status"]),
    alugueis: numerosDe(o.alugueis),
    produtivos: numerosDe(o.produtivos),
    novos_sem_venda: n(o.novos_sem_venda),
  };
}

/** Meta mensal da empresa = meta anual da direção ÷ 12 (decisão 1 de Denis). */
export function direcaoMensal(
  d: { meta_comissao?: unknown; meta_vgv?: unknown } | null | undefined,
): DirecaoMes {
  const c = nn(d?.meta_comissao);
  const v = nn(d?.meta_vgv);
  return {
    comissao: c != null && c > 0 ? Math.round((c / 12) * 100) / 100 : null,
    vgv: v != null && v > 0 ? Math.round((v / 12) * 100) / 100 : null,
  };
}

// --- Saída -----------------------------------------------------------------------------------------------------

export type Tom = "red" | "amber" | "blue";
export type Aviso = {
  chave: "leads" | "alugueis" | "exclusivas" | "vendas" | "novos";
  tom: Tom;
  qtd: number;
  titulo: string;
  detalhe: string;
  /** Tela de destino (a 1ª versão abre sem filtro). */
  para: string;
};

export type Cor = "verde" | "amarelo" | "vermelho" | "cinza";
export type Sinal = { chave: string; nome: string; cor: Cor; texto: string };

export type Cartao = {
  valor: number | null;
  meta: number | null;
  /** valor ÷ meta. */
  pct: number | null;
  /** pct ÷ fração do mês. */
  ritmo: number | null;
  antes: number | null;
  /** (valor − antes) ÷ antes. */
  variacao: number | null;
};

export type Resumo = {
  hoje: string;
  dia: number;
  fracMes: number;
  /** "outubro" (mês anterior) e o último dia do período comparado. */
  mesAnterior: string;
  avisos: Aviso[];
  vgv: Cartao;
  comissao: Cartao;
  exclusivas: { novas: number; ativas: number; ativas30d: number; variacao: number | null } | null;
  leads: {
    recebidos: number;
    pctNoPrazo: number | null;
    pctNoPrazoAnt: number | null;
    prazoMin: number;
  } | null;
  produtivos: {
    qtd: number;
    total: number;
    pct: number | null;
    pctAnt: number | null;
    variacao: number | null;
    admins: number;
  } | null;
  termometro: { geral: "verde" | "amarelo" | "vermelho"; acesos: number; sinais: Sinal[] };
};

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
export const nomeMes = (m: number) => MESES[(m + 11) % 12];

const brlCurto = (v: number) =>
  v >= 1e6
    ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const ORIGEM: Record<string, string> = {
  olx: "portal OLX",
  meta: "Meta (Facebook/Instagram)",
  whatsapp: "WhatsApp",
  site: "site",
  formulario: "formulário",
  simulador: "simulador",
  manual: "cadastro manual",
  outro: "outra origem",
};

const tempo = (horas: number) => {
  if (horas < 48) return `${horas} h`;
  const d = Math.floor(horas / 24);
  return `${d} dias`;
};

const variacao = (a: number | null, b: number | null) =>
  a == null || b == null || b === 0 ? null : (a - b) / b;
const div = (a: number, b: number) => (b > 0 ? a / b : null);

/** VGV do mês da empresa: 1 vez por venda (mesma regra do painel Metas 2027), pela assinatura. */
export function vgvDoMes(real: RealizadoRpc, hoje: string): number {
  const [a, m] = hoje.split("-").map(Number);
  const vistos = new Set<string>();
  let t = 0;
  for (const v of real.vendas) {
    if (v.conta_equipe === false || vistos.has(v.sale_id) || mesNoAno(v.venda_em, a) !== m)
      continue;
    vistos.add(v.sale_id);
    t += n(v.vgv);
  }
  return Math.round(t * 100) / 100;
}

/**
 * Comissão do mês da empresa: soma da parte de comissão de cada pessoa (sem o coordenador de lançamento), pela
 * assinatura. É a mesma base que o painel Metas 2027 · Imobiliária compara com a meta de comissão da direção.
 */
export function comissaoDoMes(real: RealizadoRpc, hoje: string): number {
  const [a, m] = hoje.split("-").map(Number);
  let t = 0;
  for (const v of real.vendas)
    if (v.conta_equipe !== false && mesNoAno(v.venda_em, a) === m) t += n(v.comissao);
  return Math.round(t * 100) / 100;
}

function cartao(
  valor: number | null,
  meta: number | null,
  antes: number | null,
  frac: number,
): Cartao {
  const pct = valor != null && meta != null && meta > 0 ? valor / meta : null;
  return {
    valor,
    meta,
    pct,
    ritmo: pct != null && frac > 0 ? pct / frac : null,
    antes,
    variacao: variacao(valor, antes),
  };
}

export function montarAvisos(r: ResumoRpc): Aviso[] {
  const L = LIMITES_RESUMO;
  const xs: Aviso[] = [];
  if (r.leads && r.leads.sem_atendimento > 0) {
    const h = r.leads.mais_antigo_horas;
    const o = r.leads.mais_antigo_origem;
    xs.push({
      chave: "leads",
      tom: "red",
      qtd: r.leads.sem_atendimento,
      titulo: `${r.leads.sem_atendimento === 1 ? "lead sem atendimento" : "leads sem atendimento"} há mais de ${L.leadHoras}h`,
      detalhe:
        h != null
          ? `O mais antigo espera há ${tempo(h)}${o ? ` (${ORIGEM[o] ?? o})` : ""}.`
          : "Ainda não foram aceitos por nenhum corretor.",
      para: "/painel-leads",
    });
  }
  if (r.alugueis && r.alugueis.qtd > 0)
    xs.push({
      chave: "alugueis",
      tom: "red",
      qtd: r.alugueis.qtd,
      titulo: r.alugueis.qtd === 1 ? "aluguel em atraso" : "aluguéis em atraso",
      detalhe: `${brlCurto(n(r.alugueis.valor))} em aberto${
        r.alugueis.maior_dias != null
          ? ` · o maior atraso tem ${r.alugueis.maior_dias} ${r.alugueis.maior_dias === 1 ? "dia" : "dias"}`
          : ""
      }.`,
      para: "/locacoes",
    });
  if (r.exclusivas && r.exclusivas.vencendo > 0) {
    const d = r.exclusivas.vencendo_primeira_dias;
    const im = r.exclusivas.vencendo_primeira_imovel;
    xs.push({
      chave: "exclusivas",
      tom: "amber",
      qtd: r.exclusivas.vencendo,
      titulo: `${r.exclusivas.vencendo === 1 ? "exclusiva vencendo" : "exclusivas vencendo"} em até ${L.vencendoDias} dias`,
      detalhe:
        d == null
          ? "Renove ou combine a próxima ação com o proprietário."
          : `A primeira vence ${d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`}${im ? ` (${im})` : ""}.`,
      para: "/exclusividades",
    });
  }
  if (r.vendas_paradas && r.vendas_paradas.qtd > 0) {
    const st = r.vendas_paradas.maior_status as SaleStatus | null;
    xs.push({
      chave: "vendas",
      tom: "amber",
      qtd: r.vendas_paradas.qtd,
      titulo: `${r.vendas_paradas.qtd === 1 ? "venda parada" : "vendas paradas"} há mais de ${L.paradaDias} dias`,
      detalhe:
        r.vendas_paradas.maior_dias != null
          ? `A mais antiga está parada há ${r.vendas_paradas.maior_dias} dias${
              st && STATUS_LABEL[st] ? ` em “${STATUS_LABEL[st]}”` : ""
            }.`
          : "Sem mudança de etapa.",
      para: "/vendas",
    });
  }
  if (r.novos_sem_venda > 0)
    xs.push({
      chave: "novos",
      tom: "blue",
      qtd: r.novos_sem_venda,
      titulo:
        r.novos_sem_venda === 1
          ? "corretor novo ainda sem venda"
          : "corretores novos ainda sem venda",
      detalhe: `Entraram há menos de ${L.novoDias} dias. Bom momento para uma 1:1.`,
      para: "/equipe",
    });
  return xs.slice(0, L.maxAvisos);
}

const pctTxt = (x: number) => `${Math.round(x * 100)}%`;

export function montarResumo(e: {
  resumo: ResumoRpc;
  direcao: DirecaoMes;
  /** metas_equipe_realizado do mês corrente e do mesmo período do mês anterior. */
  realMes: RealizadoRpc;
  realAnt: RealizadoRpc;
}): Resumo {
  const r = e.resumo;
  const L = LIMITES_RESUMO;
  const [a, m, d] = r.hoje.split("-").map(Number);
  const diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const frac = d / diasMes;
  const vgv = cartao(
    vgvDoMes(e.realMes, r.hoje),
    e.direcao.vgv,
    vgvDoMes(e.realAnt, r.ant_fim),
    frac,
  );
  const comissao = cartao(
    comissaoDoMes(e.realMes, r.hoje),
    e.direcao.comissao,
    comissaoDoMes(e.realAnt, r.ant_fim),
    frac,
  );
  const ex = r.exclusivas;
  const exclusivas = ex
    ? {
        novas: ex.novas_mes,
        ativas: ex.ativas,
        ativas30d: ex.ativas_30d,
        variacao: variacao(ex.ativas, ex.ativas_30d),
      }
    : null;
  const ld = r.leads;
  const leads = ld
    ? {
        recebidos: ld.recebidos_mes,
        pctNoPrazo: div(ld.no_prazo_mes, ld.elegiveis_mes),
        pctNoPrazoAnt: div(ld.no_prazo_ant, ld.elegiveis_ant),
        prazoMin: ld.prazo_aceite_min,
      }
    : null;
  const pr = r.produtivos;
  const produtivos = pr
    ? {
        qtd: pr.produtivos,
        total: pr.ativos,
        pct: div(pr.produtivos, pr.ativos),
        pctAnt: div(pr.produtivos_ant, pr.ativos_ant),
        variacao: variacao(div(pr.produtivos, pr.ativos), div(pr.produtivos_ant, pr.ativos_ant)),
        admins: pr.admins_que_venderam,
      }
    : null;

  // Termômetro: 5 sinais da empresa inteira, sem ranking. Módulo desligado / sem dado = cinza.
  const sinais: Sinal[] = [];
  // Meta: VGV × meta da direção (anual ÷ 12); sem meta de VGV usa a de comissão.
  const base = vgv.ritmo != null ? vgv : comissao.ritmo != null ? comissao : null;
  sinais.push(
    base?.ritmo != null && base.pct != null
      ? {
          chave: "meta",
          nome: "Meta do mês",
          cor:
            base.ritmo >= L.metaVerde
              ? "verde"
              : base.ritmo >= L.metaAmarelo
                ? "amarelo"
                : "vermelho",
          texto: `${pctTxt(base.pct)} da meta com ${pctTxt(frac)} do mês — ${
            base.ritmo >= L.metaVerde
              ? "à frente do ritmo"
              : base.ritmo >= L.metaAmarelo
                ? "um pouco abaixo do ritmo"
                : "abaixo do ritmo"
          }`,
        }
      : { chave: "meta", nome: "Meta do mês", cor: "cinza", texto: "Sem meta da direção definida" },
  );
  if (exclusivas) {
    const v = exclusivas.variacao;
    sinais.push({
      chave: "estoque",
      nome: "Estoque de exclusivas",
      cor: v == null || v >= 0 ? "verde" : -v <= L.estoqueAmarelo ? "amarelo" : "vermelho",
      texto:
        v == null
          ? `${exclusivas.ativas} ativas`
          : `${exclusivas.ativas} ativas — ${v >= 0 ? "subiu" : "caiu"} ${pctTxt(Math.abs(v))} em 30 dias`,
    });
  } else sinais.push({ chave: "estoque", nome: "Estoque de exclusivas", cor: "cinza", texto: "—" });
  if (leads && leads.pctNoPrazo != null) {
    const p = leads.pctNoPrazo;
    sinais.push({
      chave: "leads",
      nome: "Leads sem resposta",
      cor: p >= L.leadsVerde ? "verde" : p >= L.leadsAmarelo ? "amarelo" : "vermelho",
      texto: `${pctTxt(p)} atendidos no prazo${p >= L.leadsVerde ? "" : ` (meta ${pctTxt(L.leadsVerde)})`}`,
    });
  } else
    sinais.push({
      chave: "leads",
      nome: "Leads sem resposta",
      cor: "cinza",
      texto: leads ? "Nenhum lead no mês" : "—",
    });
  if (produtivos && produtivos.pct != null) {
    const p = produtivos.pct;
    sinais.push({
      chave: "produtivos",
      nome: "Corretores produtivos",
      cor: p >= L.produtivosVerde ? "verde" : p >= L.produtivosAmarelo ? "amarelo" : "vermelho",
      texto: `${produtivos.qtd} de ${produtivos.total} venderam em ${L.produtivoDias} dias (${pctTxt(p)})`,
    });
  } else
    sinais.push({ chave: "produtivos", nome: "Corretores produtivos", cor: "cinza", texto: "—" });
  const paradas = r.vendas_paradas?.qtd ?? 0;
  sinais.push({
    chave: "vendas",
    nome: "Vendas andando",
    cor: paradas <= L.paradasVerde ? "verde" : paradas <= L.paradasAmarelo ? "amarelo" : "vermelho",
    texto:
      paradas === 0
        ? `Nenhuma venda parada há mais de ${L.paradaDias} dias`
        : paradas <= L.paradasVerde
          ? `Só ${paradas} ${paradas === 1 ? "venda parada" : "vendas paradas"} há mais de ${L.paradaDias} dias`
          : `${paradas} vendas paradas há mais de ${L.paradaDias} dias`,
  });
  const verm = sinais.filter((s) => s.cor === "vermelho").length;
  const acesos = verm + sinais.filter((s) => s.cor === "amarelo").length;
  const geral = verm > 0 || acesos >= 3 ? "vermelho" : acesos > 0 ? "amarelo" : "verde";

  return {
    hoje: r.hoje,
    dia: d,
    fracMes: frac,
    mesAnterior: nomeMes(m - 1),
    avisos: montarAvisos(r),
    vgv,
    comissao,
    exclusivas,
    leads,
    produtivos,
    termometro: { geral, acesos, sinais },
  };
}

/** Períodos que a tela pede ao banco: mês corrente (até hoje) e o mesmo período do mês anterior. */
export function periodosResumo(hoje: string) {
  const [a, m, d] = hoje.split("-").map(Number);
  const ini = `${hoje.slice(0, 7)}-01`;
  const am = m === 1 ? 12 : m - 1;
  const aa = m === 1 ? a - 1 : a;
  const diasAnt = new Date(Date.UTC(aa, am, 0)).getUTCDate();
  const p = (x: number) => String(x).padStart(2, "0");
  return {
    mes: { inicio: ini, fim: hoje },
    ant: { inicio: `${aa}-${p(am)}-01`, fim: `${aa}-${p(am)}-${p(Math.min(d, diasAnt))}` },
  };
}
