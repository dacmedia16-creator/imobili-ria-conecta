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

/** Staff nunca fica bloqueado (regra de Denis 27/10/2026); o banco confere pelo papel atual. */
export function isRoomReservationBlocked(
  status: RoomReservationCancellationStatus | null,
  isStaff: boolean,
  now: Date = new Date(),
): boolean {
  if (isStaff || !status?.blockedUntil) return false;
  return new Date(status.blockedUntil) > now;
}

export function getRoomReservationCancellationNotice(
  status: RoomReservationCancellationStatus,
  wasLateCancellation: boolean,
  isStaff = false,
): string {
  if (isStaff) {
    return "Reserva cancelada. Staff não tem limite de cancelamentos nem bloqueio.";
  }
  if (!wasLateCancellation) {
    return "Reserva cancelada. Como o cancelamento ocorreu na primeira hora, ele não contou para a penalidade.";
  }

  if (status.blockedUntil) {
    const blockedUntil = new Date(status.blockedUntil).toLocaleDateString("pt-BR");
    return `Reserva cancelada. Este foi seu ${status.lateCancellationCount}º cancelamento após a primeira hora. Você atingiu o limite e ficará bloqueado para novas reservas até ${blockedUntil}.`;
  }

  return `Reserva cancelada. Você tem ${status.lateCancellationCount} de ${ROOM_RESERVATION_CANCELLATION_LIMIT} cancelamentos após a primeira hora. Faltam ${status.remainingCancellations} para o bloqueio de 7 dias.`;
}

/**
 * Aviso mostrado ANTES de cancelar (item 4 t_8730be75). Espelha a regra do banco
 * (cancel_room_reservation): conta para a penalidade só se quem cancela é o responsável
 * e a reserva foi criada há mais de 1 hora; staff nunca conta. Não muda a regra, só explica.
 */
export function getRoomReservationCancelWarning(opts: {
  isOwn: boolean;
  createdAt: string | null;
  status: RoomReservationCancellationStatus | null;
  isStaff: boolean;
  now?: Date;
}): { countsForPenalty: boolean; text: string } {
  const { isOwn, createdAt, status, isStaff, now = new Date() } = opts;
  if (isStaff) {
    return {
      countsForPenalty: false,
      text: "Staff não tem limite de cancelamentos nem bloqueio.",
    };
  }
  if (!isOwn) {
    return {
      countsForPenalty: false,
      text: "A reserva é de outra pessoa: este cancelamento não conta para a regra de bloqueio de ninguém.",
    };
  }
  const created = createdAt ? new Date(createdAt).getTime() : NaN;
  const withinFirstHour = Number.isFinite(created) && now.getTime() <= created + 60 * 60 * 1000;
  if (withinFirstHour) {
    return {
      countsForPenalty: false,
      text: "A reserva foi feita há menos de 1 hora: este cancelamento não conta para a regra de bloqueio.",
    };
  }
  const limit = ROOM_RESERVATION_CANCELLATION_LIMIT;
  const days = ROOM_RESERVATION_CANCELLATION_BLOCK_DAYS;
  if (!status) {
    return {
      countsForPenalty: true,
      text: `Este cancelamento conta para a regra de bloqueio: ao chegar a ${limit} cancelamentos depois da primeira hora, você fica ${days} dias sem poder reservar.`,
    };
  }
  const next = status.lateCancellationCount + 1;
  if (next >= limit) {
    return {
      countsForPenalty: true,
      text: `Atenção: este será seu ${next}º cancelamento depois da primeira hora. Ao confirmar, você fica ${days} dias sem poder fazer novas reservas.`,
    };
  }
  return {
    countsForPenalty: true,
    text: `Este cancelamento conta para a regra de bloqueio: será o ${next}º de ${limit}. Ao chegar a ${limit}, você fica ${days} dias sem poder reservar.`,
  };
}

/**
 * Estado de uma célula da agenda (item 5 t_8730be75): enquanto a agenda carrega ou falhou,
 * nenhum horário pode aparecer como "Livre" nem ser clicado para reservar.
 */
export function getRoomSlotState(opts: {
  loading: boolean;
  loadFailed: boolean;
  occupied: boolean;
}): "carregando" | "indisponivel" | "ocupada" | "livre" {
  if (opts.loading) return "carregando";
  if (opts.loadFailed) return "indisponivel";
  return opts.occupied ? "ocupada" : "livre";
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

export type RoomReservationDateRange = RoomReservationInterval & {
  endDate: string;
};

export function getInclusiveRoomReservationDates(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export function getRoomReservationDateRangeConflicts(
  reservations: RoomReservationInterval[],
  draft: RoomReservationDateRange,
): string[] {
  return getInclusiveRoomReservationDates(draft.date, draft.endDate).filter((date) =>
    reservations.some(
      (reservation) =>
        reservation.status !== "canceled" &&
        reservation.room === draft.room &&
        reservation.date === date &&
        intervalsOverlap(draft.start, draft.end, reservation.start, reservation.end),
    ),
  );
}

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
