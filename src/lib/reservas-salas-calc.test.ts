import { describe, expect, it } from "vitest";
import { hasRoomReservationConflict, intervalsOverlap, timeToMinutes } from "./reservas-salas-calc";

describe("reservas de salas — regras de horário", () => {
  it("converte horário para minutos", () => {
    expect(timeToMinutes("14:30")).toBe(870);
  });

  it("considera sobreposição parcial e total", () => {
    expect(intervalsOverlap("14:00", "15:00", "14:30", "16:00")).toBe(true);
    expect(intervalsOverlap("14:00", "16:00", "14:30", "15:00")).toBe(true);
  });

  it("permite reservas consecutivas sem sobreposição", () => {
    expect(intervalsOverlap("14:00", "15:00", "15:00", "16:00")).toBe(false);
  });

  it("bloqueia conflito na mesma sala e data", () => {
    expect(
      hasRoomReservationConflict(
        [{ room: "Sala 2", date: "2026-09-15", start: "14:00", end: "15:30" }],
        { room: "Sala 2", date: "2026-09-15", start: "15:00", end: "16:00" },
      ),
    ).toBe(true);
  });

  it("permite o mesmo horário em outra sala ou data", () => {
    const reservations = [{ room: "Sala 2", date: "2026-09-15", start: "14:00", end: "15:30" }];
    expect(
      hasRoomReservationConflict(reservations, {
        room: "Sala 3",
        date: "2026-09-15",
        start: "14:00",
        end: "15:30",
      }),
    ).toBe(false);
    expect(
      hasRoomReservationConflict(reservations, {
        room: "Sala 2",
        date: "2026-09-16",
        start: "14:00",
        end: "15:30",
      }),
    ).toBe(false);
  });

  it("ignora reserva cancelada", () => {
    expect(
      hasRoomReservationConflict(
        [{ room: "Sala 2", date: "2026-09-15", start: "14:00", end: "15:30", status: "canceled" }],
        { room: "Sala 2", date: "2026-09-15", start: "14:00", end: "15:30" },
      ),
    ).toBe(false);
  });
});
