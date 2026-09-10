import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Info, Plus, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
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
  hasRoomReservationConflict,
  intervalsOverlap,
  timeToMinutes,
} from "@/lib/reservas-salas-calc";

export const Route = createFileRoute("/_authenticated/reservas-salas")({
  head: () => ({ meta: [{ title: "Agendamento de salas" }] }),
  component: RoomReservationsPage,
});

const ROOMS = ["Sala 1", "Sala 2", "Sala 3", "Sala 4", "CT"] as const;
const PURPOSES = [
  "Reunião com cliente",
  "Reunião de equipe",
  "Treinamento",
  "Atendimento jurídico",
  "Parceria",
  "Outra finalidade",
] as const;
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

type Reservation = {
  id: string;
  room: (typeof ROOMS)[number];
  date: string;
  start: string;
  end: string;
  responsible: string;
  participants: string[];
  purpose: string;
  notes: string;
  status: "confirmed" | "canceled";
};

type DraftReservation = Omit<Reservation, "id" | "status" | "participants"> & {
  participants: string;
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

const toISO = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function seedReservations(date: string): Reservation[] {
  return [
    {
      id: "demo-1",
      room: "Sala 1",
      date,
      start: "09:00",
      end: "10:00",
      responsible: "Ana Costa",
      participants: ["Equipe comercial"],
      purpose: "Reunião de equipe",
      notes: "Alinhamento da semana",
      status: "confirmed",
    },
    {
      id: "demo-2",
      room: "Sala 2",
      date,
      start: "14:00",
      end: "15:30",
      responsible: "Denis Souza",
      participants: ["João da Silva", "Maria Oliveira"],
      purpose: "Reunião com cliente",
      notes: "Apresentação da proposta comercial",
      status: "confirmed",
    },
    {
      id: "demo-3",
      room: "CT",
      date,
      start: "10:00",
      end: "12:00",
      responsible: "Carlos Mendes",
      participants: ["Novos corretores"],
      purpose: "Treinamento",
      notes: "Integração de novos corretores",
      status: "confirmed",
    },
  ];
}

function RoomReservationsPage() {
  const { user } = useAuth();
  const initialDate = todayISO();
  const responsibleName = user?.user_metadata?.nome ?? "Denis Souza";
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [roomFilter, setRoomFilter] = useState<"all" | (typeof ROOMS)[number]>("all");
  const [reservations, setReservations] = useState<Reservation[]>(() =>
    seedReservations(initialDate),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DraftReservation>({
    room: "Sala 2",
    date: initialDate,
    start: "14:00",
    end: "15:00",
    responsible: responsibleName,
    participants: "",
    purpose: PURPOSES[0],
    notes: "",
  });

  const visibleRooms = roomFilter === "all" ? ROOMS : [roomFilter];
  const activeReservations = reservations.filter(
    (reservation) => reservation.status === "confirmed",
  );
  const selectedReservations = activeReservations.filter(
    (reservation) => reservation.date === selectedDate,
  );
  const myReservations = activeReservations
    .filter((reservation) => reservation.responsible === responsibleName)
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));

  const conflict = useMemo(
    () => hasRoomReservationConflict(activeReservations, draft),
    [activeReservations, draft],
  );

  const openNewReservation = (room: (typeof ROOMS)[number] = "Sala 2", start = "14:00") => {
    setDraft({
      room,
      date: selectedDate,
      start,
      end: nextHour(start),
      responsible: responsibleName,
      participants: "",
      purpose: PURPOSES[0],
      notes: "",
    });
    setDialogOpen(true);
  };

  const saveReservation = () => {
    if (!draft.responsible.trim()) {
      toast.error("Informe o responsável pela reserva.");
      return;
    }
    if (!draft.start || !draft.end || timeToMinutes(draft.end) <= timeToMinutes(draft.start)) {
      toast.error("O horário final precisa ser posterior ao horário inicial.");
      return;
    }
    if (conflict) {
      toast.error("Essa sala já está reservada nesse período.");
      return;
    }

    const newReservation: Reservation = {
      ...draft,
      id: `demo-${Date.now()}`,
      participants: draft.participants
        .split(",")
        .map((participant) => participant.trim())
        .filter(Boolean),
      status: "confirmed",
    };
    setReservations((current) => [...current, newReservation]);
    setSelectedDate(draft.date);
    setDialogOpen(false);
    toast.success("Reserva criada na simulação.");
  };

  const cancelReservation = (id: string) => {
    setReservations((current) =>
      current.map((reservation) =>
        reservation.id === id ? { ...reservation, status: "canceled" } : reservation,
      ),
    );
    toast.success("Reserva cancelada na simulação. O horário foi liberado.");
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
        <AlertTitle>Simulação local</AlertTitle>
        <AlertDescription>
          As reservas exibidas são fictícias e ficam apenas nesta tela. Nesta etapa ainda não há
          gravação no banco nem envio de avisos externos.
        </AlertDescription>
      </Alert>

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
                  Horários de 08:00 às 18:00. Clique em um horário livre para reservar.
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
            <CardDescription>Na versão real, esta lista virá do banco de dados.</CardDescription>
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
                    {dateFromISO(reservation.date).toLocaleDateString("pt-BR")} ·{" "}
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regras previstas</CardTitle>
            <CardDescription>Itens que serão conectados ao banco na próxima etapa.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Impedir duas reservas sobrepostas para a mesma sala.</span>
            </div>
            <div className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Permitir cancelamento até o limite definido pela administração.</span>
            </div>
            <div className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Manter histórico de reservas canceladas.</span>
            </div>
            <div className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Enviar lembrete interno antes da reunião.</span>
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
                Data
              </label>
              <Input
                id="reservation-date"
                type="date"
                value={draft.date}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, date: event.target.value }))
                }
              />
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
                  setDraft((current) => ({ ...current, start: event.target.value }))
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
                  setDraft((current) => ({ ...current, end: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="reservation-responsible" className="text-sm font-medium">
                Responsável pela reserva
              </label>
              <Input
                id="reservation-responsible"
                value={draft.responsible}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, responsible: event.target.value }))
                }
              />
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
                  {PURPOSES.map((purpose) => (
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
