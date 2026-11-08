import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck } from "lucide-react";
import { formatDateBR, type Capture } from "@/lib/exclusive-captures";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { statusReuniao, textoStatusReuniao, REUNIAO_DIAS } from "@/lib/avisos-exclusividade";
import {
  avisosExclusividadeEnabled,
  listarReunioes,
  registrarReuniao,
  type Reuniao,
} from "@/lib/avisos-exclusividade-module";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Reunião de prestação de contas com o proprietário (a cada 45 dias de exclusividade em vigor; a
 * contagem começa no signed_on e recomeça a cada reunião). Só aparece com o módulo
 * avisos_exclusividade ligado e na captação aprovada e assinada. O banco repete todas as travas.
 */
export function ReuniaoProprietario({
  capture,
  podeRegistrar,
}: {
  capture: Pick<Capture, "id" | "status" | "signed_on" | "form_data" | "archived_at">;
  podeRegistrar: boolean;
}) {
  const [ligado, setLigado] = useState(false);
  const [reunioes, setReunioes] = useState<Reuniao[]>([]);
  const [abrir, setAbrir] = useState(false);
  const [data, setData] = useState(hojeSaoPaulo());
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [verTodas, setVerTodas] = useState(false);

  const carregar = useCallback(async () => {
    const m = await listarReunioes([capture.id]);
    setReunioes(m.get(capture.id) ?? []);
  }, [capture.id]);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const on = await avisosExclusividadeEnabled();
      if (cancelado) return;
      setLigado(on);
      if (on) await carregar();
    })();
    return () => {
      cancelado = true;
    };
  }, [carregar]);

  if (!ligado || capture.status !== "aprovada" || !capture.signed_on || capture.archived_at)
    return null;

  const hoje = hojeSaoPaulo();
  const st = statusReuniao(
    capture,
    reunioes.map((r) => r.met_on),
    hoje,
  );
  const textoOk = texto.trim().length >= 5;

  const salvar = async () => {
    if (!textoOk) {
      toast.error("Descreva o que foi combinado ou as próximas ações (mínimo 5 letras).");
      return;
    }
    setSalvando(true);
    try {
      await registrarReuniao(capture.id, data, texto.trim());
      toast.success("Reunião registrada. A contagem de 45 dias recomeçou.");
      setTexto("");
      setAbrir(false);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar a reunião.");
    } finally {
      setSalvando(false);
    }
  };

  const lista = verTodas ? reunioes : reunioes.slice(0, 3);

  return (
    <section
      data-testid="reuniao-proprietario"
      className="mt-3 space-y-2 rounded-xl border bg-card p-3 text-sm"
      aria-label="Reunião com o proprietário"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="font-medium">Reunião com o proprietário</span>
        {st ? (
          <span
            data-testid="reuniao-status"
            data-pendente={st.pendente}
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              st.pendente ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {textoStatusReuniao(st)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Exclusividade fora de vigor: sem contagem de reunião.
          </span>
        )}
        {podeRegistrar && st && !abrir && (
          <Button
            size="sm"
            variant={st.pendente ? "default" : "outline"}
            className="ml-auto"
            data-testid="reuniao-registrar"
            onClick={() => setAbrir(true)}
          >
            Registrar reunião com o proprietário
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        A cada {REUNIAO_DIAS} dias de exclusividade, faça uma reunião de prestação de contas com o
        proprietário. A contagem começa na assinatura e recomeça a cada reunião registrada.
      </p>

      {abrir && (
        <div data-testid="reuniao-form" className="space-y-2 rounded-md border bg-muted/30 p-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor="reuniao-data">
            Data da reunião
            <Input
              id="reuniao-data"
              type="date"
              className="h-9 w-44"
              min={capture.signed_on}
              max={hoje}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor="reuniao-texto">
            O que foi combinado / próximas ações (obrigatório)
            <Textarea
              id="reuniao-texto"
              rows={3}
              maxLength={2000}
              value={texto}
              aria-invalid={!textoOk && texto.length > 0}
              placeholder="Ex.: apresentei as visitas do mês e o retorno dos clientes; combinamos ajustar o preço para R$ …"
              onChange={(e) => setTexto(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              data-testid="reuniao-salvar"
              disabled={salvando || !textoOk || !data}
              onClick={salvar}
            >
              {salvando ? "Salvando…" : "Salvar reunião"}
            </Button>
            <Button size="sm" variant="ghost" disabled={salvando} onClick={() => setAbrir(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div data-testid="reuniao-historico">
        <div className="text-xs font-medium text-muted-foreground">
          Histórico de reuniões ({reunioes.length})
        </div>
        {reunioes.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma reunião registrada ainda.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {lista.map((r) => (
              <li key={r.id} data-testid="reuniao-item" className="rounded-md border px-2 py-1">
                <span className="font-medium">{formatDateBR(r.met_on)}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="whitespace-pre-wrap break-words">{r.notes}</span>
              </li>
            ))}
          </ul>
        )}
        {reunioes.length > 3 && (
          <button
            type="button"
            className="mt-1 text-xs font-medium text-primary underline"
            onClick={() => setVerTodas((v) => !v)}
          >
            {verTodas ? "Mostrar menos" : `Ver todas (${reunioes.length})`}
          </button>
        )}
      </div>
    </section>
  );
}
