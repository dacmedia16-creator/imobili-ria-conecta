import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/visual/base";
import { errorMessage } from "@/lib/errors";
import {
  ETAPA_LABEL,
  ETAPA_TOM,
  ORIGEM_LABEL,
  proximasEtapas,
  textoEvento,
  type CapturaOpcao,
  type Etapa,
  type Lead,
  type LeadEvento,
  type MotivoPerda,
  type Pessoa,
} from "@/lib/leads";
import { anotarLead, atribuirLead, listarEventos, mudarEtapa } from "@/lib/leads-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

/** Gaveta com dados do lead, etapa, responsável (gestor) e linha do tempo. */
export function LeadDetalhe({
  lead,
  gestor,
  pessoas,
  capturas,
  motivos,
  onClose,
  onChanged,
}: {
  lead: Lead | null;
  gestor: boolean;
  pessoas: Pessoa[];
  capturas: CapturaOpcao[];
  motivos: MotivoPerda[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [eventos, setEventos] = useState<LeadEvento[] | null>(null);
  const [etapa, setEtapa] = useState<Etapa | "">("");
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [nota, setNota] = useState("");
  const [resp, setResp] = useState("");
  const [busy, setBusy] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    setEtapa("");
    setMotivo("");
    setObs("");
    setNota("");
    setResp(lead?.responsavel_id ?? "");
  }, [lead?.id, lead?.responsavel_id]);

  const leadId = lead?.id ?? null;
  useEffect(() => {
    if (!leadId) return;
    let alive = true;
    setEventos(null);
    listarEventos(leadId)
      .then((e) => alive && setEventos(e))
      .catch(() => alive && setEventos([]));
    return () => {
      alive = false;
    };
  }, [leadId, versao]);

  if (!lead) return null;
  const nomeDe = (id: string | null) =>
    pessoas.find((p) => p.id === id)?.nome ?? (id ? "Pessoa" : "—");
  const captura = capturas.find((c) => c.id === lead.capture_id);
  const opcoes = proximasEtapas(lead.etapa, gestor);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setVersao((v) => v + 1);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível concluir."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={Boolean(lead)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="break-words">{lead.nome}</SheetTitle>
          <SheetDescription>
            Origem: {ORIGEM_LABEL[lead.origem]} · criado em {dataHora(lead.created_at)}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tom={ETAPA_TOM[lead.etapa]}>{ETAPA_LABEL[lead.etapa]}</Pill>
            <span className="text-muted-foreground">desde {dataHora(lead.etapa_em)}</span>
          </div>

          <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
            <dt className="text-muted-foreground">Telefone</dt>
            <dd className="break-all">{lead.telefone ?? "—"}</dd>
            <dt className="text-muted-foreground">E-mail</dt>
            <dd className="break-all">{lead.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Responsável</dt>
            <dd>{lead.responsavel_id ? nomeDe(lead.responsavel_id) : "Sem responsável"}</dd>
            <dt className="text-muted-foreground">Imóvel</dt>
            <dd>
              {lead.capture_id
                ? `${captura ? [captura.tipo, captura.bairro].filter(Boolean).join(" · ") || "Captação" : "Captação"} — captador: ${nomeDe(lead.captador_id)}`
                : "—"}
            </dd>
            {lead.etapa === "perdido" && (
              <>
                <dt className="text-muted-foreground">Motivo</dt>
                <dd>
                  {motivos.find((m) => m.id === lead.motivo_perda_id)?.nome ?? "—"}
                  {lead.motivo_perda_obs ? ` — ${lead.motivo_perda_obs}` : ""}
                </dd>
              </>
            )}
          </dl>
          {lead.mensagem && (
            <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2">{lead.mensagem}</p>
          )}

          {opcoes.length > 0 && (
            <section className="space-y-2 rounded-lg border p-3">
              <h3 className="font-medium">Mudar etapa</h3>
              <select
                className={SELECT}
                value={etapa}
                onChange={(e) => setEtapa(e.target.value as Etapa | "")}
                aria-label="Nova etapa"
              >
                <option value="">Escolha a etapa…</option>
                {opcoes.map((e) => (
                  <option key={e} value={e}>
                    {ETAPA_LABEL[e]}
                  </option>
                ))}
              </select>
              {etapa === "perdido" && (
                <>
                  <select
                    className={SELECT}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    aria-label="Motivo da perda"
                  >
                    <option value="">Motivo da perda…</option>
                    {motivos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                  <Textarea
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                    maxLength={1000}
                    placeholder="Observação (opcional)"
                  />
                </>
              )}
              <Button
                size="sm"
                disabled={busy || !etapa || (etapa === "perdido" && !motivo)}
                onClick={() =>
                  etapa && run(() => mudarEtapa(lead.id, etapa, motivo, obs), "Etapa atualizada.")
                }
              >
                Salvar etapa
              </Button>
            </section>
          )}

          {gestor && (
            <section className="space-y-2 rounded-lg border p-3">
              <h3 className="font-medium">Responsável</h3>
              <select
                className={SELECT}
                value={resp}
                onChange={(e) => setResp(e.target.value)}
                aria-label="Responsável"
              >
                <option value="">Escolha…</option>
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.id === lead.captador_id ? " (captador do imóvel)" : ""}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !resp || resp === lead.responsavel_id}
                onClick={() => run(() => atribuirLead(lead.id, resp), "Responsável atualizado.")}
              >
                Atribuir
              </Button>
            </section>
          )}

          <section className="space-y-2 rounded-lg border p-3">
            <h3 className="font-medium">Anotação</h3>
            <Textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={2000}
              placeholder="Ex.: liguei, cliente pediu retorno amanhã"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !nota.trim()}
              onClick={() =>
                run(async () => {
                  await anotarLead(lead.id, nota);
                  setNota("");
                }, "Anotação salva.")
              }
            >
              Salvar anotação
            </Button>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">Linha do tempo</h3>
            {eventos === null ? (
              <p className="text-muted-foreground">Carregando…</p>
            ) : eventos.length === 0 ? (
              <p className="text-muted-foreground">Sem registros.</p>
            ) : (
              <ol className="space-y-2 border-l pl-3">
                {eventos.map((e) => (
                  <li key={e.id}>
                    <div className="text-xs text-muted-foreground">
                      {dataHora(e.created_at)} · {nomeDe(e.autor_id)}
                    </div>
                    <div>{textoEvento(e, nomeDe)}</div>
                    {e.nota && (
                      <div className="whitespace-pre-wrap text-muted-foreground">{e.nota}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
