// Minha carreira, PR 5 (card t_2c0d5f0d): bloco "Diário de atividades" (sem pontos e fora do ranking,
// decisão de Denis em 16/10). Funções puras; os dados vêm da tabela carreira_diario e das RPCs
// meu_diario_contagens e carreira_diario_equipe (migração 20261016190000). O banco filtra por
// auth.uid() + current_org_id().

export type TipoAtividade = "ligacao" | "visita" | "acm";

/** Atividades da maquete, na ordem dos botões. O banco aceita só estes tipos. */
export const ATIVIDADES: { tipo: TipoAtividade; rotulo: string; plural: string }[] = [
  { tipo: "ligacao", rotulo: "Ligação", plural: "ligações" },
  { tipo: "visita", rotulo: "Visita", plural: "visitas" },
  { tipo: "acm", rotulo: "ACM", plural: "ACMs" },
];

const ORDEM: Record<string, number> = { ligacao: 1, visita: 2, acm: 3 };

export type RegistroDiario = {
  id: string;
  user_id: string;
  dia: string;
  tipo: string;
  quantidade: number;
  created_at: string;
};

export type ContagemDiario = { tipo: TipoAtividade; hoje: number; semana: number; mes: number };

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
export function nomeAtividade(tipo: string, quantidade: number): string {
  const a = ATIVIDADES.find((x) => x.tipo === tipo);
  if (!a) return tipo;
  return quantidade === 1 ? a.rotulo.toLowerCase().replace("acm", "ACM") : a.plural;
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

/** Sempre devolve as 3 atividades, na ordem dos botões (zero quando o banco não trouxer). */
export function normalizarContagens(
  rows: Record<string, unknown>[] | null | undefined,
): ContagemDiario[] {
  const porTipo = new Map((rows ?? []).map((r) => [String(r.tipo), r]));
  return ATIVIDADES.map(({ tipo }) => {
    const r = porTipo.get(tipo);
    return { tipo, hoje: z(r?.hoje), semana: z(r?.semana), mes: z(r?.mes) };
  });
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
export function resumoDia(dia: DiaDiario | undefined): string {
  if (!dia || dia.itens.length === 0) return "nenhuma atividade registrada";
  return dia.itens.map((i) => `${i.quantidade} ${nomeAtividade(i.tipo, i.quantidade)}`).join(" · ");
}
