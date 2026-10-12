/**
 * Trava do aviso de mudança de status da venda (revisão de segurança 12/10/2026, cartão t_6a39a961).
 *
 * `notifySaleStatusChange` manda WhatsApp pelo número oficial. Antes, o navegador dizia qual era o
 * status e o motivo, e o servidor acreditava: dava para forjar avisos (inclusive com link falso).
 * Agora o aviso só sai se a ÚLTIMA mudança gravada em sale_status_history:
 * - levou a venda ao status que ela tem AGORA (sales.status);
 * - foi feita por quem está chamando (ou, no cancelamento da plataforma, registrada em
 *   platform_sale_cancellations por quem chama — lá o histórico fica sem autor de propósito);
 * - aconteceu há pouco (mesma janela da captação: 2 minutos);
 * - ainda não foi avisada (um aviso por mudança).
 * O motivo exibido é o GRAVADO, nunca o texto do navegador, e tem tamanho limitado.
 */

export const JANELA_AVISO_STATUS_MS = 2 * 60 * 1000;
export const MOTIVO_AVISO_MAX = 500;
const PREFIXO_PLATAFORMA = "[Plataforma] ";

export type UltimaMudancaStatus = {
  para: string;
  autor_id: string | null;
  motivo: string | null;
  created_at: string;
};

export type CancelamentoPlataforma = { actor_user_id: string; created_at: string } | null;

export type AvisoStatusInput = {
  statusAtual: string | null | undefined;
  ultima: UltimaMudancaStatus | null;
  callerId: string;
  /** Cancelamento da plataforma mais recente desta venda (só consultado quando autor é nulo). */
  cancelamentoPlataforma?: CancelamentoPlataforma;
  /** Já existe registro de aviso enviado por este usuário depois desta mudança. */
  jaAvisado?: boolean;
  agora?: number;
};

export type AvisoStatusDecisao =
  { ok: true; status: string; motivo: string | null } | { ok: false; motivo: string };

const recente = (iso: string, agora: number) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && agora - t <= JANELA_AVISO_STATUS_MS && agora - t >= -60_000;
};

/**
 * Última mudança registrada. Duas mudanças na MESMA transação (ex.: contrato assinado →
 * ocorrência pendente) têm o mesmo created_at (now() da transação); nesse empate vale a que levou
 * ao status atual. `linhas` deve vir ordenada por created_at decrescente.
 */
export function ultimaMudanca(
  linhas: UltimaMudancaStatus[],
  statusAtual: string | null | undefined,
): UltimaMudancaStatus | null {
  if (!linhas.length) return null;
  const topo = linhas[0].created_at;
  const empatadas = linhas.filter(
    (l) => new Date(l.created_at).getTime() === new Date(topo).getTime(),
  );
  return empatadas.find((l) => l.para === statusAtual) ?? linhas[0];
}

/** Motivo para exibir: texto gravado, sem espaços sobrando e cortado no limite. */
export function limitarMotivo(motivo: string | null | undefined): string | null {
  const limpo = (motivo ?? "").trim();
  if (!limpo) return null;
  return limpo.length > MOTIVO_AVISO_MAX ? `${limpo.slice(0, MOTIVO_AVISO_MAX - 1)}…` : limpo;
}

export function decidirAvisoStatus(input: AvisoStatusInput): AvisoStatusDecisao {
  const agora = input.agora ?? Date.now();
  const { ultima, statusAtual, callerId } = input;
  if (!statusAtual) return { ok: false, motivo: "venda_sem_status" };
  if (!ultima) return { ok: false, motivo: "sem_historico" };
  if (ultima.para !== statusAtual) return { ok: false, motivo: "status_divergente" };
  if (!recente(ultima.created_at, agora)) return { ok: false, motivo: "mudanca_antiga" };

  let motivo = ultima.motivo;
  if (ultima.autor_id !== callerId) {
    // Cancelamento pela plataforma: histórico sem autor; a autoria fica na tabela própria.
    const c = input.cancelamentoPlataforma;
    const cancelamentoDoCaller =
      ultima.autor_id === null &&
      statusAtual === "cancelada" &&
      !!c &&
      c.actor_user_id === callerId &&
      recente(c.created_at, agora);
    if (!cancelamentoDoCaller) return { ok: false, motivo: "autor_divergente" };
    if (motivo?.startsWith(PREFIXO_PLATAFORMA)) motivo = motivo.slice(PREFIXO_PLATAFORMA.length);
  }
  if (input.jaAvisado) return { ok: false, motivo: "ja_avisado" };
  return { ok: true, status: statusAtual, motivo: limitarMotivo(motivo) };
}
