// Agendamento da vistoria (t_c3ea1b18): data/hora, vistoriador e se o corretor acompanha. Quem agenda é a vistoria
// (admin também); os outros só veem. O corretor responsável recebe lembrete no WhatsApp na véspera e ~2 h antes, e
// um aviso quando o laudo é registrado (a fila e a trava são as dos avisos da Locação).
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/visual/base";
import { agendaParaCampo, quandoVistoria, type VistoriaAgenda } from "@/lib/locacao";

export type DadosAgenda = { quando: string; vistoriador: string; acompanha: boolean };

/** O que falta para agendar (a mesma regra é conferida de novo no banco). */
export function faltasAgenda(x: DadosAgenda): string[] {
  const f: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x.quando)) f.push("data e hora");
  const v = x.vistoriador.trim();
  if (v.length < 2 || v.length > 80) f.push("nome do vistoriador");
  return f;
}

export function VistoriaAgendaItem({
  agenda,
  podeAgendar,
  laudoRegistrado,
  busy,
  agendar,
}: {
  agenda: VistoriaAgenda | null;
  podeAgendar: boolean;
  laudoRegistrado: boolean;
  busy: boolean;
  agendar: (x: DadosAgenda) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [quando, setQuando] = useState(agendaParaCampo(agenda?.em));
  const [vistoriador, setVistoriador] = useState(agenda?.vistoriador ?? "");
  const [acompanha, setAcompanha] = useState<boolean | null>(agenda ? agenda.acompanha : null);
  const editavel = podeAgendar && !laudoRegistrado;
  const faltas = [
    ...faltasAgenda({ quando, vistoriador, acompanha: !!acompanha }),
    ...(acompanha === null ? ["acompanhar: sim ou não"] : []),
  ];

  return (
    <div className="py-1 text-sm" data-testid="locacao-vistoria-agenda">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden>{agenda ? "✅" : "⬜"}</span>
        <span className="min-w-0 flex-1">
          Vistoria agendada
          {agenda && (
            <span className="block text-xs text-muted-foreground">
              {quandoVistoria(agenda.em)} · vistoriador {agenda.vistoriador || "—"} ·{" "}
              {agenda.acompanha ? (
                <Pill tom="amber">corretor acompanha</Pill>
              ) : (
                <Pill tom="slate">corretor não acompanha</Pill>
              )}
            </span>
          )}
        </span>
        {editavel && !aberto && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setAberto(true)}>
            <CalendarClock className="mr-1 h-4 w-4" />
            {agenda ? "reagendar" : "agendar"}
          </Button>
        )}
      </div>
      {editavel && aberto && (
        <div className="mt-2 grid gap-2 rounded-md border p-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="vist-quando" className="text-xs">
              Data e hora (Brasília)
            </Label>
            <Input
              id="vist-quando"
              type="datetime-local"
              value={quando}
              onChange={(e) => setQuando(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vist-nome" className="text-xs">
              Vistoriador
            </Label>
            <Input
              id="vist-nome"
              maxLength={80}
              value={vistoriador}
              onChange={(e) => setVistoriador(e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium">O corretor acompanha?</span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={acompanha === true ? "default" : "outline"}
                onClick={() => setAcompanha(true)}
              >
                Sim
              </Button>
              <Button
                type="button"
                size="sm"
                variant={acompanha === false ? "default" : "outline"}
                onClick={() => setAcompanha(false)}
              >
                Não
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            O corretor recebe lembrete no WhatsApp na véspera e cerca de 2 h antes, com horário,
            endereço e se acompanha.
          </p>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button
              size="sm"
              disabled={busy || faltas.length > 0}
              onClick={() => {
                agendar({ quando, vistoriador: vistoriador.trim(), acompanha: acompanha === true });
                setAberto(false);
              }}
            >
              Salvar agendamento
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            {faltas.length > 0 && (
              <span className="text-xs text-muted-foreground">Falta: {faltas.join(", ")}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
