// Painel da tela "Assinatura digital" (t_7508c6b6). Só apresenta e dispara as ações; quem pode e o
// que é válido o servidor decide de novo. Chave e segredo: o campo começa sempre vazio e, depois de
// salvo, a tela só mostra "configurada" e a data — nunca o valor, nem mascarado.
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  KeyRound,
  PlugZap,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TOM_PILL, TOM_PONTO } from "@/components/visual/base";
import { cn } from "@/lib/utils";
import {
  auditoriaTexto,
  estaLigada,
  formatDataHora,
  parseAllowlist,
  parseDeadline,
  podeLigar,
  requisitosParaLigar,
  WEBHOOK_EVENTS,
  type ClicksignConfig,
  type ConnectionTest,
} from "@/lib/clicksign-config";

export type ConfigPanelProps = {
  config: ClicksignConfig;
  busy: boolean;
  lastTest: ConnectionTest | null;
  onSaveSecret: (kind: "access_token" | "webhook", value: string) => Promise<boolean>;
  onSave: (p: {
    test_mode?: boolean;
    signer_ids?: string[];
    allowlist?: string[];
    deadline_days?: number;
  }) => Promise<boolean>;
  onTest: () => void;
  onSetEnabled: (on: boolean) => void;
  onCopy: (text: string) => void;
};

function Estado({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const tom = ok ? "green" : "amber";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium",
        TOM_PILL[tom],
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", TOM_PONTO[tom])} aria-hidden />
      {children}
    </span>
  );
}

function SecretField({
  id,
  label,
  configured,
  setAt,
  busy,
  onSave,
}: {
  id: string;
  label: string;
  configured: boolean;
  setAt: string | null;
  busy: boolean;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Estado ok={configured}>
          {configured
            ? `${label} configurada em ${formatDataHora(setAt)}`
            : `${label} não configurada`}
        </Estado>
      </div>
      <Label htmlFor={id}>
        {configured ? `Trocar ${label.toLowerCase()}` : `Colar ${label.toLowerCase()}`}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={configured ? "Cole aqui só se for trocar" : "Cole aqui"}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          disabled={busy || value.trim().length === 0}
          onClick={async () => {
            if (await onSave(value)) setValue("");
          }}
        >
          {configured ? "Trocar" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

export function ClicksignConfigPanel(props: ConfigPanelProps) {
  const { config: c, busy, lastTest } = props;
  const ligada = estaLigada(c);
  const requisitos = requisitosParaLigar(c);
  const [signers, setSigners] = useState<string[]>(c.signer_ids);
  const [deadline, setDeadline] = useState(String(c.deadline_days));
  const [allowText, setAllowText] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);
  useEffect(() => setSigners(c.signer_ids), [c.signer_ids]);
  useEffect(() => setDeadline(String(c.deadline_days)), [c.deadline_days]);

  const deadlineOk = parseDeadline(deadline);
  const signersMudou =
    signers.length !== c.signer_ids.length || signers.some((s) => !c.signer_ids.includes(s));
  const allow = parseAllowlist(allowText);

  return (
    <div className="space-y-6" data-testid="clicksign-config">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" aria-hidden /> Situação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2" role="status" aria-live="polite">
            <Estado ok={ligada}>
              {ligada
                ? "Assinatura digital ligada (captação e venda)"
                : "Assinatura digital desligada"}
            </Estado>
            <Estado ok={!c.test_mode}>{c.test_mode ? "Modo teste" : "Modo real"}</Estado>
          </div>
          {!ligada && (
            <ul className="space-y-1 text-sm" data-testid="requisitos">
              {requisitos.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  {r.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
                  ) : (
                    <CircleAlert className="h-4 w-4 text-amber-600" aria-hidden />
                  )}
                  <span>
                    {r.label}: {r.ok ? "ok" : "falta"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {ligada ? (
            <Button variant="destructive" disabled={busy} onClick={() => setConfirmOff(true)}>
              Desligar assinatura digital
            </Button>
          ) : (
            <Button disabled={busy || !podeLigar(c)} onClick={() => setConfirmOn(true)}>
              Ligar assinatura digital
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" aria-hidden /> 1. Chave de API da Clicksign
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Na conta da imobiliária na Clicksign: Configurações → API → gerar chave de acesso (conta
            de produção). Depois de salva, a chave fica guardada em cofre e não aparece mais aqui.
          </p>
          <SecretField
            id="cs-token"
            label="Chave"
            configured={c.token.configured}
            setAt={c.token.set_at}
            busy={busy}
            onSave={(v) => props.onSaveSecret("access_token", v)}
          />
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button variant="outline" disabled={busy || !c.token.configured} onClick={props.onTest}>
              <PlugZap className="mr-2 h-4 w-4" aria-hidden /> Testar conexão
            </Button>
            {lastTest ? (
              <Estado ok={lastTest.ok}>{lastTest.message}</Estado>
            ) : c.connection.checked_at ? (
              <Estado ok={c.connection.ok === true}>
                {c.connection.ok ? "Último teste ok" : "Último teste falhou"} em{" "}
                {formatDataHora(c.connection.checked_at)}
              </Estado>
            ) : (
              <span className="text-sm text-muted-foreground">Ainda não testada.</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            O teste só consulta a Clicksign (lista 1 envelope); não cria, não altera e não envia
            nada.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" aria-hidden /> 2. Webhook (avisos da Clicksign)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Na Clicksign: Configurações → Webhooks → Adicionar. Cole o endereço abaixo, marque os
            eventos <strong>{WEBHOOK_EVENTS.join(", ")}</strong>, salve e copie o segredo (HMAC
            SHA256) que a Clicksign mostrar.
          </p>
          <div className="space-y-1">
            <Label htmlFor="cs-webhook-url">Endereço do webhook desta imobiliária</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="cs-webhook-url"
                readOnly
                value={c.webhook_url ?? ""}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                disabled={!c.webhook_url}
                onClick={() => c.webhook_url && props.onCopy(c.webhook_url)}
              >
                <Copy className="mr-2 h-4 w-4" aria-hidden /> Copiar
              </Button>
            </div>
          </div>
          <SecretField
            id="cs-webhook-secret"
            label="Segredo do webhook"
            configured={c.webhook.configured}
            setAt={c.webhook.set_at}
            busy={busy}
            onSave={(v) => props.onSaveSecret("webhook", v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Quem assina pela imobiliária</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Só usuários ativos desta imobiliária. Nome e e-mail vêm do cadastro de cada um. Na hora
            do envio, o gestor escolhe entre estas pessoas.
          </p>
          <ul
            className="max-h-72 space-y-2 overflow-auto rounded-md border p-3"
            data-testid="candidatos"
          >
            {c.candidates.length === 0 && (
              <li className="text-sm text-muted-foreground">Nenhum usuário ativo encontrado.</li>
            )}
            {c.candidates.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <Checkbox
                  id={`cs-signer-${p.id}`}
                  disabled={busy || !p.email_ok}
                  checked={signers.includes(p.id)}
                  onCheckedChange={(v) =>
                    setSigners((cur) => (v ? [...cur, p.id] : cur.filter((x) => x !== p.id)))
                  }
                />
                <Label htmlFor={`cs-signer-${p.id}`} className="font-normal">
                  {p.nome}{" "}
                  <span className="text-muted-foreground">
                    {p.email_ok ? `(${p.email})` : "(sem e-mail no cadastro)"}
                  </span>
                </Label>
              </li>
            ))}
          </ul>
          <Button
            disabled={busy || !signersMudou}
            onClick={() => void props.onSave({ signer_ids: signers })}
          >
            Salvar quem assina
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Prazo e modo teste</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1">
            <Label htmlFor="cs-deadline">Prazo para assinar (dias, de 1 a 90)</Label>
            <div className="flex gap-2">
              <Input
                id="cs-deadline"
                inputMode="numeric"
                className="w-28"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={busy || deadlineOk === null || deadlineOk === c.deadline_days}
                onClick={() => deadlineOk && void props.onSave({ deadline_days: deadlineOk })}
              >
                Salvar prazo
              </Button>
            </div>
            {deadlineOk === null && (
              <p className="text-sm text-destructive">Use um número de 1 a 90.</p>
            )}
          </div>
          <div className="flex items-start gap-3 border-t pt-4">
            <Switch
              id="cs-test-mode"
              checked={c.test_mode}
              disabled={busy}
              onCheckedChange={(v) => void props.onSave({ test_mode: v })}
            />
            <div>
              <Label htmlFor="cs-test-mode">Modo teste</Label>
              <p className="text-sm text-muted-foreground">
                Ligado: os envios saem marcados como TESTE e só para os e-mails da lista abaixo.
                Desligue quando for usar com clientes de verdade.
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cs-allowlist">E-mails liberados no modo teste</Label>
            <p className="text-sm text-muted-foreground">
              {c.allowlist_count} e-mail(s) cadastrados. Por segurança a lista não é mostrada; para
              mudar, digite a lista completa nova (separada por vírgula ou linha) — ela substitui a
              anterior.
            </p>
            <Textarea
              id="cs-allowlist"
              rows={3}
              value={allowText}
              placeholder="ex.: teste1@exemplo.com, teste2@exemplo.com"
              onChange={(e) => setAllowText(e.target.value)}
            />
            {allow.invalid.length > 0 && (
              <p className="text-sm text-destructive">
                E-mail inválido: {allow.invalid.join(", ")}
              </p>
            )}
            <Button
              variant="outline"
              disabled={busy || allow.emails.length === 0 || allow.invalid.length > 0}
              onClick={async () => {
                if (await props.onSave({ allowlist: allow.emails })) setAllowText("");
              }}
            >
              Substituir lista ({allow.emails.length})
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de alterações</CardTitle>
        </CardHeader>
        <CardContent>
          {c.audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma alteração registrada por esta tela.
            </p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="auditoria">
              {c.audit.map((a, i) => (
                <li key={`${a.created_at}-${i}`}>
                  <span className="text-muted-foreground">{formatDataHora(a.created_at)}</span> —{" "}
                  {a.actor}: {auditoriaTexto(a)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOn} onOpenChange={setConfirmOn}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar a assinatura digital?</AlertDialogTitle>
            <AlertDialogDescription>
              O botão de envio pela Clicksign aparece na captação e na venda desta imobiliária
              {c.test_mode ? " (em modo teste: só para os e-mails liberados)" : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                setConfirmOn(false);
                props.onSetEnabled(true);
              }}
            >
              Sim, ligar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desligar a assinatura digital?</AlertDialogTitle>
            <AlertDialogDescription>
              Novos envios pela Clicksign param na captação e na venda. Envelopes já enviados
              continuam na Clicksign e os documentos e o histórico ficam guardados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                setConfirmOff(false);
                props.onSetEnabled(false);
              }}
            >
              Sim, desligar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
