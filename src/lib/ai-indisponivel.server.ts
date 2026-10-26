import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AI_ALERT_ACTION,
  AI_ALERT_COOLDOWN_MS,
  AI_ALERT_NOTIFICATION_TYPE,
  AI_ALERT_WINDOW_MS,
  AI_FAILURE_ACTION,
  alertText,
  shouldAlert,
  type AiUnavailableCode,
} from "./ai-indisponivel";

export type AiUnavailableEvent = {
  /** Imobiliária do documento (lida do banco pelo servidor, nunca do navegador). */
  orgId: string;
  userId: string;
  origem: "vendas" | "captacao_documento" | "captacao_contrato";
  code: AiUnavailableCode;
  httpStatus: number;
  documentId: string;
};

/**
 * Registra a falha 402/429 em `activity_logs` (acao `ia_leitura_indisponivel`) e avisa no sino os
 * administradores da plataforma (`platform_admins`) quando houver 3 ou mais falhas na última hora,
 * no máximo uma vez a cada 6 horas (marca `ia_alerta_plataforma`).
 *
 * A contagem considera a plataforma toda, porque a chave da IA é a mesma para todas as imobiliárias.
 * A função nunca lança erro, porque a resposta ao usuário já está definida, e não grava a chave nem
 * dados do documento.
 * Usa service_role porque o usuário comum não lê `platform_admins` nem grava aviso para outra pessoa.
 *
 * shortcut: em falhas simultâneas, as duas podem ver "nenhum aviso nas últimas 6h" e mandar o aviso
 * duas vezes. O pior caso é um aviso repetido no sino, por isso não usamos trava no banco.
 */
export async function reportAiUnavailable(
  admin: SupabaseClient,
  ev: AiUnavailableEvent,
  now: Date = new Date(),
): Promise<{ alerted: boolean }> {
  try {
    const { error: logErr } = await admin.from("activity_logs").insert({
      organization_id: ev.orgId,
      autor_id: null,
      sale_id: null,
      acao: AI_FAILURE_ACTION,
      payload: {
        codigo: ev.code,
        http_status: ev.httpStatus,
        origem: ev.origem,
        documento_id: ev.documentId,
        usuario_id: ev.userId,
      },
    });
    if (logErr) console.error("ia indisponível: falha ao registrar", logErr.message);

    const desde = (ms: number) => new Date(now.getTime() - ms).toISOString();
    const [falhas, alertas] = await Promise.all([
      admin
        .from("activity_logs")
        .select("id", { count: "exact", head: true })
        .eq("acao", AI_FAILURE_ACTION)
        .gte("created_at", desde(AI_ALERT_WINDOW_MS)),
      admin
        .from("activity_logs")
        .select("id", { count: "exact", head: true })
        .eq("acao", AI_ALERT_ACTION)
        .gte("created_at", desde(AI_ALERT_COOLDOWN_MS)),
    ]);
    if (falhas.error || alertas.error) return { alerted: false };
    const nFalhas = falhas.count ?? 0;
    if (!shouldAlert(nFalhas, alertas.count ?? 0)) return { alerted: false };

    // Marca primeiro. Assim, se o envio do sino falhar no meio, não insistimos a cada nova falha.
    const { error: markErr } = await admin.from("activity_logs").insert({
      organization_id: ev.orgId,
      autor_id: null,
      sale_id: null,
      acao: AI_ALERT_ACTION,
      payload: { codigo: ev.code, falhas_1h: nFalhas },
    });
    if (markErr) {
      console.error("ia indisponível: falha ao marcar aviso", markErr.message);
      return { alerted: false };
    }

    const { data: admins } = await admin.from("platform_admins").select("user_id");
    const ids = ((admins ?? []) as { user_id: string }[]).map((r) => r.user_id);
    if (!ids.length) return { alerted: false };
    // Cada aviso fica na imobiliária de quem recebe (FK de notifications.organization_id).
    const { data: perfis } = await admin
      .from("profiles")
      .select("id, organization_id")
      .in("id", ids);
    const { titulo, mensagem } = alertText(ev.code, nFalhas);
    const rows = ((perfis ?? []) as { id: string; organization_id: string | null }[])
      .filter((p) => p.organization_id)
      .map((p) => ({
        user_id: p.id,
        organization_id: p.organization_id as string,
        tipo: AI_ALERT_NOTIFICATION_TYPE,
        titulo,
        mensagem,
      }));
    if (!rows.length) return { alerted: false };
    const { error: notifErr } = await admin.from("notifications").insert(rows);
    if (notifErr) {
      console.error("ia indisponível: falha ao avisar no sino", notifErr.message);
      return { alerted: false };
    }
    console.warn(
      `ALERTA ia indisponível (${ev.code}): ${nFalhas} falhas/1h; ${rows.length} aviso(s)`,
    );
    return { alerted: true };
  } catch (err) {
    console.error("ia indisponível: aviso falhou", (err as Error)?.message);
    return { alerted: false };
  }
}

/** Carrega o service_role sob demanda, igual às outras server functions, e nunca lança erro. */
export async function reportAiUnavailableSafe(ev: AiUnavailableEvent): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await reportAiUnavailable(supabaseAdmin as unknown as SupabaseClient, ev);
  } catch (err) {
    console.error("ia indisponível: aviso falhou", (err as Error)?.message);
  }
}
