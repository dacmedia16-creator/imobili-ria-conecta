import { describe, expect, it } from "vitest";
import { normalizePhone, reminderMessage } from "./room-reservation-reminders";

const reservation = {
  room: "Sala 2",
  reserved_date: "2026-09-10",
  start_time: "14:00:00",
  end_time: "15:00:00",
  purpose: "Reunião com cliente",
} as never;

describe("lembrete de reserva por WhatsApp", () => {
  it("normaliza telefone brasileiro para o formato do ZionTalk", () => {
    expect(normalizePhone("(15) 99999-0000")).toBe("5515999990000");
    expect(normalizePhone("+55 15 99999-0000")).toBe("5515999990000");
    expect(normalizePhone("123")).toBeNull();
  });

  it("gera mensagem sem acentos com sala, horário, finalidade e link", () => {
    const message = reminderMessage(reservation);
    expect(message).toContain("Lembrete de reuniao");
    expect(message).toContain("Sala: Sala 2");
    expect(message).toContain("14:00 as 15:00");
    expect(message).toContain("Reuniao com cliente");
    expect(message).toContain("/reservas-salas");
    expect(message).not.toContain("ã");
    expect(message).not.toContain("é");
  });
});
