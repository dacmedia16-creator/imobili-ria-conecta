// Locação — Fase 2, Financeiro parte 1 (t_be750361; maquete t_de4e155c). Regras puras: leitura fechada do que vem
// das RPCs, totais do painel e extrato por proprietário. O banco (migration 20261111120000) calcula multa, juros e
// repasse e repete toda checagem de papel, imobiliária e módulo; aqui só se exibe e soma o que veio pronto.

export type SituacaoContrato = "a_completar" | "ativo" | "encerrado";
export type SituacaoCobranca = "aberta" | "atraso" | "paga" | "cancelada";

export type LinhaRepasse = { t: string; v: number };

export type ConfigFin = {
  multaPct: number;
  jurosPctMes: number;
  multaSobre: "aluguel" | "total";
  multaPara: "proprietario" | "metade" | "imobiliaria";
  diasRepasse: number;
  condominioNoBoleto: boolean;
  iptuNoBoleto: boolean;
  iptuRepassaProprietario: boolean;
  indice: "IGP-M" | "IPCA" | "IVAR" | "INPC";
  retemPrimeiroAluguel: boolean;
};

/** Valores de EXEMPLO da maquete — todos "a confirmar" com o financeiro. */
export const CONFIG_FIN_PADRAO: ConfigFin = {
  multaPct: 10,
  jurosPctMes: 1,
  multaSobre: "aluguel",
  multaPara: "proprietario",
  diasRepasse: 5,
  condominioNoBoleto: true,
  iptuNoBoleto: true,
  iptuRepassaProprietario: true,
  indice: "IGP-M",
  retemPrimeiroAluguel: true,
};

export const INDICES = ["IGP-M", "IPCA", "IVAR", "INPC"] as const;

export type Contrato = {
  id: string;
  codigo: string;
  locacaoCodigo: string;
  situacao: SituacaoContrato;
  endereco: string;
  inquilinoNome: string;
  proprietarioNome: string;
  proprietarioDoc: string;
  dadosRepasse: string;
  garantia: string;
  aluguel: number;
  taxaAdm: number;
  condominio: number;
  iptu: number;
  diaVencimento: number;
  inicio: string;
  proximoReajuste: string;
  indice: string;
  chaveEm: string | null;
};

export type Cobranca = {
  id: string;
  contratoId: string;
  contratoCodigo: string;
  competencia: string;
  vencimento: string;
  aluguel: number;
  condominio: number;
  iptu: number;
  taxaAdm: number;
  valor: number;
  primeiroAluguel: boolean;
  status: "aberta" | "paga" | "cancelada";
  situacao: SituacaoCobranca;
  diasAtraso: number;
  pagoEm: string | null;
  valorPago: number | null;
  multa: number;
  juros: number;
  encargosHoje: { multa: number; juros: number; dias: number } | null;
  obs: string;
  inquilinoNome: string;
  proprietarioNome: string;
  endereco: string;
  baixaPorNome: string;
  repasseCalc: {
    linhas: LinhaRepasse[];
    total: number;
    previsto: string;
    retencaoPrimeiro: boolean;
  } | null;
  repasse: { id: string; valor: number; feitoEm: string; comprovante: string } | null;
  descontos: { id: string; descricao: string; valor: number }[];
};

export type EventoFin = { em: string; acao: string; descricao: string; atorNome: string };

export type PainelFin = {
  competencia: string;
  hoje: string;
  config: ConfigFin;
  podeRegras: boolean;
  contratos: Contrato[];
  cobrancas: Cobranca[];
  atrasadasAntes: Cobranca[];
  faltamGerar: number;
};

// --- leitura fechada --------------------------------------------------------------------------------------------
type O = Record<string, unknown>;
const obj = (x: unknown): O => (x && typeof x === "object" && !Array.isArray(x) ? (x as O) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const s = (x: unknown): string => (typeof x === "string" ? x : x == null ? "" : String(x));
const n = (x: unknown): number => {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : 0;
};
const nOuNull = (x: unknown): number | null => (x === null || x === undefined ? null : n(x));
const sOuNull = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const umDe = <T extends string>(x: unknown, ok: readonly T[], p: T): T =>
  ok.includes(x as T) ? (x as T) : p;

export function lerConfigFin(raw: unknown): ConfigFin {
  const o = obj(raw);
  const P = CONFIG_FIN_PADRAO;
  const bool = (k: string, p: boolean) => (typeof o[k] === "boolean" ? (o[k] as boolean) : p);
  const num = (k: string, p: number) => (o[k] === undefined || o[k] === null ? p : n(o[k]));
  return {
    multaPct: num("multa_pct", P.multaPct),
    jurosPctMes: num("juros_pct_mes", P.jurosPctMes),
    multaSobre: umDe(o.multa_sobre, ["aluguel", "total"] as const, P.multaSobre),
    multaPara: umDe(o.multa_para, ["proprietario", "metade", "imobiliaria"] as const, P.multaPara),
    diasRepasse: num("dias_repasse", P.diasRepasse),
    condominioNoBoleto: bool("condominio_no_boleto", P.condominioNoBoleto),
    iptuNoBoleto: bool("iptu_no_boleto", P.iptuNoBoleto),
    iptuRepassaProprietario: bool("iptu_repassa_proprietario", P.iptuRepassaProprietario),
    indice: umDe(o.indice, INDICES, P.indice),
    retemPrimeiroAluguel: bool("retem_primeiro_aluguel", P.retemPrimeiroAluguel),
  };
}

export function lerContrato(raw: unknown): Contrato {
  const o = obj(raw);
  return {
    id: s(o.id),
    codigo: s(o.codigo),
    locacaoCodigo: s(o.locacao_codigo),
    situacao: umDe(o.situacao, ["a_completar", "ativo", "encerrado"] as const, "a_completar"),
    endereco: s(o.endereco),
    inquilinoNome: s(o.inquilino_nome),
    proprietarioNome: s(o.proprietario_nome),
    proprietarioDoc: s(o.proprietario_doc),
    dadosRepasse: s(o.dados_repasse),
    garantia: s(o.garantia),
    aluguel: n(o.aluguel),
    taxaAdm: n(o.taxa_adm),
    condominio: n(o.condominio),
    iptu: n(o.iptu),
    diaVencimento: n(o.dia_vencimento),
    inicio: s(o.inicio),
    proximoReajuste: s(o.proximo_reajuste),
    indice: s(o.indice),
    chaveEm: sOuNull(o.chave_em),
  };
}

export function lerCobranca(raw: unknown): Cobranca {
  const o = obj(raw);
  const e = o.encargos_hoje ? obj(o.encargos_hoje) : null;
  const rc = o.repasse_calc ? obj(o.repasse_calc) : null;
  const rp = o.repasse ? obj(o.repasse) : null;
  return {
    id: s(o.id),
    contratoId: s(o.contrato_id),
    contratoCodigo: s(o.contrato_codigo),
    competencia: s(o.competencia),
    vencimento: s(o.vencimento),
    aluguel: n(o.aluguel),
    condominio: n(o.condominio),
    iptu: n(o.iptu),
    taxaAdm: n(o.taxa_adm),
    valor: n(o.valor),
    primeiroAluguel: o.primeiro_aluguel === true,
    status: umDe(o.status, ["aberta", "paga", "cancelada"] as const, "aberta"),
    situacao: umDe(o.situacao, ["aberta", "atraso", "paga", "cancelada"] as const, "aberta"),
    diasAtraso: n(o.dias_atraso),
    pagoEm: sOuNull(o.pago_em),
    valorPago: nOuNull(o.valor_pago),
    multa: n(o.multa),
    juros: n(o.juros),
    encargosHoje: e ? { multa: n(e.multa), juros: n(e.juros), dias: n(e.dias) } : null,
    obs: s(o.obs),
    inquilinoNome: s(o.inquilino_nome),
    proprietarioNome: s(o.proprietario_nome),
    endereco: s(o.endereco),
    baixaPorNome: s(o.baixa_por_nome),
    repasseCalc: rc
      ? {
          linhas: arr(rc.linhas).map((l) => ({ t: s(obj(l).t), v: n(obj(l).v) })),
          total: n(rc.total),
          previsto: s(rc.previsto),
          retencaoPrimeiro: rc.retencao_primeiro === true,
        }
      : null,
    repasse: rp
      ? {
          id: s(rp.id),
          valor: n(rp.valor),
          feitoEm: s(rp.feito_em),
          comprovante: s(rp.comprovante),
        }
      : null,
    descontos: arr(o.descontos).map((d) => ({
      id: s(obj(d).id),
      descricao: s(obj(d).descricao),
      valor: n(obj(d).valor),
    })),
  };
}

export function lerPainelFin(raw: unknown): PainelFin {
  const o = obj(raw);
  return {
    competencia: s(o.competencia),
    hoje: s(o.hoje),
    config: lerConfigFin(o.config),
    podeRegras: o.pode_regras === true,
    contratos: arr(o.contratos).map(lerContrato),
    cobrancas: arr(o.cobrancas).map(lerCobranca),
    atrasadasAntes: arr(o.atrasadas_antes).map(lerCobranca),
    faltamGerar: n(o.faltam_gerar),
  };
}

export function lerEventosFin(raw: unknown): EventoFin[] {
  return arr(obj(raw).eventos).map((e) => {
    const x = obj(e);
    return { em: s(x.em), acao: s(x.acao), descricao: s(x.descricao), atorNome: s(x.ator_nome) };
  });
}

// --- cálculos de exibição --------------------------------------------------------------------------------------------
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Valor devido hoje (cobrança + multa e juros se já venceu). Paga = valor pago. */
export function devidoHoje(c: Cobranca): number {
  if (c.status === "paga") return c.valorPago ?? c.valor;
  if (c.status === "cancelada") return 0;
  return r2(c.valor + (c.encargosHoje?.multa ?? 0) + (c.encargosHoje?.juros ?? 0));
}

export type ResumoPainel = {
  aReceber: number;
  recebido: number;
  emAtraso: number;
  qtdAtraso: number;
  repassesTotal: number;
  repassesFeitos: number;
  repassesPendentes: number;
  qtdRepassePendente: number;
  taxasImobiliaria: number;
  inadimplenciaPct: number;
};

/** Totais da competência (+ atrasos de meses anteriores entram em "em atraso"). */
export function resumoPainel(cobs: Cobranca[], atrasadasAntes: Cobranca[] = []): ResumoPainel {
  const t: ResumoPainel = {
    aReceber: 0,
    recebido: 0,
    emAtraso: 0,
    qtdAtraso: 0,
    repassesTotal: 0,
    repassesFeitos: 0,
    repassesPendentes: 0,
    qtdRepassePendente: 0,
    taxasImobiliaria: 0,
    inadimplenciaPct: 0,
  };
  let cobradoMes = 0;
  let atrasoMes = 0;
  for (const c of cobs) {
    if (c.status === "cancelada") continue;
    cobradoMes += c.valor;
    if (c.situacao === "paga") {
      t.recebido += c.valorPago ?? c.valor;
      const total = c.repasse ? c.repasse.valor : (c.repasseCalc?.total ?? 0);
      t.repassesTotal += total;
      if (c.repasse) t.repassesFeitos += total;
      else {
        t.repassesPendentes += total;
        t.qtdRepassePendente += 1;
      }
      t.taxasImobiliaria += c.repasseCalc?.retencaoPrimeiro
        ? c.aluguel
        : r2((c.aluguel * c.taxaAdm) / 100);
    } else if (c.situacao === "atraso") {
      t.emAtraso += devidoHoje(c);
      atrasoMes += c.valor;
      t.qtdAtraso += 1;
    } else {
      t.aReceber += c.valor;
    }
  }
  for (const c of atrasadasAntes) {
    t.emAtraso += devidoHoje(c);
    t.qtdAtraso += 1;
  }
  t.inadimplenciaPct = cobradoMes > 0 ? r2((atrasoMes / cobradoMes) * 100) : 0;
  for (const k of Object.keys(t) as (keyof ResumoPainel)[]) t[k] = r2(t[k]);
  return t;
}

export type LinhaExtrato = {
  data: string;
  contrato: string;
  competencia: string;
  descricao: string;
  valor: number;
  saldo: number;
};

/** Extrato do proprietário: lançamentos de cada cobrança paga e, quando feito, o repasse que zera o saldo. */
export function montarExtrato(cobs: Cobranca[]): LinhaExtrato[] {
  const ord = [...cobs]
    .filter((c) => c.status === "paga")
    .sort(
      (a, b) =>
        (a.pagoEm ?? "").localeCompare(b.pagoEm ?? "") ||
        a.competencia.localeCompare(b.competencia),
    );
  const out: LinhaExtrato[] = [];
  let saldo = 0;
  for (const c of ord) {
    const linhas = c.repasseCalc?.linhas ?? [];
    for (const l of linhas) {
      saldo = r2(saldo + l.v);
      out.push({
        data: c.pagoEm ?? "",
        contrato: c.contratoCodigo,
        competencia: c.competencia,
        descricao: l.t,
        valor: l.v,
        saldo,
      });
    }
    if (c.repasse) {
      saldo = r2(saldo - c.repasse.valor);
      out.push({
        data: c.repasse.feitoEm,
        contrato: c.contratoCodigo,
        competencia: c.competencia,
        descricao: "Repasse feito" + (c.repasse.comprovante ? ` (${c.repasse.comprovante})` : ""),
        valor: -c.repasse.valor,
        saldo,
      });
    }
  }
  return out;
}

/** Proprietários distintos (ignora maiúsculas e espaços), em ordem alfabética. */
export function proprietarios(contratos: Contrato[]): string[] {
  const m = new Map<string, string>();
  for (const c of contratos) {
    const nome = c.proprietarioNome.trim();
    if (nome && !m.has(nome.toLowerCase())) m.set(nome.toLowerCase(), nome);
  }
  return [...m.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function competenciaLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return "—";
  const nomes = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  return `${nomes[Number(m[2]) - 1]}/${m[1]}`;
}

/** Primeiro dia do mês deslocado (YYYY-MM-01). */
export function mesDeslocado(iso: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

export const SITUACAO_COB: Record<
  SituacaoCobranca,
  { label: string; tom: "blue" | "red" | "green" | "slate" }
> = {
  aberta: { label: "A vencer", tom: "blue" },
  atraso: { label: "Em atraso", tom: "red" },
  paga: { label: "Paga", tom: "green" },
  cancelada: { label: "Cancelada", tom: "slate" },
};

export const SITUACAO_CT: Record<
  SituacaoContrato,
  { label: string; tom: "amber" | "green" | "slate" }
> = {
  a_completar: { label: "A completar", tom: "amber" },
  ativo: { label: "Ativo", tom: "green" },
  encerrado: { label: "Encerrado", tom: "slate" },
};

export const MULTA_PARA_LABEL: Record<ConfigFin["multaPara"], string> = {
  proprietario: "Proprietário (100%)",
  metade: "Metade para cada",
  imobiliaria: "Imobiliária",
};
