// Imports relativos: este módulo também é carregado pela task do Nitro (server/tasks).
import type { OrgAdminClient } from "./org-scope";
import { normalizePhone, startAt, type RoomReservationRow } from "./room-reservation-reminders";

type ProfileRow = { id: string; telefone: string | null; ativo: boolean | null };

export type ReminderSender = (row: RoomReservationRow, phone: string) => Promise<boolean>;

/**
 * Lembretes de reserva de sala com service_role (ignora RLS). Escopo de agência explícito:
 * processa uma organização ativa por vez; reservas, destinatários e registros de entrega são
 * sempre filtrados/gravados com o organization_id da própria reserva. Um participante de outra
 * agência nunca recebe aviso nem tem telefone lido.
 */
export async function runRoomReservationReminders(
  admin: OrgAdminClient,
  send: ReminderSender,
  now: Date = new Date(),
): Promise<{ sent: number; byOrg: Record<string, number> }> {
  const horizon = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const horizonDate = horizon.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  const { data: orgs, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("status", "ativa");
  if (orgError || !orgs?.length) return { sent: 0, byOrg: {} };

  let sent = 0;
  const byOrg: Record<string, number> = {};
  for (const { id: orgId } of orgs as { id: string }[]) {
    const { data: reservations, error } = await admin
      .from("room_reservations")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "confirmed")
      .is("reminder_sent_at", null)
      .gte("reserved_date", today)
      .lte("reserved_date", horizonDate);
    if (error || !reservations?.length) continue;
    const rows = reservations as (RoomReservationRow & { organization_id: string })[];

    const recipientIds = Array.from(
      new Set(rows.flatMap((row) => [row.responsible_id, ...(row.participant_user_ids ?? [])])),
    );
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, telefone, ativo")
      .eq("organization_id", orgId)
      .in("id", recipientIds);
    const profileById = new Map(((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p]));

    let orgSent = 0;
    for (const row of rows) {
      if (row.organization_id !== orgId) continue;
      const meetingAt = startAt(row);
      const reminderAt = new Date(meetingAt.getTime() - row.reminder_minutes_before * 60 * 1000);
      if (meetingAt <= now || reminderAt > now) continue;

      // Só destinatários da mesma agência (profileById já vem filtrado pela organização).
      const rowRecipientIds = Array.from(
        new Set([row.responsible_id, ...(row.participant_user_ids ?? [])]),
      ).filter((id) => profileById.has(id));
      const phoneByRecipient = new Map<string, string>();
      for (const id of rowRecipientIds) {
        const profile = profileById.get(id);
        if (profile?.ativo === false) continue;
        const phone = normalizePhone(profile?.telefone ?? null);
        if (phone && ![...phoneByRecipient.values()].includes(phone)) phoneByRecipient.set(id, phone);
      }
      if (!phoneByRecipient.size) continue;

      let allSent = true;
      for (const [recipientId, phone] of phoneByRecipient) {
        const { data: delivery } = await admin
          .from("room_reservation_reminder_deliveries")
          .select("sent_at")
          .eq("organization_id", orgId)
          .eq("reservation_id", row.id)
          .eq("recipient_id", recipientId)
          .maybeSingle();
        if ((delivery as { sent_at: string | null } | null)?.sent_at) continue;

        const base = {
          organization_id: orgId,
          reservation_id: row.id,
          recipient_id: recipientId,
          phone,
          updated_at: new Date().toISOString(),
        };
        let lastError: string | null = null;
        try {
          if (!(await send(row, phone))) lastError = "ziontalk_send_failed";
        } catch {
          lastError = "ziontalk_request_failed";
        }
        if (lastError) allSent = false;
        await admin
          .from("room_reservation_reminder_deliveries")
          .upsert(
            lastError
              ? { ...base, last_error: lastError }
              : { ...base, sent_at: new Date().toISOString(), last_error: null },
            { onConflict: "reservation_id,recipient_id" },
          );
      }

      if (!allSent) continue;
      const { data: marked } = await admin
        .from("room_reservations")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("organization_id", orgId)
        .eq("id", row.id)
        .is("reminder_sent_at", null)
        .select("id")
        .maybeSingle();
      if (marked) orgSent++;
    }
    byOrg[orgId] = orgSent;
    sent += orgSent;
  }
  return { sent, byOrg };
}
