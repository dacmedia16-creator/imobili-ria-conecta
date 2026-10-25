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
  // P3 (migration 20261025150000): aceite, interação e banco "Leads da imobiliária".
  aceito_em: string | null;
  ultima_interacao_em: string | null;
  no_banco_desde: string | null;
  simulado: boolean;
  // Contato (migration 20261025160000): false = o banco não liberou telefone/e-mail (aguardando aceite).
  contato_liberado: boolean;
};

export type LeadContato = { id: string; telefone: string | null; email: string | null };
export type LeadSemContato = Omit<Lead, "telefone" | "email" | "contato_liberado">;

/** Junta o contato liberado pelo banco (lead_contatos) aos leads; sem linha = contato oculto. */
export function juntarContatos(leads: LeadSemContato[], contatos: LeadContato[]): Lead[] {
  const m = new Map(contatos.map((c) => [c.id, c]));
  return leads.map((l) => {
    const c = m.get(l.id);
    return { ...l, telefone: c?.telefone ?? null, email: c?.email ?? null, contato_liberado: !!c };
  });
}

export type LeadEvento = {
  id: string;
  lead_id: string;
  tipo:
    | "criado"
    | "etapa"
    | "atribuido"
    | "nota"
    | "vinculo"
    | "aceite"
    | "devolvido_banco"
    | "redistribuido"
    | "ligacao"
    | "ia";
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
    case "ligacao":
      return "Ligação registrada";
    case "ia":
      return (
        {
          iniciada: "IA de atendimento iniciou a conversa",
          qualificado: "IA qualificou o lead e passou ao corretor",
          pediu_pessoa: "Cliente pediu uma pessoa: IA passou ao corretor",
          sensivel: "Assunto sensível: IA passou ao corretor e ao gestor",
          sem_interesse: "Cliente disse que não tem interesse",
          optout: "Cliente pediu para não receber mensagens (SAIR)",
          parada_manual: "IA parada manualmente",
          limite: "Conversa longa: IA passou ao corretor",
        }[e.para ?? ""] ?? "IA de atendimento"
      );
    case "aceite":
      return `Lead aceito por ${nome(e.para)}`;
    case "devolvido_banco":
      return "Devolvido ao banco “Leads da imobiliária”";
    case "redistribuido":
      return e.de === "banco"
        ? `Saiu do banco para ${nome(e.para)}`
        : `Passado de ${nome(e.de)} para ${nome(e.para)}`;
    default:
      return `Imóvel vinculado — captador: ${nome(e.para)}`;
  }
}

// --- P3: prazos (mesma regra da tarefa agendada leads_processar_prazos) -------------------------

export type LeadConfig = {
  prazo_aceite_min: number;
  prazo_primeira_interacao_dias: number;
  prazo_sem_interacao_dias: number;
  distribuicao: "captador_depois_rodizio" | "rodizio" | "manual";
  form_publico_ativo: boolean;
  form_token: string | null;
};

export const CONFIG_PADRAO: LeadConfig = {
  prazo_aceite_min: 1440,
  prazo_primeira_interacao_dias: 7,
  prazo_sem_interacao_dias: 30,
  distribuicao: "captador_depois_rodizio",
  form_publico_ativo: false,
  form_token: null,
};

export const DISTRIBUICAO_LABEL: Record<LeadConfig["distribuicao"], string> = {
  captador_depois_rodizio: "Captador do imóvel, depois rodízio",
  rodizio: "Só rodízio",
  manual: "Manual (gestor distribui)",
};

const MIN = 60_000;
const DIA = 24 * 60 * MIN;

/** "24 h", "30 min", "7 dias"... */
export function duracaoTxt(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} dias`;
}

export type PrazoLead =
  | { tipo: "encerrado" | "banco" | "sem_responsavel" }
  | { tipo: "aceite" | "primeira_interacao" | "sem_interacao"; vence: Date; restante: number };

/** Qual prazo está correndo para o lead agora (para mostrar na tela). */
export function prazoDoLead(l: Lead, c: LeadConfig, agora = new Date()): PrazoLead {
  if (encerrado(l.etapa)) return { tipo: "encerrado" };
  if (l.no_banco_desde) return { tipo: "banco" };
  if (!l.responsavel_id) return { tipo: "sem_responsavel" };
  const base = (iso: string | null, extra: number) =>
    new Date(new Date(iso ?? l.created_at).getTime() + extra);
  let tipo: "aceite" | "primeira_interacao" | "sem_interacao";
  let vence: Date;
  if (!l.aceito_em) {
    tipo = "aceite";
    vence = base(l.atribuido_em, c.prazo_aceite_min * MIN);
  } else if (!l.ultima_interacao_em) {
    tipo = "primeira_interacao";
    vence = base(l.aceito_em, c.prazo_primeira_interacao_dias * DIA);
  } else {
    tipo = "sem_interacao";
    vence = base(l.ultima_interacao_em, c.prazo_sem_interacao_dias * DIA);
  }
  return { tipo, vence, restante: vence.getTime() - agora.getTime() };
}

/** Texto curto do prazo: "Aceitar em 23 h", "1ª interação em 6 dias"... */
export function textoPrazo(p: PrazoLead): string | null {
  switch (p.tipo) {
    case "encerrado":
    case "sem_responsavel":
      return null;
    case "banco":
      return "No banco da imobiliária";
    default: {
      const quando = p.restante <= 0 ? "vencido" : `em ${duracaoTxt(p.restante)}`;
      const o = {
        aceite: "Aceitar",
        primeira_interacao: "1ª interação",
        sem_interacao: "Próxima interação",
      };
      return `${o[p.tipo]} ${quando}`;
    }
  }
}

/** Lead aguardando aceite do próprio usuário. */
export const aguardandoMeuAceite = (l: Lead, userId: string | undefined) =>
  !!userId && l.responsavel_id === userId && !l.aceito_em && !encerrado(l.etapa);

export function validarConfig(c: LeadConfig): string | null {
  if (!Number.isInteger(c.prazo_aceite_min) || c.prazo_aceite_min < 1 || c.prazo_aceite_min > 1440)
    return "Prazo de aceite entre 1 minuto e 24 horas.";
  if (
    !Number.isInteger(c.prazo_primeira_interacao_dias) ||
    c.prazo_primeira_interacao_dias < 1 ||
    c.prazo_primeira_interacao_dias > 90
  )
    return "Prazo da 1ª interação entre 1 e 90 dias.";
  if (
    !Number.isInteger(c.prazo_sem_interacao_dias) ||
    c.prazo_sem_interacao_dias < 1 ||
    c.prazo_sem_interacao_dias > 365
  )
    return "Prazo sem interação entre 1 e 365 dias.";
  return null;
}

// --- P2: banco, simulador e formulário público --------------------------------------------------

export type LeadBanco = {
  id: string;
  nome: string;
  origem: Origem;
  etapa: Etapa;
  no_banco_desde: string;
  created_at: string;
  com_imovel: boolean;
  simulado: boolean;
  mensagem: string | null;
};

export const ORIGENS_SIMULADOR = ["olx", "meta", "site"] as const;
export type OrigemSimulador = (typeof ORIGENS_SIMULADOR)[number];

/** Texto do consentimento LGPD gravado junto com o lead do formulário público. */
export const CONSENTIMENTO_LGPD =
  "Autorizo a imobiliária a usar meu nome, telefone e e-mail somente para retornar este contato " +
  "sobre imóveis, conforme a LGPD. Posso pedir a exclusão dos meus dados a qualquer momento.";

/** Tempo mínimo (ms) entre abrir e enviar o formulário: robô costuma enviar na hora. */
export const FORM_TEMPO_MINIMO_MS = 3000;

export type FormPublico = {
  nome: string;
  telefone: string;
  email: string;
  mensagem: string;
  consentimento: boolean;
  /** Campo-armadilha escondido: gente não vê nem preenche; robô preenche. */
  site: string;
};

export function validarFormPublico(f: FormPublico): string | null {
  const base = validarNovoLead({
    nome: f.nome,
    telefone: f.telefone,
    email: f.email,
    origem: "formulario",
    mensagem: f.mensagem,
    captureId: "",
    responsavelId: "",
  });
  if (base) return base;
  if (f.mensagem.length > 1000) return "Mensagem longa demais.";
  if (!f.consentimento) return "Marque a autorização de contato (LGPD).";
  return null;
}

/** Anti-spam gratuito do formulário: armadilha + tempo mínimo. Devolve true se parece robô. */
export function pareceRobo(f: Pick<FormPublico, "site">, abertoEm: number, agora: number) {
  return f.site.trim() !== "" || agora - abertoEm < FORM_TEMPO_MINIMO_MS;
}

export const FORM_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

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
  if (m.includes("aceite o lead")) return "Aceite o lead antes de registrar o atendimento.";
  if (m.includes("so o responsavel aceita")) return "Só o responsável pode aceitar este lead.";
  if (m.includes("nao esta mais no banco")) return "Outro corretor já pegou este lead.";
  if (m.includes("sem papel de atendimento") || m.includes("sem acesso ao banco"))
    return "Seu papel não atende leads.";
  if (m.includes("apenas administrador")) return "Só o administrador altera esta configuração.";
  if (m.includes("entre 1 e 20")) return "O simulador cria de 1 a 20 leads por vez.";
  if (m.includes("lead encerrado")) return "Lead encerrado.";
  if (m.includes("simulador so funciona no modo teste"))
    return "O simulador de cliente só funciona com a IA em modo teste.";
  if (m.includes("configuracao da ia invalida")) return "Confira o nome e o texto da IA.";
  if (m.includes("conversa nao encontrada")) return "Este lead não tem conversa da IA.";
  if (m.includes("mensagem vazia")) return "Escreva a mensagem (até 1000 caracteres).";
  return "Não foi possível concluir. Tente de novo.";
}
