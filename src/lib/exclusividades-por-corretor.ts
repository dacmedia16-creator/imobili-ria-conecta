// Aba "Por corretor" do Painel e mapa das captações (maquete t_022158e9, aprovada por Denis em
// 08/10/2026). Só contas puras sobre captações que o banco JÁ liberou para quem está logado
// (exclusive_can_view: captador, admin, gestor/TL/líder auxiliar dos corretores que lidera).
// Nunca usa dados do proprietário nem comissão: só imóvel (endereço, bairro, tipo, valor),
// corretor, status, assinatura, prazo e Plano de Marketing.
import { captureValidity, type Capture, type Validity } from "./exclusive-captures";
import { bairroLabel, parseBRL } from "./exclusive-captures-dashboard";

export type Fase = "vigor" | "vencida" | "gestor" | "assinatura" | "rascunho";
export const FASE_LABEL: Record<Fase, string> = {
  vigor: "Em vigor",
  vencida: "Vencida",
  gestor: "Aguardando gestor",
  assinatura: "Em assinatura",
  rascunho: "Rascunho / devolvida",
};
export const FASE_STYLE: Record<Fase, string> = {
  vigor: "bg-emerald-100 text-emerald-800",
  vencida: "bg-red-100 text-red-800",
  gestor: "bg-blue-100 text-blue-800",
  assinatura: "bg-violet-100 text-violet-800",
  rascunho: "bg-slate-100 text-slate-700",
};

/** Fase da captação para a aba. Aprovada sem data/prazo conta como em vigor (sem dias). */
export function faseCaptacao(
  c: Pick<Capture, "status" | "signed_on" | "form_data">,
  today: string,
): Fase {
  if (c.status === "aprovada") {
    const v = captureValidity(c, today);
    return v && v.daysLeft < 0 ? "vencida" : "vigor";
  }
  if (c.status === "enviada") return "gestor";
  if (c.status === "em_assinatura") return "assinatura";
  return "rascunho";
}

/** Cor dos dias restantes (regra da maquete): verde > 60, amarelo 30–60, vermelho < 30 ou vencida. */
export type CorDias = "verde" | "amarelo" | "vermelho";
export function corDiasRestantes(daysLeft: number): CorDias {
  if (daysLeft > 60) return "verde";
  if (daysLeft >= 30) return "amarelo";
  return "vermelho";
}
export const COR_DIAS_STYLE: Record<CorDias, string> = {
  verde: "bg-emerald-100 text-emerald-800",
  amarelo: "bg-amber-100 text-amber-900",
  vermelho: "bg-red-100 text-red-800",
};
export function textoDiasRestantes(daysLeft: number): string {
  if (daysLeft < 0) return `venceu há ${-daysLeft} d`;
  if (daysLeft === 0) return "vence hoje";
  return `${daysLeft} dia${daysLeft === 1 ? "" : "s"}`;
}

/** Plano de Marketing: nº de ações escolhidas; null = ainda não definido. */
export function acoesPlanoMarketing(c: Pick<Capture, "form_data">): number | null {
  const d = c.form_data?.dossie;
  return Array.isArray(d) && d.length > 0 ? d.length : null;
}

export type FiltrosPorCorretor = {
  corretor: string; // captor_id
  fase: "" | Fase;
  /** "" = qualquer prazo; "15" | "30" | "60" | "90" = vence em até N dias; "vencidas". */
  vence: string;
  bairro: string;
};
export const FILTROS_POR_CORRETOR_VAZIOS: FiltrosPorCorretor = {
  corretor: "",
  fase: "",
  vence: "",
  bairro: "",
};
export const OPCOES_VENCE: { value: string; label: string }[] = [
  { value: "", label: "Qualquer prazo" },
  { value: "15", label: "até 15 dias" },
  { value: "30", label: "até 30 dias" },
  { value: "60", label: "até 60 dias" },
  { value: "90", label: "até 90 dias" },
  { value: "vencidas", label: "já vencidas" },
];

export type LinhaCaptacao = {
  c: Capture;
  fase: Fase;
  v: Validity | null;
  valor: number | null;
  bairro: string;
  plano: number | null;
};

export function linhaCaptacao(c: Capture, today: string): LinhaCaptacao {
  // Vigência só conta para captação aprovada (antes de assinar, só o prazo previsto).
  const v = c.status === "aprovada" ? captureValidity(c, today) : null;
  return {
    c,
    fase: faseCaptacao(c, today),
    v,
    valor: parseBRL(c.form_data?.imovel?.valor_imovel),
    bairro: bairroLabel(c),
    plano: acoesPlanoMarketing(c),
  };
}

export function passaFiltros(l: LinhaCaptacao, f: FiltrosPorCorretor): boolean {
  if (f.corretor && l.c.captor_id !== f.corretor) return false;
  if (f.bairro && l.bairro !== f.bairro) return false;
  if (f.fase && l.fase !== f.fase) return false;
  if (f.vence) {
    if (!l.v) return false;
    if (f.vence === "vencidas") return l.v.daysLeft < 0;
    const n = Number(f.vence);
    if (!(n > 0) || l.v.daysLeft < 0 || l.v.daysLeft > n) return false;
  }
  return true;
}

export type ResumoCorretor = {
  id: string;
  nome: string;
  linhas: LinhaCaptacao[];
  emVigor: number;
  valorEmVigor: number;
  vencem30: number;
  vencidas: number;
  aguardandoGestor: number;
  emAssinatura: number;
  rascunho: number;
  semPlano: number;
};

/** Ordena as captações do corretor: menos dias restantes primeiro; sem vigência por último. */
function ordenarLinhas(a: LinhaCaptacao, b: LinhaCaptacao): number {
  const da = a.v ? a.v.daysLeft : Number.POSITIVE_INFINITY;
  const db = b.v ? b.v.daysLeft : Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return (b.c.created_at ?? "").localeCompare(a.c.created_at ?? "");
}

/**
 * Resumo por corretor. `pessoas` (opcional) = corretores da equipe escolhida, na ordem desejada;
 * aparecem mesmo sem captação (linha zerada). Sem `pessoas`, usa quem tem captação na lista.
 */
export function resumoPorCorretor(
  linhas: LinhaCaptacao[],
  pessoas?: { id: string; nome: string }[],
): ResumoCorretor[] {
  const porId = new Map<string, ResumoCorretor>();
  const novo = (id: string, nome: string): ResumoCorretor => ({
    id,
    nome,
    linhas: [],
    emVigor: 0,
    valorEmVigor: 0,
    vencem30: 0,
    vencidas: 0,
    aguardandoGestor: 0,
    emAssinatura: 0,
    rascunho: 0,
    semPlano: 0,
  });
  for (const p of pessoas ?? []) porId.set(p.id, novo(p.id, p.nome));
  for (const l of linhas) {
    const id = l.c.captor_id;
    let r = porId.get(id);
    if (!r) {
      if (pessoas) continue; // fora da equipe escolhida
      r = novo(id, l.c.broker_name || "—");
      porId.set(id, r);
    }
    r.linhas.push(l);
    if (l.fase === "vigor") {
      r.emVigor++;
      r.valorEmVigor += l.valor ?? 0;
      if (l.v && l.v.daysLeft <= 30) r.vencem30++;
    } else if (l.fase === "vencida") r.vencidas++;
    else if (l.fase === "gestor") r.aguardandoGestor++;
    else if (l.fase === "assinatura") r.emAssinatura++;
    else r.rascunho++;
    if (l.plano === null) r.semPlano++;
  }
  const out = [...porId.values()];
  for (const r of out) r.linhas.sort(ordenarLinhas);
  if (!pessoas)
    out.sort(
      (a, b) =>
        b.emVigor - a.emVigor || b.linhas.length - a.linhas.length || a.nome.localeCompare(b.nome),
    );
  return out;
}

export type TotaisPorCorretor = {
  emVigor: number;
  valorEmVigor: number;
  vencem30: number;
  vencidas: number;
  aguardandoGestor: number;
  assinaturaOuRascunho: number;
  semValor: number;
};
export function totaisPorCorretor(linhas: LinhaCaptacao[]): TotaisPorCorretor {
  const t: TotaisPorCorretor = {
    emVigor: 0,
    valorEmVigor: 0,
    vencem30: 0,
    vencidas: 0,
    aguardandoGestor: 0,
    assinaturaOuRascunho: 0,
    semValor: 0,
  };
  for (const l of linhas) {
    if (l.fase === "vigor") {
      t.emVigor++;
      if (l.valor === null) t.semValor++;
      t.valorEmVigor += l.valor ?? 0;
      if (l.v && l.v.daysLeft <= 30) t.vencem30++;
    } else if (l.fase === "vencida") t.vencidas++;
    else if (l.fase === "gestor") t.aguardandoGestor++;
    else t.assinaturaOuRascunho++;
  }
  return t;
}

/** Equipe escolhida: líder, líderes auxiliares e membros (mesma composição do Painel da Equipe). */
export type EstruturaEquipes = {
  teams: { id: string; lider_id: string | null }[];
  membros: { team_id: string; membro_id: string }[];
  coLideres: { team_id: string; user_id: string }[];
};
export function pessoasDaEquipe(teamId: string, e: EstruturaEquipes): Set<string> {
  const ids = new Set<string>();
  const t = e.teams.find((x) => x.id === teamId);
  if (t?.lider_id) ids.add(t.lider_id);
  for (const c of e.coLideres) if (c.team_id === teamId) ids.add(c.user_id);
  for (const m of e.membros) if (m.team_id === teamId) ids.add(m.membro_id);
  return ids;
}
