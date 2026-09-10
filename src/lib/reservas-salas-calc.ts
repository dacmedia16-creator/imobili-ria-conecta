export const ROOM_RESERVATION_ROOMS = [
  "Barão Sala 1",
  "Barão Sala 2",
  "Barão Sala 3",
  "Barão Sala 4",
  "Barão CT",
  "Campolim Sala 1",
  "Campolim Sala 2",
] as const;

export const ROOM_RESERVATION_PURPOSES = [
  "Reunião com cliente",
  "Reunião de equipe",
  "Treinamento",
  "Atendimento jurídico",
  "Parceria",
  "FIC",
  "Fotos",
  "Diretoria",
  "Outra finalidade",
] as const;

export type RoomReservationPeriod = "custom" | "morning" | "afternoon" | "full_day";

export const ROOM_RESERVATION_CANCELLATION_LIMIT = 3;
export const ROOM_RESERVATION_CANCELLATION_BLOCK_DAYS = 7;

export type RoomReservationCancellationStatus = {
  lateCancellationCount: number;
  remainingCancellations: number;
  blockedUntil: string | null;
};

export function getRoomReservationCancellationNotice(
  status: RoomReservationCancellationStatus,
  wasLateCancellation: boolean,
): string {
  if (!wasLateCancellation) {
    return "Reserva cancelada. Como o cancelamento ocorreu na primeira hora, ele não contou para a penalidade.";
  }

  if (status.blockedUntil) {
    const blockedUntil = new Date(status.blockedUntil).toLocaleDateString("pt-BR");
    return `Reserva cancelada. Este foi seu ${status.lateCancellationCount}º cancelamento após a primeira hora. Você atingiu o limite e ficará bloqueado para novas reservas até ${blockedUntil}.`;
  }

  return `Reserva cancelada. Você tem ${status.lateCancellationCount} de ${ROOM_RESERVATION_CANCELLATION_LIMIT} cancelamentos após a primeira hora. Faltam ${status.remainingCancellations} para o bloqueio de 7 dias.`;
}

export function getRoomReservationPeriodTimes(
  period: RoomReservationPeriod,
): { start: string; end: string } | null {
  if (period === "morning") return { start: "08:00", end: "12:00" };
  if (period === "afternoon") return { start: "13:00", end: "18:00" };
  if (period === "full_day") return { start: "08:00", end: "18:00" };
  return null;
}

export type RoomReservationInterval = {
  room: string;
  date: string;
  start: string;
  end: string;
  status?: string;
};

export function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function intervalsOverlap(
  start: string,
  end: string,
  otherStart: string,
  otherEnd: string,
): boolean {
  return (
    timeToMinutes(start) < timeToMinutes(otherEnd) && timeToMinutes(end) > timeToMinutes(otherStart)
  );
}

export function hasRoomReservationConflict(
  reservations: RoomReservationInterval[],
  draft: RoomReservationInterval,
): boolean {
  return reservations.some(
    (reservation) =>
      reservation.status !== "canceled" &&
      reservation.room === draft.room &&
      reservation.date === draft.date &&
      intervalsOverlap(draft.start, draft.end, reservation.start, reservation.end),
  );
}
