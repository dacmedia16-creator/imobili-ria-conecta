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
