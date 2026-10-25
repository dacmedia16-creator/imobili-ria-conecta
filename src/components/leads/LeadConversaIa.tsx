import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/visual/base";
import { errorMessage } from "@/lib/errors";
import {
  ESTADO_CONVERSA_LABEL,
  STATUS_MSG_LABEL,
  type ConversaIa,
  type MensagemIa,
} from "@/lib/leads-ia";
import { responderComoCliente } from "@/lib/leads-ia.functions";
import { lerConversaIa, pararIa } from "@/lib/leads-db";
import { mensagemErroLead } from "@/lib/leads";

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

/**
 * Conversa da IA no detalhe do lead. Gestor/admin: no modo teste, responde COMO SE FOSSE o cliente
 * (nada sai do ADM). Corretor: vê depois do aceite (o banco decide) e pode parar a IA.
 */
export function LeadConversaIa({
  leadId,
  gestor,
  podeAtender,
  onChanged,
}: {
  leadId: string;
  gestor: boolean;
  podeAtender: boolean;
  onChanged: () => void;
}) {
  const responder = useServerFn(responderComoCliente);
  const [conversa, setConversa] = useState<ConversaIa | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<MensagemIa[]>([]);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let alive = true;
    setConversa(undefined);
    lerConversaIa(leadId)
      .then((r) => {
        if (!alive) return;
        setConversa(r.conversa);
        setMsgs(r.mensagens);
      })
      .catch(() => alive && setConversa(null));
    return () => {
      alive = false;
    };
  }, [leadId, versao]);

  if (conversa === undefined) return null;
  if (conversa === null) return null; // IA desligada quando o lead entrou, ou sem acesso ainda

  const ativa = conversa.estado === "ativa";
  const teste = conversa.canal === "teste";

  const enviar = async () => {
    const t = texto.trim();
    if (!t) return;
    setBusy(true);
    try {
      const r = await responder({ data: { leadId, texto: t } });
      if (!r.ok) throw new Error(mensagemErroLead(r.erro ?? ""));
      setTexto("");
      setVersao((v) => v + 1);
      if (r.estado !== "ativa") onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível enviar."));
    } finally {
      setBusy(false);
    }
  };

  const parar = async () => {
    setBusy(true);
    try {
      await pararIa(leadId);
      toast.success("IA parada. O atendimento segue com o corretor.");
      setVersao((v) => v + 1);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível parar a IA."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border p-3" aria-label="Conversa da IA">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Conversa da IA</h3>
        <Pill tom={ativa ? "blue" : conversa.estado === "optout" ? "red" : "green"}>
          {ESTADO_CONVERSA_LABEL[conversa.estado]}
        </Pill>
        {teste && <Pill tom="amber">Modo teste: nada é enviado</Pill>}
      </div>
      {conversa.resumo && (
        <p className="rounded-md bg-muted/50 p-2 text-xs">
          <span className="font-medium">Resumo: </span>
          {conversa.resumo}
        </p>
      )}
      <ol className="max-h-80 space-y-2 overflow-y-auto">
        {msgs.map((m) => (
          <li key={m.id} className={m.autor === "cliente" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left ${
                m.autor === "cliente" ? "bg-primary/10" : "bg-muted"
              }`}
            >
              {m.texto}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {m.autor === "cliente" ? "Cliente" : m.autor === "ia" ? "IA" : "Sistema"} · {hora(m.created_at)} ·{" "}
              {STATUS_MSG_LABEL[m.status]}
            </div>
          </li>
        ))}
      </ol>
      {gestor && teste && ativa && (
        <div className="space-y-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={1000}
            placeholder="Responda como se fosse o cliente (ex.: Sim, quero comprar) — teste, nada é enviado"
            aria-label="Responder como cliente"
          />
          <Button size="sm" disabled={busy || !texto.trim()} onClick={() => void enviar()}>
            Responder como cliente
          </Button>
        </div>
      )}
      {ativa && (gestor || podeAtender) && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void parar()}>
          Parar a IA e assumir
        </Button>
      )}
    </section>
  );
}
