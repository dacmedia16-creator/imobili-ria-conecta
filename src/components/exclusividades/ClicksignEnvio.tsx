import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import {
  canStartEnvelope,
  CLICKSIGN_DISABLED,
  clicksignCaptureConfig,
  envelopeStatusLabel,
  sendDialogErrors,
  sendToClicksign,
  WITNESS_COUNT,
  type ClicksignCaptureConfig,
  type Testemunha,
} from "@/lib/exclusive-clicksign";

const db = supabase as unknown as SupabaseClient;
const emptyWitnesses = (): Testemunha[] =>
  Array.from({ length: WITNESS_COUNT }, () => ({ nome: "", email: "" }));

/**
 * Envio da captação para assinatura na Clicksign. Fica oculto enquanto a organização não habilitar
 * a integração (clicksign_org_settings.enabled = false por padrão) ou se a leitura falhar.
 */
export function ClicksignEnvio({
  captureId,
  status,
  form,
  hasGerado,
  dirty,
  onSent,
}: {
  captureId: string;
  status: string;
  form: Record<string, unknown> | null;
  hasGerado: boolean;
  dirty: boolean;
  onSent: () => Promise<unknown> | void;
}) {
  const [config, setConfig] = useState<ClicksignCaptureConfig>(CLICKSIGN_DISABLED);
  const [open, setOpen] = useState(false);
  const [imob, setImob] = useState<string[]>([]);
  const [witnesses, setWitnesses] = useState<Testemunha[]>(emptyWitnesses);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    () => clicksignCaptureConfig(db, captureId).then(setConfig),
    [captureId],
  );
  useEffect(() => {
    void refresh();
  }, [refresh, status]);

  const errors = useMemo(
    () =>
      config.enabled
        ? sendDialogErrors({
            form,
            corretorEmailOk: config.corretor_email_ok,
            imobiliariaIds: imob,
            testemunhas: witnesses,
          })
        : [],
    [config, form, imob, witnesses],
  );

  if (!config.enabled) return null;
  const envelope = config.envelope;
  const podeEnviar =
    config.can_send && status === "enviada" && hasGerado && canStartEnvelope(envelope);
  if (!podeEnviar && !envelope) return null;

  const bloqueioAbrir = dirty
    ? "Salve as alterações antes de enviar"
    : config.imobiliaria.length === 0
      ? "Nenhuma pessoa configurada para assinar pela imobiliária. Peça ao administrador."
      : null;

  const enviar = async () => {
    if (errors.length) return;
    setBusy(true);
    try {
      const r = await sendToClicksign(db, {
        captureId,
        imobiliariaIds: imob,
        testemunhas: witnesses,
      });
      toast.success(
        `Enviado pela Clicksign${r.is_test ? " (TESTE)" : ""} para ${r.signers} signatários.`,
      );
      setOpen(false);
      setImob([]);
      setWitnesses(emptyWitnesses());
      await onSent();
    } catch (e) {
      toast.error(errorMessage(e, "Falha ao enviar para a Clicksign"));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <Card data-testid="clicksign-envio">
      <CardHeader>
        <CardTitle>Assinatura pela Clicksign{config.test_mode ? " (modo teste)" : ""}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {envelope && <p className="text-sm">{envelopeStatusLabel(envelope)}</p>}
        {podeEnviar && (
          <>
            <p className="text-sm text-muted-foreground">
              Assinam ao mesmo tempo, com código por e-mail: proprietário(s), corretor, imobiliária
              e {WITNESS_COUNT} testemunhas. Prazo: {config.deadline_days} dias. Quando todos
              assinarem, o PDF assinado é anexado sozinho; a aprovação continua manual.
            </p>
            <Button disabled={busy || !!bloqueioAbrir} onClick={() => setOpen(true)}>
              Enviar pela Clicksign
            </Button>
            {bloqueioAbrir && <p className="text-xs text-muted-foreground">{bloqueioAbrir}</p>}
          </>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar para assinatura na Clicksign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Quem assina pela imobiliária (1 ou mais)
              </legend>
              {config.imobiliaria.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={imob.includes(p.id)}
                    onCheckedChange={(v) =>
                      setImob((cur) =>
                        v === true ? [...cur, p.id] : cur.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.nome}
                </label>
              ))}
            </fieldset>
            {witnesses.map((t, i) => (
              <fieldset key={i} className="space-y-2">
                <legend className="text-sm font-medium">Testemunha {i + 1}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`tst-nome-${i}`}>Nome completo</Label>
                    <Input
                      id={`tst-nome-${i}`}
                      maxLength={200}
                      value={t.nome}
                      onChange={(e) =>
                        setWitnesses((cur) =>
                          cur.map((w, j) => (j === i ? { ...w, nome: e.target.value } : w)),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`tst-email-${i}`}>E-mail</Label>
                    <Input
                      id={`tst-email-${i}`}
                      type="email"
                      maxLength={200}
                      value={t.email}
                      onChange={(e) =>
                        setWitnesses((cur) =>
                          cur.map((w, j) => (j === i ? { ...w, email: e.target.value } : w)),
                        )
                      }
                    />
                  </div>
                </div>
              </fieldset>
            ))}
            {errors.length > 0 && (
              <ul
                role="status"
                className="list-disc rounded-md border border-amber-300 bg-amber-50 py-2 pl-6 pr-3 text-sm text-amber-900"
              >
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={busy || errors.length > 0}
              title={errors[0]}
              onClick={() => void enviar()}
            >
              {busy ? "Enviando…" : "Enviar para assinatura"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
