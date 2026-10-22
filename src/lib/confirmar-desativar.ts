/**
 * Regras da confirmação de ativar/desativar na tela Usuários (t_bb21d8d4).
 * Desativar sempre pede confirmação; ativar continua com um clique.
 */
export function precisaConfirmarStatus(ativoAtual: boolean): boolean {
  return ativoAtual;
}

export function tituloConfirmarDesativar(nome: string | null | undefined): string {
  const n = (nome ?? "").trim();
  return `Desativar ${n || "este usuário"}?`;
}

export const DESCRICAO_CONFIRMAR_DESATIVAR = "Ele não vai mais conseguir entrar no sistema.";

/** Na visão da plataforma o motivo (mín. 5 caracteres) vai para a auditoria. */
export function podeConfirmarDesativar(inPlatform: boolean, motivo: string): boolean {
  return !inPlatform || motivo.trim().length >= 5;
}
