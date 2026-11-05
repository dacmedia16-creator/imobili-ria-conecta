import { useEffect, useState, type ReactNode } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Cartão "Escolha a data" com o calendário mensal (dom–sáb, dia escolhido em azul).
 * Nasceu na Reserva de salas e é compartilhado com o Agendar fotos e a Agenda do fotógrafo
 * (t_9b79f000). Datas trafegam como "YYYY-MM-DD" (data civil local).
 */

/** "2026-11-05" → Date ao meio-dia local (evita virar o dia por fuso). */
export const dataDeChave = (dia: string) => new Date(`${dia}T12:00:00`);

/** Date → "YYYY-MM-DD" pela data local. */
export const chaveDeData = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Dias coloridos do calendário: verde = disponível, azul = reservado, ponto azul = tem reserva. */
export type DiasColoridos = {
  disponivel: string[];
  reservado: string[];
  comIndicadorReserva: string[];
};

const CLASSES_COR = {
  disponivel:
    "rounded-md bg-emerald-100! text-emerald-900! dark:bg-emerald-900/40! dark:text-emerald-100!",
  reservado: "rounded-md bg-blue-100! text-blue-900! dark:bg-blue-900/40! dark:text-blue-100!",
  comIndicadorReserva:
    "after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-blue-600",
};

export function LegendaCores() {
  return (
    <p
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      data-testid="legenda-cores"
    >
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden /> Verde = disponível
      </span>
      <span aria-hidden>·</span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden /> Azul = reservado
      </span>
    </p>
  );
}

export function EscolhaDataCard({
  selected,
  onSelect,
  cores,
  aPartirDe,
  children,
}: {
  selected: string;
  onSelect: (dia: string) => void;
  cores?: DiasColoridos;
  /** Bloqueia os dias antes desta data ("YYYY-MM-DD"). */
  aPartirDe?: string;
  children?: ReactNode;
}) {
  // O mês acompanha o dia escolhido (ex.: quando a tela escolhe o 1º dia livre no mês seguinte).
  const [mes, setMes] = useState(() => dataDeChave(selected));
  useEffect(() => {
    setMes((m) => {
      const d = dataDeChave(selected);
      return m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth() ? m : d;
    });
  }, [selected]);

  return (
    <Card data-testid="escolha-data">
      <CardHeader>
        <CardTitle className="text-base">Escolha a data</CardTitle>
        <CardDescription>Veja a agenda do dia selecionado.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Calendar
          mode="single"
          selected={dataDeChave(selected)}
          onSelect={(date) => date && onSelect(chaveDeData(date))}
          month={mes}
          onMonthChange={setMes}
          className="mx-auto rounded-md border"
          disabled={aPartirDe ? { before: dataDeChave(aPartirDe) } : undefined}
          modifiers={
            cores
              ? {
                  disponivel: cores.disponivel.map(dataDeChave),
                  reservado: cores.reservado.map(dataDeChave),
                  comIndicadorReserva: cores.comIndicadorReserva.map(dataDeChave),
                }
              : undefined
          }
          modifiersClassNames={cores ? CLASSES_COR : undefined}
        />
        {cores && <LegendaCores />}
        {children}
      </CardContent>
    </Card>
  );
}
