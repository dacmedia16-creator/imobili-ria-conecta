// Leads — piloto P1 (card t_2472761a; "sim" de Denis em 24/10/2026). Lógica pura, sem imports.
// O banco (migration 20261025120000_leads_piloto) é a proteção real: RLS por imobiliária + módulo
// "leads" + RPCs que validam papel e etapa. Aqui só ficam rótulos, ordem e filtros da tela.

export const ETAPAS = [
  "novo",
  "em_atendimento",
  "visita_agendada",
  "proposta",
  "ganho",
  "perdido",
] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ETAPA_LABEL: Record<Etapa, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  visita_agendada: "Visita agendada",
  proposta: "Proposta",
  ganho: "Ganho",
  perdido: "Perdido",
};

/** Tom do Pill (visual/base) por etapa: sempre cor + texto. */
export const ETAPA_TOM: Record<Etapa, "blue" | "amber" | "violet" | "slate" | "green" | "red"> = {
  novo: "blue",
  em_atendimento: "amber",
  visita_agendada: "violet",
  proposta: "slate",
  ganho: "green",
  perdido: "red",
};

export const ORIGENS = [
  "manual",
  "formulario",
  "simulador",
  "whatsapp",
  "olx",
  "meta",
  "site",
  "outro",
] as const;
export type Origem = (typeof ORIGENS)[number];
export const ORIGEM_LABEL: Record<Origem, string> = {
  manual: "Manual",
  formulario: "Formulário",
  simulador: "Simulador",
  whatsapp: "WhatsApp",
  olx: "OLX",
  meta: "Meta",
  site: "Site",
  outro: "Outro",
};

export type Lead = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  origem: Origem;
  mensagem: string | null;
  etapa: Etapa;
  etapa_em: string;
  responsavel_id: string | null;
  atribuido_em: string | null;
  capture_id: string | null;
  captador_id: string | null;
  motivo_perda_id: string | null;
  motivo_perda_obs: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadEvento = {
  id: string;
  lead_id: string;
  tipo: "criado" | "etapa" | "atribuido" | "nota" | "vinculo";
  de: string | null;
  para: string | null;
  nota: string | null;
  autor_id: string | null;
  created_at: string;
};

export type MotivoPerda = { id: string; nome: string; ordem: number; ativo: boolean };
export type Pessoa = { id: string; nome: string };
export type CapturaOpcao = {
  id: string;
  captador_id: string;
  captador: string | null;
  tipo: string | null;
  bairro: string | null;
};

/** Papéis que atendem lead ("Meus leads"). Mesma lista de lead_pode_ser_responsavel no banco. */
export const PAPEIS_ATENDIMENTO = ["corretor", "team_leader", "gestor", "admin", "super_admin"];
/** Papéis que acompanham o painel (TL vê só a equipe; a RLS decide). */
export const PAPEIS_PAINEL = ["team_leader", "gestor", "admin", "super_admin"];
export const podeAtenderLeads = (roles: readonly string[]) =>
  roles.some((r) => PAPEIS_ATENDIMENTO.includes(r));
export const podeVerPainelLeads = (roles: readonly string[]) =>
  roles.some((r) => PAPEIS_PAINEL.includes(r));

export const encerrado = (e: Etapa) => e === "ganho" || e === "perdido";

/** Etapas para onde o lead pode ir a partir da tela (o banco repete a regra). */
export function proximasEtapas(atual: Etapa, gestor: boolean): Etapa[] {
  if (encerrado(atual) && !gestor) return [];
  return ETAPAS.filter((e) => e !== atual);
}

export type FiltroLeads = { etapa: Etapa | ""; responsavel: string; busca: string };
export const FILTRO_VAZIO: FiltroLeads = { etapa: "", responsavel: "", busca: "" };
/** Valor especial do filtro de responsável: leads ainda sem dono. */
export const SEM_RESPONSAVEL = "__sem__";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export function filtrarLeads(leads: Lead[], f: FiltroLeads): Lead[] {
  const q = norm(f.busca);
  const qDig = f.busca.replace(/\D/g, "");
  return leads.filter((l) => {
    if (f.etapa && l.etapa !== f.etapa) return false;
    if (
      f.responsavel === SEM_RESPONSAVEL
        ? l.responsavel_id !== null
        : f.responsavel && l.responsavel_id !== f.responsavel
    )
      return false;
    if (!q) return true;
    if (norm(l.nome).includes(q) || norm(l.email ?? "").includes(q)) return true;
    return qDig.length >= 3 && (l.telefone ?? "").includes(qDig);
  });
}

export function contarPorEtapa(leads: Lead[]): Record<Etapa, number> {
  const c = Object.fromEntries(ETAPAS.map((e) => [e, 0])) as Record<Etapa, number>;
  for (const l of leads) c[l.etapa]++;
  return c;
}

/** Resumo do painel: total, sem dono, em aberto, ganhos, perdidos e % de ganho dos encerrados. */
export function resumoPainel(leads: Lead[]) {
  const c = contarPorEtapa(leads);
  const encerrados = c.ganho + c.perdido;
  return {
    total: leads.length,
    semResponsavel: leads.filter((l) => !l.responsavel_id && !encerrado(l.etapa)).length,
    abertos: leads.length - encerrados,
    ganhos: c.ganho,
    perdidos: c.perdido,
    taxaGanho: encerrados ? Math.round((c.ganho / encerrados) * 100) : null,
  };
}

/** Normaliza telefone como o banco (só dígitos e +). */
export function normalizarTelefone(t: string): string {
  return t.replace(/[^0-9+]/g, "");
}

export type NovoLeadForm = {
  nome: string;
  telefone: string;
  email: string;
  origem: Origem;
  mensagem: string;
  captureId: string;
  responsavelId: string;
};

/** Validação da tela (o banco valida de novo). Devolve a mensagem de erro ou null. */
export function validarNovoLead(f: NovoLeadForm): string | null {
  if (!f.nome.trim()) return "Informe o nome do cliente.";
  if (f.nome.trim().length > 120) return "Nome longo demais.";
  const tel = normalizarTelefone(f.telefone);
  const email = f.email.trim();
  if (!tel && !email) return "Informe telefone ou e-mail.";
  if (tel && !/^\+?[0-9]{8,15}$/.test(tel)) return "Telefone inválido.";
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "E-mail inválido.";
  if (f.mensagem.length > 4000) return "Mensagem longa demais.";
  return null;
}

/** Texto de uma linha da linha do tempo. `nome` resolve ids de pessoa. */
export function textoEvento(e: LeadEvento, nome: (id: string | null) => string): string {
  switch (e.tipo) {
    case "criado":
      return `Lead criado (origem: ${ORIGEM_LABEL[e.para as Origem] ?? e.para ?? "—"})`;
    case "etapa":
      return `Etapa: ${ETAPA_LABEL[e.de as Etapa] ?? e.de ?? "—"} → ${ETAPA_LABEL[e.para as Etapa] ?? e.para ?? "—"}`;
    case "atribuido":
      return e.de
        ? `Responsável trocado: ${nome(e.de)} → ${nome(e.para)}`
        : `Responsável: ${nome(e.para)}`;
    case "nota":
      return "Anotação";
    default:
      return `Imóvel vinculado — captador: ${nome(e.para)}`;
  }
}

/** Mensagens do banco (RPCs) em português de tela. */
export function mensagemErroLead(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("desligado")) return "O módulo de leads está desligado nesta imobiliária.";
  if (m.includes("motivo da perda")) return "Escolha o motivo da perda.";
  if (m.includes("so gestor ou administrador reabre"))
    return "Lead encerrado: só gestor ou administrador reabre.";
  if (m.includes("apenas gestor")) return "Só gestor ou administrador pode fazer isso.";
  if (m.includes("lead nao encontrado")) return "Lead não encontrado ou sem acesso.";
  if (m.includes("responsavel invalido")) return "Responsável inválido para esta imobiliária.";
  if (m.includes("captacao nao encontrada")) return "Captação não encontrada nesta imobiliária.";
  if (m.includes("leads_contato")) return "Informe telefone ou e-mail.";
  return "Não foi possível concluir. Tente de novo.";
}
