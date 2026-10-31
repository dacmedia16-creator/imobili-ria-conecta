import { useEffect, useState, type ReactNode } from "react";
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
import { LeadConversaIa } from "@/components/leads/LeadConversaIa";
import { errorMessage } from "@/lib/errors";
import {
  aguardandoMeuAceite,
  ETAPA_LABEL,
  ETAPA_TOM,
  ORIGEM_LABEL,
  prazoDoLead,
  proximasEtapas,
  resumoPortal,
  textoEvento,
  textoPrazo,
  type CapturaOpcao,
  type Etapa,
  type Lead,
  type LeadConfig,
  type LeadEvento,
  type MotivoPerda,
  type Pessoa,
} from "@/lib/leads";
import {
  aceitarLead,
  anotarLead,
  atribuirLead,
  listarEventos,
  mudarEtapa,
  registrarLigacao,
} from "@/lib/leads-db";

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
  userId,
  config,
  pessoas,
  capturas,
  motivos,
  onClose,
  onChanged,
  crm,
}: {
  /** Tela do CRM: bloco próprio (funil, próximo contato, converter); a etapa muda pelo quadro. */
  crm?: ReactNode;
  lead: Lead | null;
  gestor: boolean;
  userId: string | undefined;
  config: LeadConfig;
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
  // Antes do aceite, o responsável só vê o botão Aceitar (o banco também recusa atendimento sem aceite).
  const precisaAceitar = aguardandoMeuAceite(lead, userId);
  const opcoes = precisaAceitar || crm ? [] : proximasEtapas(lead.etapa, gestor);
  const prazo = textoPrazo(prazoDoLead(lead, config));
  const podeAtender = !precisaAceitar && (gestor || lead.responsavel_id === userId);

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
            {/* No CRM a etapa já aparece no bloco "CRM · funil" com o nome do funil: não repetir
                com outro nome e outra cor (item 15 t_532125eb). */}
            {!crm && <Pill tom={ETAPA_TOM[lead.etapa]}>{ETAPA_LABEL[lead.etapa]}</Pill>}
            <span className="text-muted-foreground">
              {crm ? "Na etapa atual desde" : "desde"} {dataHora(lead.etapa_em)}
            </span>
            {lead.simulado && <Pill tom="slate">Simulado</Pill>}
          </div>
          {prazo && (
            <p className="rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Prazo: {prazo}
            </p>
          )}

          {precisaAceitar && (
            <section className="space-y-2 rounded-lg border border-primary/40 p-3">
              <h3 className="font-medium">Este lead chegou para você</h3>
              <p className="text-muted-foreground">
                Aceite para começar o atendimento. Se não aceitar no prazo, ele vai para o próximo
                corretor da vez.
              </p>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => run(() => aceitarLead(lead.id), "Lead aceito.")}
              >
                Aceitar lead
              </Button>
            </section>
          )}

          <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
            {lead.contato_liberado ? (
              <>
                <dt className="text-muted-foreground">Telefone</dt>
                <dd className="break-all">{lead.telefone ?? "—"}</dd>
                <dt className="text-muted-foreground">E-mail</dt>
                <dd className="break-all">{lead.email ?? "—"}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">Contato</dt>
                <dd className="text-muted-foreground">Aparece depois que o lead for aceito.</dd>
              </>
            )}
            {resumoPortal(lead) && (
              <>
                <dt className="text-muted-foreground">Portal</dt>
                <dd>{resumoPortal(lead)}</dd>
              </>
            )}
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

          {!precisaAceitar && crm}

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

          {podeAtender && (
            <section className="space-y-2 rounded-lg border p-3">
              <h3 className="font-medium">Anotação ou ligação</h3>
              <p className="text-xs text-muted-foreground">
                Anotação, ligação e mudança de etapa contam como atendimento. Só abrir o lead não
                conta.
              </p>
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
              </Button>{" "}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await registrarLigacao(lead.id, nota);
                    setNota("");
                  }, "Ligação registrada.")
                }
              >
                Registrar ligação
              </Button>
            </section>
          )}

          <LeadConversaIa
            key={`${lead.id}-${versao}`}
            leadId={lead.id}
            gestor={gestor}
            podeAtender={podeAtender}
            onChanged={() => {
              setVersao((v) => v + 1);
              onChanged();
            }}
          />

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
