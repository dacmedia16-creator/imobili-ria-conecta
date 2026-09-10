import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Info, Plus, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getInclusiveRoomReservationDates,
  getRoomReservationCancellationNotice,
  getRoomReservationDateRangeConflicts,
  getRoomReservationPeriodTimes,
  intervalsOverlap,
  ROOM_RESERVATION_PURPOSES,
  ROOM_RESERVATION_ROOMS,
  timeToMinutes,
} from "@/lib/reservas-salas-calc";
import type {
  RoomReservationCancellationStatus,
  RoomReservationPeriod,
} from "@/lib/reservas-salas-calc";

export const Route = createFileRoute("/_authenticated/reservas-salas")({
  head: () => ({ meta: [{ title: "Agendamento de salas" }] }),
  component: RoomReservationsPage,
});

const ROOMS = ROOM_RESERVATION_ROOMS;
const TIME_SLOTS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
];

const RESERVATION_PERIODS: Array<{ value: RoomReservationPeriod; label: string }> = [
  { value: "morning", label: "Manhã (08:00 às 12:00)" },
  { value: "afternoon", label: "Tarde (13:00 às 18:00)" },
  { value: "full_day", label: "Dia inteiro (08:00 às 18:00)" },
  { value: "custom", label: "Personalizado" },
];

type Reservation = {
  id: string;
  groupId: string;
  room: (typeof ROOMS)[number];
  date: string;
  endDate: string;
  start: string;
  end: string;
  responsibleId: string;
  responsible: string;
  participants: string[];
  participantUserIds: string[];
  purpose: string;
  notes: string;
  status: "confirmed" | "canceled";
  canCancel: boolean;
};

type DraftReservation = Omit<
  Reservation,
  "id" | "status" | "participants" | "responsibleId" | "canCancel"
> & {
  participants: string;
  period: RoomReservationPeriod;
};

type RegisteredUser = {
  id: string;
  nome: string | null;
};

const todayISO = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const nextHour = (time: string) => {
  const total = timeToMinutes(time) + 60;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const dateFromISO = (date: string) => new Date(`${date}T12:00:00`);

const formatDate = (date: string) =>
  dateFromISO(date).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

const formatReservationPeriod = (startDate: string, endDate: string) => {
  const start = dateFromISO(startDate).toLocaleDateString("pt-BR");
  const end = dateFromISO(endDate).toLocaleDateString("pt-BR");
  return startDate === endDate ? start : `${start} a ${end}`;
};

const toISO = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

type RoomReservationRow = Database["public"]["Tables"]["room_reservations"]["Row"];

const mapReservation = (
  row: RoomReservationRow,
  canCancel = false,
  responsibleName = row.responsible_name,
): Reservation => ({
  id: row.id,
  groupId: row.reservation_group_id,
  room: row.room as Reservation["room"],
  date: row.reserved_date,
  endDate: row.reserved_date,
  start: row.start_time.slice(0, 5),
  end: row.end_time.slice(0, 5),
  responsibleId: row.responsible_id,
  responsible: responsibleName,
  participants: row.participants ?? [],
  participantUserIds: row.participant_user_ids ?? [],
  purpose: row.purpose,
  notes: row.notes,
  status: row.status as Reservation["status"],
  canCancel,
});

const groupReservationsByPeriod = (items: Reservation[]): Reservation[] => {
  const groups = new Map<string, Reservation[]>();
  for (const item of items) {
    const group = groups.get(item.groupId) ?? [];
    group.push(item);
    groups.set(item.groupId, group);
  }

  return Array.from(groups.values()).map((group) => {
    const first = [...group].sort((a, b) => a.date.localeCompare(b.date))[0];
    return {
      ...first,
      endDate: group.reduce(
        (latest, item) => (item.date > latest ? item.date : latest),
        first.date,
      ),
      canCancel: group.every((item) => item.canCancel),
    };
  });
};

function RoomReservationsPage() {
  const { user } = useAuth();
  const initialDate = todayISO();
  const fallbackResponsibleName =
    user?.user_metadata?.nome ?? user?.user_metadata?.full_name ?? user?.email ?? "Usuário atual";
  const [responsibleName, setResponsibleName] = useState(fallbackResponsibleName);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [roomFilter, setRoomFilter] = useState<"all" | (typeof ROOMS)[number]>("all");
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancellationStatus, setCancellationStatus] =
    useState<RoomReservationCancellationStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DraftReservation>({
    room: "Barão Sala 2",
    date: initialDate,
    endDate: initialDate,
    start: "14:00",
    end: "15:00",
    period: "custom",
    responsible: responsibleName,
    participants: "",
    participantUserIds: [],
    purpose: ROOM_RESERVATION_PURPOSES[0],
    notes: "",
  });

  const loadReservations = useCallback(async () => {
    if (!user) {
      setReservations([]);
      setLoadingReservations(false);
      return;
    }

    setLoadingReservations(true);
    const { data, error } = await supabase
      .from("room_reservations")
      .select("*")
      .order("reserved_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      setLoadError("Não foi possível carregar a agenda compartilhada.");
      setReservations([]);
    } else {
      setLoadError(null);
      const { data: users } = await supabase.rpc("list_room_reservation_users");
      const { data: penaltyStatus } = await supabase
        .rpc("get_room_reservation_cancellation_status")
        .maybeSingle();
      if (penaltyStatus) {
        setCancellationStatus({
          lateCancellationCount: penaltyStatus.late_cancellation_count,
          remainingCancellations: penaltyStatus.remaining_cancellations,
          blockedUntil: penaltyStatus.blocked_until,
        });
      }
      const profiles = (users ?? []) as RegisteredUser[];
      setRegisteredUsers(profiles);
      const namesById = new Map(
        (profiles ?? [])
          .filter((profile) => profile.nome?.trim())
          .map((profile) => [profile.id, profile.nome!.trim()]),
      );
      setResponsibleName(namesById.get(user.id) ?? fallbackResponsibleName);
      const mapped = (data ?? []).map((row) =>
        mapReservation(row, false, namesById.get(row.responsible_id)),
      );
      const cancelable = await Promise.all(
        (data ?? []).map(async (row) => {
          const { data: allowed } = await supabase.rpc("can_cancel_room_reservation", {
            _responsible_id: row.responsible_id,
          });
          return allowed === true;
        }),
      );
      setReservations(
        mapped.map((reservation, index) => ({
          ...reservation,
          canCancel: cancelable[index] ?? false,
        })),
      );
    }
    setLoadingReservations(false);
  }, [fallbackResponsibleName, user]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  const visibleRooms = roomFilter === "all" ? ROOMS : [roomFilter];
  const activeReservations = reservations.filter(
    (reservation) => reservation.status === "confirmed",
  );
  const selectedReservations = activeReservations.filter(
    (reservation) => reservation.date === selectedDate,
  );
  const myReservations = groupReservationsByPeriod(
    activeReservations.filter((reservation) => reservation.responsibleId === user?.id),
  ).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  const manageableReservations = groupReservationsByPeriod(
    activeReservations.filter(
      (reservation) => reservation.canCancel && reservation.responsibleId !== user?.id,
    ),
  ).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));

  const conflictingDates = useMemo(
    () =>
      getRoomReservationDateRangeConflicts(activeReservations, {
        room: draft.room,
        date: draft.date,
        endDate: draft.endDate,
        start: draft.start,
        end: draft.end,
      }),
    [activeReservations, draft.date, draft.endDate, draft.end, draft.room, draft.start],
  );
  const conflict = conflictingDates.length > 0;

  const openNewReservation = (room: (typeof ROOMS)[number] = "Barão Sala 2", start = "14:00") => {
    setDraft({
      room,
      date: selectedDate,
      endDate: selectedDate,
      start,
      end: nextHour(start),
      period: "custom",
      responsible: responsibleName,
      participants: "",
      participantUserIds: [],
      purpose: ROOM_RESERVATION_PURPOSES[0],
      notes: "",
    });
    setDialogOpen(true);
  };

  const selectReservationPeriod = (period: RoomReservationPeriod) => {
    const times = getRoomReservationPeriodTimes(period);
    setDraft((current) => ({
      ...current,
      period,
      ...(times ?? {}),
    }));
  };

  const saveReservation = async () => {
    if (!user) {
      toast.error("Faça login para criar uma reserva.");
      return;
    }
    if (
      cancellationStatus?.blockedUntil &&
      new Date(cancellationStatus.blockedUntil) > new Date()
    ) {
      toast.error(
        `Você está bloqueado para novas reservas até ${new Date(cancellationStatus.blockedUntil).toLocaleDateString("pt-BR")}.`,
      );
      return;
    }
    if (!responsibleName.trim()) {
      toast.error("Informe o responsável pela reserva.");
      return;
    }
    if (!draft.start || !draft.end || timeToMinutes(draft.end) <= timeToMinutes(draft.start)) {
      toast.error("O horário final precisa ser posterior ao horário inicial.");
      return;
    }
    const reservationDates = getInclusiveRoomReservationDates(draft.date, draft.endDate);
    if (reservationDates.length === 0) {
      toast.error("A data final precisa ser igual ou posterior à data inicial.");
      return;
    }
    if (conflict) {
      toast.error(
        `Essa sala já está reservada nos dias: ${conflictingDates
          .map((date) => dateFromISO(date).toLocaleDateString("pt-BR"))
          .join(", ")}.`,
      );
      return;
    }

    const reservationGroupId = crypto.randomUUID();
    const participants = draft.participants
      .split(",")
      .map((participant) => participant.trim())
      .filter(Boolean);
    const { error } = await supabase.from("room_reservations").insert(
      reservationDates.map((reservedDate) => ({
        reservation_group_id: reservationGroupId,
        room: draft.room,
        reserved_date: reservedDate,
        start_time: draft.start,
        end_time: draft.end,
        responsible_id: user.id,
        responsible_name: responsibleName.trim(),
        participants,
        participant_user_ids: draft.participantUserIds,
        purpose: draft.purpose,
        notes: draft.notes.trim(),
        cancellation_deadline_minutes: 0,
        reminder_minutes_before: 30,
      })),
    );

    if (error) {
      if (error.code === "23P01") {
        toast.error("Essa sala já foi reservada nesse período por outra pessoa.");
      } else {
        toast.error("Não foi possível salvar a reserva.");
      }
      return;
    }

    setSelectedDate(draft.date);
    setDialogOpen(false);
    await loadReservations();
    toast.success("Reserva criada com sucesso.");
  };

  const cancelReservation = async (id: string) => {
    if (!user) return;

    const { data, error } = await supabase
      .rpc("cancel_room_reservation", { _reservation_id: id })
      .maybeSingle();

    if (error) {
      if (error.code === "42501") {
        toast.error("Você não tem permissão para cancelar esta reserva.");
      } else if (error.code === "22023") {
        toast.error("Esta reserva já foi cancelada ou não pode mais ser alterada.");
      } else {
        toast.error("Não foi possível cancelar a reserva.");
      }
      return;
    }
    if (!data) {
      toast.error("Não foi possível confirmar o cancelamento da reserva.");
      return;
    }

    const nextStatus: RoomReservationCancellationStatus = {
      lateCancellationCount: data.late_cancellation_count,
      remainingCancellations: data.remaining_cancellations,
      blockedUntil: data.blocked_until,
    };
    setCancellationStatus(nextStatus);
    await loadReservations();
    toast.success(getRoomReservationCancellationNotice(nextStatus, data.was_late_cancellation));
  };

  const reservationForSlot = (room: (typeof ROOMS)[number], slot: string) =>
    selectedReservations.find(
      (reservation) =>
        reservation.room === room &&
        intervalsOverlap(slot, nextHour(slot), reservation.start, reservation.end),
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Agendamento de salas</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulte a disponibilidade e reserve uma sala sem conflito de horários.
          </p>
        </div>
        <Button onClick={() => openNewReservation()}>
          <Plus className="mr-2 h-4 w-4" /> Reservar sala
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Agenda compartilhada</AlertTitle>
        <AlertDescription>
          As reservas são salvas no banco da imobiliária. O cancelamento pode ser feito a qualquer
          momento. Cancelamentos feitos depois da primeira hora contam para a regra de bloqueio: ao
          atingir 3, o usuário fica 7 dias corridos sem poder reservar.
        </AlertDescription>
      </Alert>
      {loadError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Agenda indisponível</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {cancellationStatus?.blockedUntil &&
        new Date(cancellationStatus.blockedUntil) > new Date() && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Novas reservas bloqueadas</AlertTitle>
            <AlertDescription>
              Você atingiu 3 cancelamentos após a primeira hora. Poderá reservar novamente em{" "}
              {new Date(cancellationStatus.blockedUntil).toLocaleDateString("pt-BR")}.
            </AlertDescription>
          </Alert>
        )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Escolha a data</CardTitle>
            <CardDescription>Veja a agenda do dia selecionado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Calendar
              mode="single"
              selected={dateFromISO(selectedDate)}
              onSelect={(date) => date && setSelectedDate(toISO(date))}
              className="mx-auto rounded-md border"
            />
            <div className="space-y-2">
              <label htmlFor="room-filter" className="text-sm font-medium">
                Filtrar sala
              </label>
              <Select
                value={roomFilter}
                onValueChange={(value) => setRoomFilter(value as typeof roomFilter)}
              >
                <SelectTrigger id="room-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as salas</SelectItem>
                  {ROOMS.map((room) => (
                    <SelectItem key={room} value={room}>
                      {room}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="font-medium capitalize">{formatDate(selectedDate)}</div>
              <div className="mt-1 text-muted-foreground">
                {selectedReservations.length} reserva{selectedReservations.length === 1 ? "" : "s"}{" "}
                confirmada{selectedReservations.length === 1 ? "" : "s"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Disponibilidade</CardTitle>
                <CardDescription>
                  {loadingReservations
                    ? "Carregando agenda compartilhada..."
                    : "Horários de 08:00 às 18:00. Clique em um horário livre para reservar."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Livre
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Reservada
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <div className="min-w-[760px] space-y-2">
              <div className="flex gap-2 text-xs font-semibold text-muted-foreground">
                <div className="w-16 shrink-0 px-2 py-2">Hora</div>
                {visibleRooms.map((room) => (
                  <div key={room} className="min-w-0 flex-1 px-2 py-2">
                    {room}
                  </div>
                ))}
              </div>
              {TIME_SLOTS.map((slot) => (
                <div key={slot} className="flex gap-2">
                  <div className="flex w-16 shrink-0 items-start gap-1 px-2 py-3 text-xs font-medium text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    {slot}
                  </div>
                  {visibleRooms.map((room) => {
                    const reservation = reservationForSlot(room, slot);
                    return reservation ? (
                      <button
                        key={`${room}-${slot}`}
                        type="button"
                        className="min-h-16 min-w-0 flex-1 rounded-md border border-primary/20 bg-primary/10 p-2 text-left transition hover:bg-primary/15"
                        onClick={() => openNewReservation(room, slot)}
                        title="Clique para abrir uma nova reserva neste horário"
                      >
                        <div className="truncate text-xs font-semibold text-primary">
                          {reservation.purpose}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">
                          {reservation.start}–{reservation.end} · {reservation.responsible}
                        </div>
                      </button>
                    ) : (
                      <button
                        key={`${room}-${slot}`}
                        type="button"
                        className="min-h-16 min-w-0 flex-1 rounded-md border border-dashed bg-emerald-50/40 p-2 text-left text-xs text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-300"
                        onClick={() => openNewReservation(room, slot)}
                      >
                        Livre
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Minhas próximas reservas</CardTitle>
            <CardDescription>Reservas confirmadas vinculadas ao seu usuário.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {myReservations.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma reserva encontrada.</p>
            )}
            {myReservations.map((reservation) => (
              <div
                key={reservation.id}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{reservation.room}</span>
                    <Badge variant="outline">{reservation.purpose}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {formatReservationPeriod(reservation.date, reservation.endDate)} ·{" "}
                    {reservation.start} às {reservation.end}
                  </div>
                  {reservation.participants.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5" /> {reservation.participants.join(", ")}
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => cancelReservation(reservation.id)}>
                  <XCircle className="mr-1 h-4 w-4" /> Cancelar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {manageableReservations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reservas que posso cancelar</CardTitle>
              <CardDescription>
                Reservas da sua equipe ou todas as reservas, conforme o seu perfil.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {manageableReservations.map((reservation) => (
                <div
                  key={reservation.id}
                  className="flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{reservation.room}</span>
                      <Badge variant="outline">{reservation.purpose}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {formatReservationPeriod(reservation.date, reservation.endDate)} ·{" "}
                      {reservation.start} às {reservation.end} · {reservation.responsible}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelReservation(reservation.id)}
                  >
                    <XCircle className="mr-1 h-4 w-4" /> Cancelar
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regras ativas</CardTitle>
            <CardDescription>Proteções aplicadas pela agenda compartilhada.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Impedir duas reservas sobrepostas para a mesma sala.</span>
            </div>
            <div className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Responsável cancela a própria reserva; gestores e líderes, a própria equipe;
                administradores, todas.
              </span>
            </div>
            <div className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Manter histórico de reservas canceladas.</span>
            </div>
            <div className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Enviar lembrete por WhatsApp ao responsável antes da reunião.</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Nova reserva de sala</DialogTitle>
            <DialogDescription>
              Preencha os dados da reunião. O conflito será verificado antes de salvar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="reservation-room" className="text-sm font-medium">
                Sala
              </label>
              <Select
                value={draft.room}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, room: value as Reservation["room"] }))
                }
              >
                <SelectTrigger id="reservation-room">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROOMS.map((room) => (
                    <SelectItem key={room} value={room}>
                      {room}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="reservation-date" className="text-sm font-medium">
                Data de início
              </label>
              <Input
                id="reservation-date"
                type="date"
                value={draft.date}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    date: event.target.value,
                    endDate:
                      current.endDate < event.target.value ? event.target.value : current.endDate,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="reservation-end-date" className="text-sm font-medium">
                Data final
              </label>
              <Input
                id="reservation-end-date"
                type="date"
                min={draft.date}
                value={draft.endDate}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, endDate: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="reservation-period" className="text-sm font-medium">
                Período da reserva
              </label>
              <Select
                value={draft.period}
                onValueChange={(value) => selectReservationPeriod(value as RoomReservationPeriod)}
              >
                <SelectTrigger id="reservation-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESERVATION_PERIODS.map((period) => (
                    <SelectItem key={period.value} value={period.value}>
                      {period.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="reservation-start" className="text-sm font-medium">
                Horário inicial
              </label>
              <Input
                id="reservation-start"
                type="time"
                value={draft.start}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    period: "custom",
                    start: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="reservation-end" className="text-sm font-medium">
                Horário final
              </label>
              <Input
                id="reservation-end"
                type="time"
                value={draft.end}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    period: "custom",
                    end: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="reservation-responsible" className="text-sm font-medium">
                Usuário que reservou
              </label>
              <Input
                id="reservation-responsible"
                value={responsibleName}
                readOnly
                className="bg-muted/40"
              />
              <p className="text-xs text-muted-foreground">
                Preenchido automaticamente pelo usuário autenticado.
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="reservation-participants" className="text-sm font-medium">
                Participantes
              </label>
              <Input
                id="reservation-participants"
                placeholder="Separe os nomes por vírgula"
                value={draft.participants}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, participants: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Usuários cadastrados para receber aviso</label>
              <div className="max-h-36 space-y-2 overflow-y-auto rounded-md border p-3">
                {registeredUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum usuário cadastrado disponível para seleção.
                  </p>
                ) : (
                  registeredUsers.map((registeredUser) => {
                    const checked = draft.participantUserIds.includes(registeredUser.id);
                    return (
                      <label
                        key={registeredUser.id}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              participantUserIds: event.target.checked
                                ? [...current.participantUserIds, registeredUser.id]
                                : current.participantUserIds.filter(
                                    (id) => id !== registeredUser.id,
                                  ),
                            }))
                          }
                        />
                        <span>{registeredUser.nome || registeredUser.id}</span>
                      </label>
                    );
                  })
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Os usuários selecionados receberão o lembrete no WhatsApp cadastrado.
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="reservation-purpose" className="text-sm font-medium">
                Finalidade
              </label>
              <Select
                value={draft.purpose}
                onValueChange={(value) => setDraft((current) => ({ ...current, purpose: value }))}
              >
                <SelectTrigger id="reservation-purpose">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROOM_RESERVATION_PURPOSES.map((purpose) => (
                    <SelectItem key={purpose} value={purpose}>
                      {purpose}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="reservation-notes" className="text-sm font-medium">
                Observações
              </label>
              <Textarea
                id="reservation-notes"
                placeholder="Pauta ou informação adicional (opcional)"
                value={draft.notes}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
            {conflict && (
              <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive sm:col-span-2">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Já existe uma reserva para esta sala nesse período. Escolha outro horário ou sala.
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveReservation} disabled={conflict}>
              Confirmar reserva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
