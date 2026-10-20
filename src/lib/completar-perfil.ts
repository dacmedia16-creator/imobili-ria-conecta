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

/** Decide, só pelo papel e pelo contexto, se a pessoa pode precisar da tela (sem ler o perfil). */
export function candidatoCompletarPerfil(input: {
  roles: string[];
  platformAdmin: boolean;
  emVisaoDaPlataforma: boolean;
  vendoComo: boolean;
}): boolean {
  if (!COMPLETAR_PERFIL_ATIVO) return false;
  if (input.platformAdmin || input.emVisaoDaPlataforma || input.vendoComo) return false;
  return input.roles.length > 0 && input.roles.every((r) => r === "corretor");
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
}): boolean {
  return (
    candidatoCompletarPerfil(input) &&
    (contaNova(input.createdAt) || input.forcar === true) &&
    camposFaltando(input.perfil).length > 0
  );
}
