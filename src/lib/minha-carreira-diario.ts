// Minha carreira, PR 5 (card t_2c0d5f0d): bloco "Diário de atividades" (sem pontos e fora do ranking,
// decisão de Denis em 16/10). Funções puras; os dados vêm da tabela carreira_diario e das RPCs
// meu_diario_contagens e carreira_diario_equipe (migração 20261016190000). O banco filtra por
// auth.uid() + current_org_id().

// Meta x atividades (t_09c29e96, decisão de Denis 08/11): o botão "Visita" deu lugar a V1, V2 e Visita
// com comprador (migração 20261108160000). Registros antigos "visita" continuam no histórico como
// "Visita (antiga)", sem apagar nem converter, e não entram em nenhuma meta.
export type TipoAtividade = "ligacao" | "v1" | "v2" | "acm" | "visita_comprador";
export type TipoHistorico = TipoAtividade | "visita";

type Atividade = {
  tipo: TipoAtividade;
  rotulo: string;
  singular: string;
  plural: string;
  dica: string;
};

/** Botões do diário, na ordem. Novos registros usam só estes tipos (nunca "visita"). */
export const ATIVIDADES: Atividade[] = [
  {
    tipo: "ligacao",
    rotulo: "Ligação",
    singular: "ligação",
    plural: "ligações",
    dica: "Contato com agendamento",
  },
  { tipo: "v1", rotulo: "V1", singular: "V1", plural: "V1", dica: "1ª visita ao proprietário" },
  {
    tipo: "v2",
    rotulo: "V2",
    singular: "V2",
    plural: "V2",
    dica: "2ª visita ao proprietário (Plano de Marketing e Venda + ACM)",
  },
  {
    tipo: "acm",
    rotulo: "ACM",
    singular: "ACM",
    plural: "ACMs",
    dica: "Análise comparativa de mercado",
  },
  {
    tipo: "visita_comprador",
    rotulo: "Visita com comprador",
    singular: "visita com comprador",
    plural: "visitas com comprador",
    dica: "Só contagem, sem meta",
  },
];

/** Tipo antigo, só para ler o histórico. */
export const VISITA_ANTIGA = {
  tipo: "visita" as const,
  rotulo: "Visita (antiga)",
  singular: "visita (antiga)",
  plural: "visitas (antigas)",
};

/**
 * Botões das imobiliárias em que o Meu Plano 2027 ainda NÃO está ligado: o diário segue como antes
 * (o banco também só recusa "visita" onde o módulo está ligado).
 */
export const BOTOES_SEM_PLANO: { tipo: TipoHistorico; rotulo: string; dica: string }[] = [
  { tipo: "ligacao", rotulo: "Ligação", dica: "Contato com agendamento" },
  { tipo: "visita", rotulo: "Visita", dica: "Visita" },
  { tipo: "acm", rotulo: "ACM", dica: "Análise comparativa de mercado" },
];

/** Botões do diário conforme o Meu Plano 2027 esteja ligado (novo) ou não. */
export const botoesDiario = (novo: boolean) => (novo ? ATIVIDADES : BOTOES_SEM_PLANO);

const ORDEM: Record<string, number> = {
  ligacao: 1,
  v1: 2,
  v2: 3,
  acm: 4,
  visita_comprador: 5,
  visita: 6,
};

export type RegistroDiario = {
  id: string;
  user_id: string;
  dia: string;
  tipo: string;
  quantidade: number;
  created_at: string;
};

export type ContagemDiario = { tipo: TipoHistorico; hoje: number; semana: number; mes: number };
/** Contagens do diário + captações exclusivas aprovadas (pela data de assinatura), vindas do banco. */
export type Contagens = { atividades: ContagemDiario[]; captacao: { semana: number; mes: number } };

export type LinhaEquipeDiario = {
  user_id: string;
  nome: string;
  ligacoes: number;
  visitas: number;
  acms: number;
  ultimo_dia: string | null;
};

export type DiaDiario = {
  dia: string;
  itens: { tipo: string; quantidade: number; ids: string[] }[];
};

/** Mesmo limite do banco: hoje até 31 dias atrás. */
export const DIAS_RETROATIVOS = 31;

const z = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);

/** Nome da atividade no singular ou plural, conforme a quantidade. */
/** `novo` = Meu Plano 2027 ligado: "visita" vira "visita (antiga)". */
export function nomeAtividade(tipo: string, quantidade: number, novo = true): string {
  if (tipo === VISITA_ANTIGA.tipo && !novo) return quantidade === 1 ? "visita" : "visitas";
  const a = tipo === VISITA_ANTIGA.tipo ? VISITA_ANTIGA : ATIVIDADES.find((x) => x.tipo === tipo);
  if (!a) return tipo;
  return quantidade === 1 ? a.singular : a.plural;
}

/** Rótulo curto de uma atividade (inclui "Visita (antiga)"). */
export function rotuloAtividade(tipo: string, novo = true): string {
  if (tipo === VISITA_ANTIGA.tipo) return novo ? VISITA_ANTIGA.rotulo : "Visita";
  return ATIVIDADES.find((x) => x.tipo === tipo)?.rotulo ?? tipo;
}

export function normalizarRegistro(r: Record<string, unknown>): RegistroDiario {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    dia: String(r.dia).slice(0, 10),
    tipo: String(r.tipo),
    quantidade: z(r.quantidade),
    created_at: String(r.created_at ?? ""),
  };
}

/**
 * Sempre devolve as 5 atividades na ordem dos botões (zero quando o banco não trouxer). A linha
 * "Visita (antiga)" só entra quando há registro antigo no mês. "captacao" vem à parte.
 */
export function normalizarContagens(
  rows: Record<string, unknown>[] | null | undefined,
  novo = true,
): Contagens {
  const porTipo = new Map((rows ?? []).map((r) => [String(r.tipo), r]));
  const linha = (tipo: TipoHistorico): ContagemDiario => {
    const r = porTipo.get(tipo);
    return { tipo, hoje: z(r?.hoje), semana: z(r?.semana), mes: z(r?.mes) };
  };
  const atividades = botoesDiario(novo).map(({ tipo }) => linha(tipo));
  const antiga = linha("visita");
  if (novo && (antiga.mes > 0 || antiga.semana > 0 || antiga.hoje > 0)) atividades.push(antiga);
  const cap = porTipo.get("captacao");
  return { atividades, captacao: { semana: z(cap?.semana), mes: z(cap?.mes) } };
}

/** Contagem de um tipo, no período. Tipo ausente = 0. */
export function contagem(c: Contagens, tipo: TipoHistorico, p: "hoje" | "semana" | "mes"): number {
  return c.atividades.find((a) => a.tipo === tipo)?.[p] ?? 0;
}

export function normalizarEquipe(
  rows: Record<string, unknown>[] | null | undefined,
): LinhaEquipeDiario[] {
  return (rows ?? []).map((r) => ({
    user_id: String(r.user_id),
    nome: (r.nome as string | null) ?? "Corretor",
    ligacoes: z(r.ligacoes),
    visitas: z(r.visitas),
    acms: z(r.acms),
    ultimo_dia: r.ultimo_dia ? String(r.ultimo_dia).slice(0, 10) : null,
  }));
}

/** Data ISO (aaaa-mm-dd) somada de n dias, sem fuso. */
export function somarDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Dia mais antigo aceito pelo banco para registrar. */
export function diaMinimo(hoje: string): string {
  return somarDias(hoje, -DIAS_RETROATIVOS);
}

export function diaPermitido(dia: string, hoje: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) && dia <= hoje && dia >= diaMinimo(hoje);
}

/** Segunda-feira da semana de `hoje` (mesma regra do banco: semana de segunda a domingo). */
export function inicioSemana(hoje: string): string {
  const [y, m, d] = hoje.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return somarDias(hoje, -dow);
}

/** Agrupa o histórico por dia (mais recente primeiro) e, no dia, por atividade na ordem dos botões. */
export function agruparPorDia(regs: RegistroDiario[]): DiaDiario[] {
  const dias = new Map<string, DiaDiario>();
  for (const r of regs) {
    const d = dias.get(r.dia) ?? { dia: r.dia, itens: [] };
    const item = d.itens.find((i) => i.tipo === r.tipo);
    if (item) {
      item.quantidade += r.quantidade;
      item.ids.push(r.id);
    } else {
      d.itens.push({ tipo: r.tipo, quantidade: r.quantidade, ids: [r.id] });
    }
    dias.set(r.dia, d);
  }
  const lista = [...dias.values()].sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0));
  for (const d of lista) d.itens.sort((a, b) => (ORDEM[a.tipo] ?? 99) - (ORDEM[b.tipo] ?? 99));
  return lista;
}

/** Resumo curto do dia, como na maquete: "6 ligações · 1 visita". */
export function resumoDia(dia: DiaDiario | undefined, novo = true): string {
  if (!dia || dia.itens.length === 0) return "nenhuma atividade registrada";
  return dia.itens
    .map((i) => `${i.quantidade} ${nomeAtividade(i.tipo, i.quantidade, novo)}`)
    .join(" · ");
}
