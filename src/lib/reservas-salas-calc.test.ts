import { describe, expect, it } from "vitest";
import {
  getRoomReservationCancellationNotice,
  getRoomReservationPeriodTimes,
  hasRoomReservationConflict,
  intervalsOverlap,
  ROOM_RESERVATION_PURPOSES,
  ROOM_RESERVATION_ROOMS,
  timeToMinutes,
} from "./reservas-salas-calc";

describe("reservas de salas — regras de horário", () => {
  it("converte horário para minutos", () => {
    expect(timeToMinutes("14:30")).toBe(870);
  });

  it("converte períodos rápidos em horários de reserva", () => {
    expect(getRoomReservationPeriodTimes("morning")).toEqual({ start: "08:00", end: "12:00" });
    expect(getRoomReservationPeriodTimes("afternoon")).toEqual({ start: "13:00", end: "18:00" });
    expect(getRoomReservationPeriodTimes("full_day")).toEqual({ start: "08:00", end: "18:00" });
  });

  it("não altera horários ao escolher personalizado", () => {
    expect(getRoomReservationPeriodTimes("custom")).toBeNull();
  });

  it("mantém as salas organizadas por unidade", () => {
    expect(ROOM_RESERVATION_ROOMS).toEqual([
      "Barão Sala 1",
      "Barão Sala 2",
      "Barão Sala 3",
      "Barão Sala 4",
      "Barão CT",
      "Campolim Sala 1",
      "Campolim Sala 2",
    ]);
  });

  it("mantém as finalidades disponíveis para reserva", () => {
    expect(ROOM_RESERVATION_PURPOSES).toEqual([
      "Reunião com cliente",
      "Reunião de equipe",
      "Treinamento",
      "Atendimento jurídico",
      "Parceria",
      "FIC",
      "Fotos",
      "Diretoria",
      "Outra finalidade",
    ]);
  });

  it("informa quantos cancelamentos faltam para o bloqueio", () => {
    expect(
      getRoomReservationCancellationNotice(
        { lateCancellationCount: 2, remainingCancellations: 1, blockedUntil: null },
        true,
      ),
    ).toContain("Faltam 1 para o bloqueio de 7 dias.");
  });

  it("informa o período do bloqueio ao atingir três cancelamentos", () => {
    expect(
      getRoomReservationCancellationNotice(
        {
          lateCancellationCount: 3,
          remainingCancellations: 0,
          blockedUntil: "2026-10-01T12:00:00Z",
        },
        true,
      ),
    ).toContain("até 01/10/2026");
  });

  it("informa quando o cancelamento ocorreu na primeira hora", () => {
    expect(
      getRoomReservationCancellationNotice(
        { lateCancellationCount: 0, remainingCancellations: 3, blockedUntil: null },
        false,
      ),
    ).toContain("não contou para a penalidade");
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
