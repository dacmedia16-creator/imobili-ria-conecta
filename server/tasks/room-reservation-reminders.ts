import { createClient } from "@supabase/supabase-js";
import { defineTask } from "nitro/task";
import { reminderMessage, type RoomReservationRow } from "../../src/lib/room-reservation-reminders";
import { runRoomReservationReminders } from "../../src/lib/room-reservation-reminders.server";

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

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Multiempresa: percorre cada agência ativa separadamente; reservas, destinatários e entregas
    // são sempre filtrados/gravados com o organization_id da reserva (service_role ignora RLS).
    const { sent } = await runRoomReservationReminders(supabase, (row: RoomReservationRow, phone) =>
      sendReminder(row, phone, apiKey),
    );
    return { result: `sent:${sent}` };
  },
});
