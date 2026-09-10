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
