import type { Database } from "@/integrations/supabase/types";

export type RoomReservationRow = Database["public"]["Tables"]["room_reservations"]["Row"];

export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
}

export function whatsappText(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      // ZionTalk requires ASCII for this integration; line breaks are intentionally preserved.
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x00-\x7E]/g, "")
  );
}

export function startAt(row: Pick<RoomReservationRow, "reserved_date" | "start_time">): Date {
  return new Date(`${row.reserved_date}T${row.start_time.slice(0, 8)}-03:00`);
}

export function reminderMessage(
  row: Pick<RoomReservationRow, "room" | "reserved_date" | "start_time" | "end_time" | "purpose">,
  appUrl = "https://unicaescolha.com.br",
): string {
  const date = new Date(`${row.reserved_date}T12:00:00-03:00`).toLocaleDateString("pt-BR");
  return whatsappText(
    `*Lembrete de reuniao*\n\nSala: ${row.room}\nData: ${date}\nHorario: ${row.start_time.slice(0, 5)} as ${row.end_time.slice(0, 5)}\nFinalidade: ${row.purpose}\n\nAcesse: ${appUrl}/reservas-salas`,
  );
}
