import { describe, expect, it } from "vitest";
import { getRoomReservationCancelWarning, getRoomSlotState } from "./reservas-salas-calc";

describe("reservas de salas — aviso antes de cancelar (item 4 t_8730be75)", () => {
  const agora = new Date("2026-10-31T15:00:00Z");
  const status = (n: number) => ({
    lateCancellationCount: n,
    remainingCancellations: 3 - n,
    blockedUntil: null,
  });

  it("dentro da primeira hora não conta", () => {
    const r = getRoomReservationCancelWarning({
      isOwn: true,
      createdAt: "2026-10-31T14:30:00Z",
      status: status(2),
      isStaff: false,
      now: agora,
    });
    expect(r.countsForPenalty).toBe(false);
  });

  it("depois da primeira hora conta e mostra qual será", () => {
    const r = getRoomReservationCancelWarning({
      isOwn: true,
      createdAt: "2026-10-31T13:00:00Z",
      status: status(1),
      isStaff: false,
      now: agora,
    });
    expect(r.countsForPenalty).toBe(true);
    expect(r.text).toMatch(/2º de 3/);
    expect(r.text).toMatch(/7 dias/);
  });

  it("o 3º cancelamento avisa que bloqueia por 7 dias", () => {
    const r = getRoomReservationCancelWarning({
      isOwn: true,
      createdAt: "2026-10-30T10:00:00Z",
      status: status(2),
      isStaff: false,
      now: agora,
    });
    expect(r.countsForPenalty).toBe(true);
    expect(r.text).toMatch(/3º cancelamento/);
    expect(r.text).toMatch(/7 dias sem poder/);
  });

  it("reserva de outra pessoa e staff nunca contam", () => {
    const base = { createdAt: "2026-10-30T10:00:00Z", status: status(2), now: agora };
    expect(
      getRoomReservationCancelWarning({ ...base, isOwn: false, isStaff: false }).countsForPenalty,
    ).toBe(false);
    expect(
      getRoomReservationCancelWarning({ ...base, isOwn: true, isStaff: true }).countsForPenalty,
    ).toBe(false);
  });

  it("sem data de criação, por segurança avisa que pode contar", () => {
    expect(
      getRoomReservationCancelWarning({
        isOwn: true,
        createdAt: null,
        status: null,
        isStaff: false,
        now: agora,
      }).countsForPenalty,
    ).toBe(true);
  });
});

describe("reservas de salas — agenda durante a carga (item 5 t_8730be75)", () => {
  it("carregando ou com erro nunca mostra Livre", () => {
    expect(getRoomSlotState({ loading: true, loadFailed: false, occupied: false })).toBe(
      "carregando",
    );
    expect(getRoomSlotState({ loading: false, loadFailed: true, occupied: false })).toBe(
      "indisponivel",
    );
  });
  it("carregada mostra livre/ocupada", () => {
    expect(getRoomSlotState({ loading: false, loadFailed: false, occupied: false })).toBe("livre");
    expect(getRoomSlotState({ loading: false, loadFailed: false, occupied: true })).toBe("ocupada");
  });
});
