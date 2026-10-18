// "Conferir na Clicksign" (R5 da auditoria t_5aabee72): envio que ficou em 'sending' sem confirmação
// (activate_unknown, ou parado há mais de 5 min). Consulta o envelope por GET (não cria nem altera
// nada na Clicksign, salvo excluir um RASCUNHO, que nunca foi enviado) e acerta o status no ADM MAX:
//   running → o envio valeu (segue como envio confirmado; se era activate_unknown, avisa os
//             signatários, porque a v3 não manda e-mail ao ativar e o aviso nunca saiu);
//   draft   → nunca foi ativado: exclui o rascunho e libera um novo envio;
//   404     → não existe: libera um novo envio;
//   outro   → não mexe; pede conferência manual.
// Sem Deno (testável com mock). A regra de quem pode fica no banco (clicksign_reconcile_authorize).
import {
  ClicksignClient,
  ClicksignError,
  notifySigners,
  type FetchLike,
} from "./clicksign.ts";

export type ReconcileKind = "captacao" | "venda";
export type ReconcileContext = {
  envelopeKey: string | null;
  errorCode: string | null;
  token: string | null;
};
export type ReconcileDeps = {
  /** clicksign_reconcile_authorize com o JWT do usuário → {org, envelope}; lança Error claro. */
  reconcileAuthorize(kind: ReconcileKind, id: string): Promise<{ org: string; envelope: string }>;
  reconcileContext(org: string, envelopeRow: string): Promise<ReconcileContext>;
  /** clicksign_reconcile_apply (service_role): sent | released | manual | already. */
  reconcileApply(envelopeRow: string, remote: string): Promise<string>;
  updateEnvelope(id: string, patch: Record<string, unknown>): Promise<void>;
  fetch: FetchLike;
  clicksignBase?: string;
};
type Result = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Result => ({
  status,
  body: { error, ...extra },
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RECONCILE_MSG: Record<string, string> = {
  sent: "Conferido: o contrato está em assinatura na Clicksign. O status foi atualizado.",
  released:
    "Conferido: o envio não chegou a valer na Clicksign e nada foi enviado aos signatários. Já é possível enviar de novo.",
  manual:
    "A Clicksign mostra o envelope encerrado ou cancelado. Confira no painel da Clicksign antes de qualquer reenvio e avise o suporte.",
  already: "Este envio já foi atualizado. Recarregue a página.",
};

export async function handleReconcile(
  deps: ReconcileDeps,
  kind: ReconcileKind,
  id: string,
): Promise<Result> {
  if (!UUID_RE.test(id)) return fail(400, kind === "captacao" ? "Captação inválida" : "Venda inválida");
  let auth: { org: string; envelope: string };
  try {
    auth = await deps.reconcileAuthorize(kind, id);
  } catch (e) {
    return fail(403, e instanceof Error ? e.message : "Ação não autorizada");
  }
  const ctx = await deps.reconcileContext(auth.org, auth.envelope);
  if (!ctx.token) return fail(503, "Chave da Clicksign não configurada para esta imobiliária");
  const client = new ClicksignClient(ctx.token, deps.fetch, deps.clicksignBase);

  let remote = "missing";
  if (ctx.envelopeKey) {
    try {
      const env = await client.getEnvelope(ctx.envelopeKey);
      const st = env?.data?.attributes?.status;
      remote = typeof st === "string" && /^[a-z_]{1,20}$/.test(st) ? st : "unknown";
    } catch (e) {
      if (!(e instanceof ClicksignError && e.status === 404)) {
        const code = e instanceof ClicksignError ? `${e.step}:${e.status}` : "internal";
        return fail(502, "Não foi possível consultar a Clicksign agora. Nada mudou; tente de novo.", {
          code,
        });
      }
    }
  }
  // Rascunho nunca enviou e-mail: exclui (best-effort) antes de liberar o reenvio.
  if (remote === "draft" && ctx.envelopeKey) {
    await client.deleteEnvelope(ctx.envelopeKey).catch(() => undefined);
  }
  const result = await deps.reconcileApply(auth.envelope, remote);
  const body: Record<string, unknown> = {
    ok: true,
    result,
    remote,
    message: RECONCILE_MSG[result] ?? RECONCILE_MSG.manual,
  };
  if (result === "sent" && ctx.envelopeKey) {
    if (ctx.errorCode === "activate_unknown") {
      // A ativação foi confirmada agora; o aviso por e-mail nunca saiu (a edge parou antes).
      const err = await notifySigners(client, ctx.envelopeKey);
      if (err) {
        await deps
          .updateEnvelope(auth.envelope, {
            error_code: `notify_failed:${err}`,
            updated_at: new Date().toISOString(),
          })
          .catch(() => undefined);
        body.warning = "Os signatários ainda não foram avisados: use “Reenviar aviso”.";
      }
    } else {
      body.warning =
        "Se os signatários não receberam o e-mail da Clicksign, use “Reenviar aviso”.";
    }
  }
  return { status: 200, body };
}
