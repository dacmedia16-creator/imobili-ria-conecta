import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mail, RotateCw, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import {
  INVITE_STATUS_LABEL,
  INVITE_TTL_DAYS,
  inviteEmailSchema,
  type InviteDisplayStatus,
  type InviteListItem,
} from "@/lib/org-invites";
import {
  cancelOrgInvite,
  createOrgInvite,
  listOrgInvites,
  resendOrgInvite,
} from "@/lib/org-invites.functions";

const TONE: Record<InviteDisplayStatus, string> = {
  enviado: "bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200",
  aceito: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
  expirado: "bg-amber-100 text-amber-950 dark:bg-amber-500/15 dark:text-amber-200",
  cancelado: "bg-muted text-muted-foreground",
  substituido: "bg-muted text-muted-foreground",
};

const data = (v: string | null) =>
  v
    ? new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) +
      " " +
      new Date(v).toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/**
 * Convite para o dono de uma imobiliária se cadastrar sozinho (t_6e4dab96).
 * Envia e-mail com link de uso único (7 dias); lista os convites com status, Reenviar e Cancelar.
 */
export function OrgInvitesPanel() {
  const listFn = useServerFn(listOrgInvites);
  const createFn = useServerFn(createOrgInvite);
  const resendFn = useServerFn(resendOrgInvite);
  const cancelFn = useServerFn(cancelOrgInvite);
  const [items, setItems] = useState<InviteListItem[] | null>(null);
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await listFn());
    } catch (e) {
      setErro(errorMessage(e, "Não foi possível carregar os convites."));
    }
  }, [listFn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const avisoEnvio = (r: { emailSent: boolean; emailError: string | null }, alvo: string) => {
    if (r.emailSent) toast.success(`Convite enviado para ${alvo}`);
    else
      toast.warning(
        "Convite criado, mas o e-mail não saiu. Use “Reenviar” em alguns minutos.",
      );
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = inviteEmailSchema.safeParse(email);
    if (!parsed.success) {
      setErro("Digite um e-mail válido.");
      return;
    }
    setErro(null);
    setBusy("novo");
    try {
      avisoEnvio(await createFn({ data: { email: parsed.data } }), parsed.data);
      setEmail("");
      await reload();
    } catch (err) {
      setErro(errorMessage(err, "Não foi possível enviar o convite."));
    } finally {
      setBusy(null);
    }
  };

  const acao = async (i: InviteListItem, tipo: "reenviar" | "cancelar") => {
    setBusy(i.id);
    try {
      if (tipo === "reenviar") avisoEnvio(await resendFn({ data: { inviteId: i.id } }), i.email);
      else {
        await cancelFn({ data: { inviteId: i.id } });
        toast.success("Convite cancelado: o link deixou de funcionar.");
      }
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível concluir a ação."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="rounded-xl shadow-sm" aria-labelledby="convites-titulo">
      <CardHeader className="pb-3">
        <CardTitle id="convites-titulo" className="flex items-center gap-2 text-lg">
          <Mail className="h-5 w-5 text-primary" aria-hidden /> Convidar dono de imobiliária
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          O dono recebe um e-mail, entra com o Google desse e-mail e cadastra a imobiliária sozinho.
          O link vale {INVITE_TTL_DAYS} dias e funciona uma vez só. A imobiliária nasce ativa, com
          todos os módulos menos Oportunidades.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={enviar} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="convite-email">E-mail do dono</Label>
            <Input
              id="convite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dono@imobiliaria.com.br"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={busy === "novo"}>
            <Send className="mr-1 h-4 w-4" aria-hidden />
            {busy === "novo" ? "Enviando…" : "Enviar convite"}
          </Button>
        </form>
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}

        {items && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum convite enviado ainda.</p>
        )}
        {items && items.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label="Convites enviados">
            {items.map((i) => {
              const aberto = i.situacao === "enviado" || i.situacao === "expirado";
              return (
                <li
                  key={i.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="break-all">{i.email}</span>
                      <Badge variant="secondary" className={TONE[i.situacao]}>
                        {INVITE_STATUS_LABEL[i.situacao]}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Enviado em {data(i.created_at)} ·{" "}
                      {i.situacao === "aceito"
                        ? `Aceito em ${data(i.accepted_at)}${i.organizacao ? ` — ${i.organizacao}` : ""}`
                        : `Vale até ${data(i.expires_at)}`}
                      {i.send_error && i.situacao === "enviado" ? " · e-mail não saiu" : ""}
                    </p>
                  </div>
                  {aberto && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === i.id}
                        onClick={() => void acao(i, "reenviar")}
                      >
                        <RotateCw className="mr-1 h-4 w-4" aria-hidden /> Reenviar
                      </Button>
                      {i.situacao === "enviado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === i.id}
                          onClick={() => void acao(i, "cancelar")}
                        >
                          <XCircle className="mr-1 h-4 w-4" aria-hidden /> Cancelar
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
