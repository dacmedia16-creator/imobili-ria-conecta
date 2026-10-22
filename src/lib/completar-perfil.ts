import { validCpf, validCreci } from "@/lib/exclusive-captures-ocr";

/**
 * Tela "Complete seu perfil" no primeiro acesso (t_9e90351e, pedido de Denis em 20/10/2026).
 *
 * Quem passa por ela: só quem é APENAS corretor na imobiliária e teve a conta criada a partir de
 * COMPLETAR_PERFIL_DESDE (contas novas). Admin, gestor, team leader, jurídico, financeiro etc. não
 * passam — hoje a maioria deles tem perfil incompleto e seria travada. Quem já usava o sistema antes
 * dessa data também não é bloqueado. Super-admin da plataforma, "Ver como" e visão da plataforma
 * nunca veem a tela.
 *
 * Usa só campos que o perfil já tem (profiles): foto (avatar_url), nome, telefone, CPF, CRECI.
 * ID RE/MAX aparece na tela, mas é opcional (corretor novo pode ainda não ter).
 *
 * Para desligar: troque COMPLETAR_PERFIL_ATIVO para false.
 */
export const COMPLETAR_PERFIL_ATIVO = true;
export const COMPLETAR_PERFIL_DESDE = "2026-10-20T00:00:00Z";

export type PerfilParaCompletar = {
  nome: string | null;
  telefone: string | null;
  avatar_url: string | null;
  cpf: string | null;
  creci: string | null;
};

export type CampoPerfil = "foto" | "nome" | "telefone" | "cpf" | "creci";

export const CAMPO_LABEL: Record<CampoPerfil, string> = {
  foto: "Foto de perfil",
  nome: "Nome completo",
  telefone: "Telefone (WhatsApp)",
  cpf: "CPF",
  creci: "CRECI",
};

export function nomeCompletoValido(nome: string | null | undefined): boolean {
  return (nome ?? "").trim().split(/\s+/).filter(Boolean).length >= 2;
}

export function telefoneValido(telefone: string | null | undefined): boolean {
  const d = (telefone ?? "").replace(/\D/g, "");
  return d.length >= 10 && d.length <= 13;
}

/** CPF digitado (com ou sem pontuação) → formato do banco 000.000.000-00, ou null se inválido. */
export function normalizarCpf(valor: string | null | undefined): string | null {
  const d = (valor ?? "").replace(/\D/g, "");
  if (d.length !== 11) return null;
  const f = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return validCpf(f) ? f : null;
}

export function camposFaltando(p: PerfilParaCompletar): CampoPerfil[] {
  const faltando: CampoPerfil[] = [];
  if (!p.avatar_url?.trim()) faltando.push("foto");
  if (!nomeCompletoValido(p.nome)) faltando.push("nome");
  if (!telefoneValido(p.telefone)) faltando.push("telefone");
  if (!normalizarCpf(p.cpf)) faltando.push("cpf");
  if (!p.creci?.trim() || !validCreci(p.creci)) faltando.push("creci");
  return faltando;
}

/**
 * Lembrete "Complete seu perfil" que NÃO trava (t_e951a6f1, escolha de Denis em 20/10/2026): para o
 * corretor com conta ANTERIOR a COMPLETAR_PERFIL_DESDE e perfil incompleto. Abre o mesmo formulário,
 * com "Agora não"; volta a aparecer a cada novo login enquanto o perfil estiver incompleto.
 *
 * Para desligar só o lembrete (a tela obrigatória continua): troque LEMBRETE_PERFIL_ATIVO para false.
 */
export const LEMBRETE_PERFIL_ATIVO = true;

type ContextoAcesso = {
  roles: string[];
  platformAdmin: boolean;
  emVisaoDaPlataforma: boolean;
  vendoComo: boolean;
};

/** Só quem é APENAS corretor, fora da visão da plataforma e do "Ver como". */
function somenteCorretor(input: ContextoAcesso): boolean {
  if (input.platformAdmin || input.emVisaoDaPlataforma || input.vendoComo) return false;
  return input.roles.length > 0 && input.roles.every((r) => r === "corretor");
}

/** Decide, só pelo papel e pelo contexto, se a pessoa pode precisar da tela (sem ler o perfil). */
export function candidatoCompletarPerfil(input: ContextoAcesso): boolean {
  if (!COMPLETAR_PERFIL_ATIVO) return false;
  return somenteCorretor(input);
}

/** Pode precisar da tela obrigatória OU do lembrete (decide se vale ler o perfil). */
export function candidatoPerfilOuLembrete(input: ContextoAcesso): boolean {
  if (!COMPLETAR_PERFIL_ATIVO && !LEMBRETE_PERFIL_ATIVO) return false;
  return somenteCorretor(input);
}

export function contaNova(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t >= Date.parse(COMPLETAR_PERFIL_DESDE);
}

export function precisaCompletarPerfil(input: {
  roles: string[];
  platformAdmin: boolean;
  emVisaoDaPlataforma: boolean;
  vendoComo: boolean;
  createdAt: string | null | undefined;
  /** Marcação manual na conta (app_metadata.completar_perfil = true), gravada só pelo servidor:
   * usada para conferir a tela com a conta de teste, que é anterior a COMPLETAR_PERFIL_DESDE. */
  forcar?: boolean;
  perfil: PerfilParaCompletar;
  /** Data de nascimento (t_dff88e75): true SÓ quando a leitura deu certo e não há data gravada.
   * Conta nova sem data vê a tela obrigatória; conta antiga nunca é travada nem lembrada por isso. */
  semDataNascimento?: boolean;
}): boolean {
  return (
    candidatoCompletarPerfil(input) &&
    (contaNova(input.createdAt) || input.forcar === true) &&
    (camposFaltando(input.perfil).length > 0 || input.semDataNascimento === true)
  );
}

export type ModoCompletarPerfil = "obrigatorio" | "lembrete" | null;

/**
 * "obrigatorio": conta nova (ou marcada) com perfil incompleto — trava até completar.
 * "lembrete": conta antiga com perfil incompleto — mostra o aviso, mas deixa entrar ("Agora não").
 * null: não mostra nada (perfil completo, outro papel, plataforma, "Ver como" ou chaves desligadas).
 */
export function modoCompletarPerfil(
  input: Parameters<typeof precisaCompletarPerfil>[0],
): ModoCompletarPerfil {
  if (precisaCompletarPerfil(input)) return "obrigatorio";
  if (
    LEMBRETE_PERFIL_ATIVO &&
    somenteCorretor(input) &&
    !contaNova(input.createdAt) &&
    input.forcar !== true &&
    camposFaltando(input.perfil).length > 0
  )
    return "lembrete";
  return null;
}

/**
 * Identificador do login atual (claim session_id do token do Supabase): igual durante a sessão,
 * inclusive após renovar o token, e diferente a cada novo login. "Agora não" vale só para ele.
 */
export function idDaSessao(accessToken: string | null | undefined): string | null {
  try {
    const payload = (accessToken ?? "").split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      session_id?: unknown;
    };
    return typeof json.session_id === "string" && json.session_id ? json.session_id : null;
  } catch {
    return null;
  }
}

/** Chave do "Agora não" no navegador, por usuário. Guarda o session_id do login em que foi adiado. */
export function chaveLembreteAdiado(userId: string): string {
  return `max:lembrete-perfil-adiado:${userId}`;
}

/** O lembrete foi adiado neste mesmo login? (Login novo → session_id diferente → aparece de novo.) */
export function lembreteAdiadoNestaSessao(
  adiadoEm: string | null | undefined,
  sessaoAtual: string | null | undefined,
): boolean {
  return Boolean(adiadoEm) && Boolean(sessaoAtual) && adiadoEm === sessaoAtual;
}
