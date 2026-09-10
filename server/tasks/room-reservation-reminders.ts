import { createClient } from "@supabase/supabase-js";
import { defineTask } from "nitro/task";
import type { Database } from "../../src/integrations/supabase/types";
import {
  normalizePhone,
  reminderMessage,
  startAt,
  type RoomReservationRow,
} from "../../src/lib/room-reservation-reminders";

type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "telefone" | "ativo"
>;

type DeliveryRow = Pick<
  Database["public"]["Tables"]["room_reservation_reminder_deliveries"]["Row"],
  "sent_at"
>;

const ZIONTALK_URL = "https://app.ziontalk.com/api/send_message/";
const APP_URL = process.env.APP_URL || "https://unicaescolha.com.br";

async function sendReminder(
  row: RoomReservationRow,
  phone: string,
  apiKey: string,
): Promise<boolean> {
  const response = await fetch(ZIONTALK_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      msg: reminderMessage(row, APP_URL),
      mobile_phone: phone,
    }).toString(),
  });
  return response.status === 201;
}

export default defineTask({
  meta: {
    name: "room-reservation-reminders",
    description: "Envia lembretes de reservas de sala pelo WhatsApp dos participantes.",
  },
  async run() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const apiKey = process.env.ZIONTALK_API_KEY;
    if (!supabaseUrl || !serviceRoleKey || !apiKey) return { result: "configuration_missing" };

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const now = new Date();
    const horizon = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const today = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const horizonDate = horizon.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

    const { data: reservations, error } = await supabase
      .from("room_reservations")
      .select("*")
      .eq("status", "confirmed")
      .is("reminder_sent_at", null)
      .gte("reserved_date", today)
      .lte("reserved_date", horizonDate);
    if (error || !reservations?.length) return { result: "no_due_reservations" };

    const recipientIds = Array.from(
      new Set(
        reservations.flatMap((row) => [row.responsible_id, ...(row.participant_user_ids ?? [])]),
      ),
    );
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, telefone, ativo")
      .in("id", recipientIds);
    const profileById = new Map(
      (profiles ?? []).map((profile: ProfileRow) => [profile.id, profile]),
    );

    let sent = 0;
    for (const row of reservations) {
      const meetingAt = startAt(row);
      const reminderAt = new Date(meetingAt.getTime() - row.reminder_minutes_before * 60 * 1000);
      if (meetingAt <= now || reminderAt > now) continue;

      const rowRecipientIds = Array.from(
        new Set([row.responsible_id, ...(row.participant_user_ids ?? [])]),
      );
      const rowPhones = rowRecipientIds
        .map((recipientId) => {
          const profile = profileById.get(recipientId);
          return profile?.ativo === false ? null : normalizePhone(profile?.telefone ?? null);
        })
        .filter((phone): phone is string => Boolean(phone));
      const uniquePhones = Array.from(new Set(rowPhones));
      if (!uniquePhones.length) continue;

      let allSent = true;
      for (const phone of uniquePhones) {
        const recipientId = rowRecipientIds.find(
          (id) => normalizePhone(profileById.get(id)?.telefone ?? null) === phone,
        );
        if (!recipientId) continue;

        const { data: delivery } = await supabase
          .from("room_reservation_reminder_deliveries")
          .select("sent_at")
          .eq("reservation_id", row.id)
          .eq("recipient_id", recipientId)
          .maybeSingle();
        if ((delivery as DeliveryRow | null)?.sent_at) continue;

        try {
          const delivered = await sendReminder(row, phone, apiKey);
          if (!delivered) {
            allSent = false;
            await supabase.from("room_reservation_reminder_deliveries").upsert(
              {
                reservation_id: row.id,
                recipient_id: recipientId,
                phone,
                last_error: "ziontalk_send_failed",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "reservation_id,recipient_id" },
            );
            continue;
          }
          await supabase.from("room_reservation_reminder_deliveries").upsert(
            {
              reservation_id: row.id,
              recipient_id: recipientId,
              phone,
              sent_at: new Date().toISOString(),
              last_error: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "reservation_id,recipient_id" },
          );
        } catch {
          allSent = false;
          await supabase.from("room_reservation_reminder_deliveries").upsert(
            {
              reservation_id: row.id,
              recipient_id: recipientId,
              phone,
              last_error: "ziontalk_request_failed",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "reservation_id,recipient_id" },
          );
        }
      }

      if (!allSent) continue;
      const { data: marked } = await supabase
        .from("room_reservations")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("reminder_sent_at", null)
        .select("id")
        .maybeSingle();
      if (marked) sent++;
    }

    return { result: `sent:${sent}` };
  },
});
