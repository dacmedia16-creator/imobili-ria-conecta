/**
 * Detalhe de um chamado: conversa, print (link temporário) e ações conforme o modo:
 * - "autor": responder e "Resolveu, pode fechar";
 * - "leitura": admin da imobiliária, só acompanha;
 * - "equipe": equipe MAX responde, nota interna e status.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { linkDoPrint, responderChamado } from "@/lib/ajuda-sugestoes.functions";
import {
  STATUS_CLASSE,
  STATUS_LABEL,
  STATUS_ORDEM,
  statusLabel,
  TIPO_CLASSE,
  tipoLabel,
  type StatusChamado,
  type TipoChamado,
} from "@/lib/ajuda-sugestoes";

export type ChamadoLinha = {
  id: string;
  numero: number;
  organization_id: string;
  organizacao: string;
  author_id: string;
  autor_nome: string | null;
  autor_papeis: string | null;
  tipo: string;
  status: string;
  assunto: string;
  tela_nome: string | null;
  tela_rota: string | null;
  tem_print: boolean;
  created_at: string;
  last_message_at: string;
  resolved_at: string | null;
};

type Mensagem = {
  id: string;
  autor_equipe: boolean;
  interna: boolean;
  autor_nome: string;
  texto: string;
  created_at: string;
};

type RpcLivre = (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
export const rpcLivre = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as RpcLivre).call(supabase, fn, args);

export function SeloTipo({ tipo }: { tipo: string }) {
  return (
    <Badge variant="outline" className={TIPO_CLASSE[tipo as TipoChamado] ?? ""}>
      {tipoLabel(tipo)}
    </Badge>
  );
}
export function SeloStatus({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_CLASSE[status as StatusChamado] ?? ""}>
      {statusLabel(status)}
    </Badge>
  );
}

export function ChamadoDetalhe({
  chamado,
  modo,
  onMudou,
}: {
  chamado: ChamadoLinha;
  modo: "autor" | "leitura" | "equipe";
  onMudou: () => void;
}) {
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState("");
  const [interna, setInterna] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const responder = useServerFn(responderChamado);
  const abrirPrint = useServerFn(linkDoPrint);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await rpcLivre("support_ticket_thread", { _ticket: chamado.id });
    if (error) toast.error(error.message);
    setMsgs((data as Mensagem[] | null) ?? []);
    setCarregando(false);
  }, [chamado.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const enviar = async () => {
    if (!texto.trim()) return;
    setSalvando(true);
    try {
      await responder({ data: { ticketId: chamado.id, texto: texto.trim(), interna } });
      setTexto("");
      setInterna(false);
      toast.success(interna ? "Nota interna salva" : "Resposta enviada");
      await carregar();
      onMudou();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível responder."));
    } finally {
      setSalvando(false);
    }
  };

  const mudarStatus = async (status: string) => {
    const { error } = await rpcLivre("support_ticket_set_status", {
      _ticket: chamado.id,
      _status: status,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`Status: ${statusLabel(status)}`);
      onMudou();
    }
  };

  const verPrint = async () => {
    try {
      const { url } = await abrirPrint({ data: { ticketId: chamado.id } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(errorMessage(e, "Print indisponível."));
    }
  };

  const resolvido = chamado.status === "resolvido";

  return (
    <div className="space-y-4" data-testid="chamado-detalhe">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">
            #{chamado.numero} · {chamado.assunto}
          </h2>
          <SeloStatus status={chamado.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <SeloTipo tipo={chamado.tipo} />
          {chamado.tela_nome && <span>{chamado.tela_nome}</span>}
          {modo !== "autor" && (
            <span>
              · {chamado.organizacao} · {chamado.autor_nome ?? "Usuário"}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {msgs.map((m) => (
          <div
            key={m.id}
            className={`rounded-md border p-3 text-sm ${m.interna ? "border-amber-300 bg-amber-50" : m.autor_equipe ? "border-blue-200 bg-blue-50" : ""}`}
          >
            <div className="mb-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.autor_nome}</span> ·{" "}
              {new Date(m.created_at).toLocaleString("pt-BR")}
              {m.interna && " · Nota interna (só equipe MAX)"}
            </div>
            <p className="whitespace-pre-wrap">{m.texto}</p>
          </div>
        ))}
      </div>

      {chamado.tem_print && modo !== "leitura" && (
        <Button size="sm" variant="outline" onClick={verPrint}>
          <Paperclip className="mr-1 h-4 w-4" /> Ver print (link temporário)
        </Button>
      )}
      {chamado.tem_print && modo === "leitura" && (
        <p className="text-xs text-muted-foreground">
          Tem print anexado (só quem abriu e a equipe MAX veem).
        </p>
      )}

      {modo === "leitura" && (
        <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
          Somente leitura: quem responde é a equipe MAX.
        </p>
      )}

      {modo === "autor" && !resolvido && (
        <div className="space-y-2">
          <Textarea
            rows={3}
            maxLength={4000}
            placeholder="Escrever para a equipe MAX…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => void mudarStatus("resolvido")}>
              Resolveu, pode fechar
            </Button>
            <Button onClick={enviar} disabled={salvando || !texto.trim()}>
              {salvando ? "Enviando…" : "Enviar"}
            </Button>
          </div>
        </div>
      )}
      {modo === "autor" && resolvido && (
        <p className="text-xs text-muted-foreground">
          Chamado resolvido. Se precisar, abra um novo pelo botão Ajuda.
        </p>
      )}

      {modo === "equipe" && (
        <div className="space-y-2">
          <Textarea
            rows={3}
            maxLength={4000}
            placeholder={`Responder para ${chamado.autor_nome ?? "o usuário"}… (recebe aviso no sino)`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={interna}
              onChange={(e) => setInterna(e.target.checked)}
            />
            Nota interna (só a equipe MAX vê, não avisa ninguém)
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              Status:
              <Select value={chamado.status} onValueChange={(v) => void mudarStatus(v)}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ORDEM.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={enviar} disabled={salvando || !texto.trim()}>
              {salvando ? "Salvando…" : interna ? "Salvar nota" : "Responder"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Ao responder, o status vira “Respondido” sozinho e quem abriu é avisado pelo sino. O
            admin da imobiliária só acompanha.
          </p>
        </div>
      )}
    </div>
  );
}
