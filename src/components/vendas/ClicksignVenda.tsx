import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertTriangle,
  Ban,
  Eye,
  FileCheck,
  Pencil,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignerStatusBadge } from "@/components/clicksign/SignerStatusBadge";
import { TrocarParaPapelButton } from "@/components/vendas/AssinaturaManualVenda";
import { podeTrocarParaPapel } from "@/lib/assinatura-manual";
import { errorMessage } from "@/lib/errors";
import { editSignerErrors, notifyWaitMinutes, type ManagedSigner } from "@/lib/exclusive-clicksign";
import {
  cancelSaleClicksign,
  canCancelSaleEnvelope,
  canReconcile,
  canStartSaleEnvelope,
  CLICKSIGN_SEND_STATUSES,
  clicksignSaleCandidates,
  clicksignSaleSigned,
  editSaleSigner,
  EXTRA_ROLE_OPTIONS,
  missingEmailMessage,
  needsAutoCancel,
  reconcileSaleClicksign,
  resendSaleNotice,
  SALE_ROLE_LABEL,
  saleEnvelopeStatusLabel,
  saleSendCheck,
  saleSignersStatus,
  SaleClicksignError,
  sendSaleToClicksign,
  WITNESS_COUNT,
  type Candidate,
  type ClicksignSaleConfig,
  type ExtraDraft,
  type MissingEmail,
  type SaleParty,
  type SaleSignedInfo,
  type Testemunha,
} from "@/lib/sale-clicksign";

type Props = {
  db: SupabaseClient;
  saleId: string;
  status: string;
  config: ClicksignSaleConfig;
  parties: SaleParty[];
  /** Diálogo de envio (aberto pelo botão "Enviar pela Clicksign" do topo/rodapé). */
  sendOpen: boolean;
  onSendOpenChange: (open: boolean) => void;
  /** Atalho para a aba Partes, no campo de e-mail da parte (ex.: "comprador_2"). */
  onIrParaParte: (parte: string) => void;
  /** Contrato assinado atual (tipo contrato_assinado), para ver/baixar. */
  signedDoc: { id: string; file_name: string } | null;
  onOpenSignedDoc: () => void;
  onChanged: () => Promise<unknown> | void;
};

const emptyWitnesses = (): Testemunha[] =>
  Array.from({ length: WITNESS_COUNT }, () => ({ nome: "", email: "" }));

/**
 * Clicksign na VENDA, dentro de "Contrato / assinatura": envio com signatários padrão + extras,
 * acompanhamento por signatário (Enviado / Abriu o contrato / Assinou), reenviar aviso, editar
 * signatário, cancelar assinatura e "Documento assinado". Corretor só acompanha (can_send=false).
 */
export function ClicksignVenda({
  db,
  saleId,
  status,
  config,
  parties,
  sendOpen,
  onSendOpenChange,
  onIrParaParte,
  signedDoc,
  onOpenSignedDoc,
  onChanged,
}: Props) {
  const enabled = config.enabled;
  const env = enabled ? config.envelope : null;
  const canAct = enabled && config.can_send;
  const [busy, setBusy] = useState(false);

  // ---------- cancelamento automático (nova versão do contrato / status mudou) ----------
  const autoCancelTried = useRef<string | null>(null);
  useEffect(() => {
    if (!needsAutoCancel(config) || !env?.cancel_requested_at) return;
    if (autoCancelTried.current === env.cancel_requested_at) return;
    autoCancelTried.current = env.cancel_requested_at;
    void (async () => {
      try {
        const r = await cancelSaleClicksign(db, saleId);
        if (r.warning) toast.warning(r.warning, { duration: 10000 });
        else
          toast.info(
            r.reason === "nova_versao"
              ? "Saiu uma nova versão do contrato: a assinatura antiga foi cancelada na Clicksign. Envie de novo."
              : "A assinatura em andamento foi cancelada na Clicksign.",
            { duration: 10000 },
          );
        await onChanged();
      } catch (e) {
        toast.error(errorMessage(e, "Não foi possível cancelar a assinatura antiga agora"));
      }
    })();
  }, [config, env?.cancel_requested_at, db, saleId, onChanged]);

  // ---------- documento assinado ----------
  const [signed, setSigned] = useState<SaleSignedInfo | null>(null);
  useEffect(() => {
    if (!enabled || !signedDoc) {
      setSigned(null);
      return;
    }
    let alive = true;
    void clicksignSaleSigned(db, saleId).then((s) => {
      if (alive) setSigned(s && s.document_id === signedDoc.id ? s : null);
    });
    return () => {
      alive = false;
    };
  }, [enabled, signedDoc, db, saleId]);

  if (!enabled) return null;

  const cancelar = async () => {
    if (
      !window.confirm(
        "Cancelar a assinatura na Clicksign? Ninguém mais poderá assinar este envelope e a venda volta para “Contrato OK do corretor”. Depois é possível enviar de novo.",
      )
    )
      return;
    setBusy(true);
    try {
      const r = await cancelSaleClicksign(db, saleId);
      if (r.warning) toast.warning(r.warning, { duration: 10000 });
      else toast.success("Assinatura cancelada na Clicksign.");
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível cancelar a assinatura"));
    } finally {
      setBusy(false);
    }
  };

  // Clicksign → papel (t_e6f778ac): cancela o envelope e a venda fica em aguardando_assinatura.
  const trocarParaPapel = async () => {
    try {
      const r = await cancelSaleClicksign(db, saleId, true);
      if (r.warning) toast.warning(r.warning, { duration: 10000 });
      else if (r.reason !== "papel")
        toast.info("A assinatura foi cancelada por outro motivo; confira a etapa da venda.");
      else toast.success("Clicksign cancelada. Siga com a assinatura manual (papel).");
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível cancelar a Clicksign"));
    }
  };

  const conferir = async () => {
    setBusy(true);
    try {
      const r = await reconcileSaleClicksign(db, saleId);
      if (r.result === "manual") toast.warning(r.message, { duration: 12000 });
      else toast.success(r.message);
      if (r.warning) toast.warning(r.warning, { duration: 10000 });
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível conferir na Clicksign agora"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="clicksign-venda">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <PenLine className="h-4 w-4 text-primary" /> Contrato / assinatura · Clicksign
          {config.test_mode && <span className="text-xs text-amber-700">(modo teste)</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {podeTrocarParaPapel(config, status) && (
            <TrocarParaPapelButton onConfirm={trocarParaPapel} />
          )}
          {canCancelSaleEnvelope(config) && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancelar()}>
              <Ban className="mr-1 h-4 w-4" /> Cancelar assinatura
            </Button>
          )}
        </div>
      </div>
      {config.contrato && (
        <p className="text-xs text-muted-foreground">
          Contrato do jurídico que vai para assinatura (versão mais recente):{" "}
          <b className="text-foreground">{config.contrato.file_name}</b>
        </p>
      )}
      {!config.libera_assinatura && (
        <p className="text-sm text-amber-800">
          <AlertTriangle className="mr-1 inline h-4 w-4" />O jurídico bloqueou o contrato: o envio
          pela Clicksign fica travado até a liberação.
        </p>
      )}
      {env && <p className="text-sm">{saleEnvelopeStatusLabel(env)}</p>}
      {canReconcile(canAct, env) && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          data-testid="clicksign-conferir"
          onClick={() => void conferir()}
        >
          <RefreshCw className="mr-1 h-4 w-4" /> Conferir na Clicksign
        </Button>
      )}

      {env?.status === "running" && (
        <GestaoVenda
          db={db}
          saleId={saleId}
          canAct={canAct}
          testMode={config.test_mode}
          notifyAvailableAt={env.notify_available_at ?? null}
          onChanged={onChanged}
        />
      )}

      {signedDoc && (
        <div
          className="space-y-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-2.5 text-sm text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100"
          data-testid="documento-assinado"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <FileCheck className="h-4 w-4 shrink-0" /> Documento assinado
            </span>
            <Button size="sm" variant="outline" className="h-7" onClick={onOpenSignedDoc}>
              <Eye className="mr-1.5 h-3.5 w-3.5" /> Ver / baixar
            </Button>
          </div>
          <div className="truncate text-xs" title={signedDoc.file_name}>
            {signedDoc.file_name}
          </div>
          <div className="text-xs">
            Origem:{" "}
            {signed
              ? `Clicksign${signed.is_test ? " (TESTE)" : ""}, anexado automaticamente${
                  signed.auto_marked ? " e venda marcada como assinada sozinha" : ""
                }`
              : "upload manual (anexado no ADM MAX)"}
            {signed?.closed_at
              ? ` · todos assinaram em ${new Date(signed.closed_at).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}`
              : ""}
          </div>
          {signed && signed.signers.length > 0 && (
            <ul className="list-inside list-disc text-xs">
              {signed.signers.map((s, i) => (
                <li key={`${s.papel}-${i}`}>
                  {s.label || s.papel}: {s.nome}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canAct && CLICKSIGN_SEND_STATUSES.includes(status) && canStartSaleEnvelope(env) && (
        <EnvioDialog
          db={db}
          saleId={saleId}
          config={config}
          parties={parties}
          open={sendOpen}
          onOpenChange={onSendOpenChange}
          onIrParaParte={onIrParaParte}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

// ---------- envelope em assinatura: status por signatário, reenviar aviso, editar ----------

function GestaoVenda({
  db,
  saleId,
  canAct,
  testMode,
  notifyAvailableAt,
  onChanged,
}: {
  db: SupabaseClient;
  saleId: string;
  canAct: boolean;
  testMode: boolean;
  notifyAvailableAt: string | null;
  onChanged: () => Promise<unknown> | void;
}) {
  const [signers, setSigners] = useState<ManagedSigner[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ManagedSigner | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!canAct) return;
    setLoadError(null);
    try {
      setSigners(await saleSignersStatus(db, saleId));
    } catch (e) {
      setSigners(null);
      setLoadError(errorMessage(e, "Não foi possível consultar a Clicksign agora."));
    }
  }, [db, saleId, canAct]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  if (!canAct) {
    return (
      <p className="text-xs text-muted-foreground">
        O gestor, o team leader, o jurídico ou o ADM acompanham quem já abriu e assinou. Você será avisado quando o
        contrato assinado for anexado.
      </p>
    );
  }

  const wait = notifyWaitMinutes({ notify_available_at: notifyAvailableAt } as never, now);
  const pendentes = signers?.filter((s) => !s.signed).length ?? null;
  const editErrors = editing ? editSignerErrors(nome, email) : [];

  const reenviar = async () => {
    if (!window.confirm("Reenviar o aviso por e-mail a quem ainda não assinou?")) return;
    setBusy(true);
    try {
      const r = await resendSaleNotice(db, saleId);
      if (r.warning) toast.warning(r.warning);
      else toast.success("Aviso reenviado a quem ainda não assinou.");
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível reenviar o aviso"));
    } finally {
      setBusy(false);
    }
  };
  const salvar = async () => {
    if (!editing || editErrors.length) return;
    setBusy(true);
    try {
      const r = await editSaleSigner(db, { saleId, idx: editing.idx, nome, email });
      if (r.warning) toast.warning(r.warning, { duration: 10000 });
      else toast.success(`${editing.label} alterado. A Clicksign enviou o convite ao e-mail novo.`);
      setEditing(null);
      await onChanged();
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível alterar o signatário"));
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="clicksign-venda-gestao">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Signatários
          {pendentes !== null && (
            <span className="ml-1 font-normal text-muted-foreground">
              · {pendentes === 0 ? "todos assinaram" : `faltam ${pendentes}`}
            </span>
          )}
        </p>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
          <RefreshCw className="mr-1 h-4 w-4" /> Atualizar
        </Button>
      </div>
      {loadError && <p className="text-sm text-amber-800">{loadError}</p>}
      {!signers && !loadError && (
        <p className="text-sm text-muted-foreground">Consultando a Clicksign…</p>
      )}
      {signers && (
        <ul className="divide-y text-sm">
          {signers.map((s) => (
            <li key={s.idx} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {s.label}: {s.nome}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.found ? s.email : "não encontrado no envelope da Clicksign"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <SignerStatusBadge signer={s} />
                {s.editable && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    aria-label={`Editar ${s.label}`}
                    onClick={() => {
                      setEditing(s);
                      setNome(s.nome);
                      setEmail("");
                    }}
                  >
                    <Pencil className="mr-1 h-4 w-4" /> Editar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || wait > 0 || pendentes === 0}
          onClick={() => void reenviar()}
        >
          <Send className="mr-1 h-4 w-4" /> Reenviar aviso
        </Button>
        <span className="text-xs text-muted-foreground">
          {wait > 0
            ? `Aviso reenviado há pouco; libera em ${wait} min.`
            : "Manda de novo o e-mail para quem ainda não assinou."}
        </span>
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !busy && !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar signatário: {editing?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A Clicksign troca a pessoa no envelope e manda o convite ao e-mail novo.
              {testMode ? " Modo teste: só e-mails da lista autorizada de teste." : ""}
            </p>
            <div className="space-y-1">
              <Label htmlFor="csv-edit-nome">Nome completo</Label>
              <Input
                id="csv-edit-nome"
                maxLength={200}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="csv-edit-email">E-mail correto</Label>
              <Input
                id="csv-edit-email"
                type="email"
                maxLength={200}
                placeholder={editing?.email ? `atual: ${editing.email}` : ""}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {editErrors.length > 0 && (nome || email) && (
              <ul className="list-disc rounded-md border border-amber-300 bg-amber-50 py-2 pl-6 pr-3 text-sm text-amber-900">
                {editErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button disabled={busy || editErrors.length > 0} onClick={() => void salvar()}>
              {busy ? "Salvando…" : "Salvar e enviar convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- diálogo de envio ----------

function MissingEmailList({
  missing,
  onIr,
}: {
  missing: MissingEmail[];
  onIr: (parte: string) => void;
}) {
  if (!missing.length) return null;
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900"
      data-testid="clicksign-faltam-emails"
    >
      <div className="font-medium">Falta e-mail para enviar pela Clicksign:</div>
      {missing.map((m) => (
        <div key={m.parte} className="flex flex-wrap items-center justify-between gap-2">
          <span>{missingEmailMessage(m)}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => onIr(m.parte)}>
            Preencher na aba Partes
          </Button>
        </div>
      ))}
    </div>
  );
}

function EnvioDialog({
  db,
  saleId,
  config,
  parties,
  open,
  onOpenChange,
  onIrParaParte,
  onChanged,
}: {
  db: SupabaseClient;
  saleId: string;
  config: Extract<ClicksignSaleConfig, { enabled: true }>;
  parties: SaleParty[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIrParaParte: (parte: string) => void;
  onChanged: () => Promise<unknown> | void;
}) {
  const [imobIds, setImobIds] = useState<string[]>([]);
  const [testemunhas, setTestemunhas] = useState<Testemunha[]>(emptyWitnesses);
  const [extras, setExtras] = useState<ExtraDraft[]>([]);
  const [q, setQ] = useState("");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [fora, setFora] = useState({ nome: "", email: "", cpf: "", role: "lawyer" });
  const [busy, setBusy] = useState(false);
  const [serverMissing, setServerMissing] = useState<MissingEmail[]>([]);

  useEffect(() => {
    if (!open) return;
    setImobIds(config.imobiliaria.length === 1 ? [config.imobiliaria[0].id] : []);
    setTestemunhas(emptyWitnesses());
    setExtras([]);
    setCands(null);
    setQ("");
    setServerMissing([]);
  }, [open, config.imobiliaria]);

  const check = useMemo(
    () =>
      saleSendCheck({
        parties,
        corretores: config.corretores,
        liberaAssinatura: config.libera_assinatura,
        contratoSize: config.contrato?.size ?? null,
        imobiliariaIds: imobIds,
        testemunhas,
        extras,
      }),
    [
      parties,
      config.corretores,
      config.libera_assinatura,
      config.contrato?.size,
      imobIds,
      testemunhas,
      extras,
    ],
  );
  const missing = check.missing.length ? check.missing : serverMissing;
  const blocked = missing.length > 0 || check.errors.length > 0 || !config.contrato;
  const partes = parties.filter((p) => /^(vendedor|comprador)_\d+$/.test(p.papel));

  const buscar = async () => {
    try {
      setCands(await clicksignSaleCandidates(db, saleId, q));
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível buscar agora"));
    }
  };
  const addSistema = (c: Candidate) => {
    if (extras.some((x) => x.origem === "sistema" && x.ref === c.ref)) return;
    setExtras((l) => [
      ...l,
      {
        origem: "sistema",
        ref: c.ref,
        nome: c.nome,
        email: c.email,
        role: c.tipo === "corretor" ? "real_estate_broker" : "intermediary",
      },
    ]);
  };
  const addFora = () => {
    setExtras((l) => [...l, { origem: "externo", ...fora }]);
    setFora({ nome: "", email: "", cpf: "", role: "lawyer" });
  };
  const irParaParte = (parte: string) => {
    onOpenChange(false);
    onIrParaParte(parte);
  };

  const enviar = async () => {
    if (blocked) return;
    if (
      !window.confirm(
        `Enviar o contrato para ${partes.length + config.corretores.length + imobIds.length + WITNESS_COUNT + extras.length} signatários pela Clicksign? Todos assinam ao mesmo tempo, com prazo de ${config.deadline_days} dias.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await sendSaleToClicksign(db, {
        saleId,
        imobiliariaIds: imobIds,
        testemunhas,
        extras,
      });
      if (r.warning) toast.warning(r.warning, { duration: 12000 });
      else
        toast.success(
          `Contrato enviado pela Clicksign${r.is_test ? " (TESTE)" : ""} para ${r.signers} signatários.`,
        );
      onOpenChange(false);
      await onChanged();
    } catch (e) {
      if (e instanceof SaleClicksignError && e.missing.length) setServerMissing(e.missing);
      toast.error(errorMessage(e, "Falha ao enviar para a Clicksign"), { duration: 10000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar pela Clicksign</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Vai o contrato do jurídico <b>{config.contrato?.file_name ?? "(sem contrato)"}</b>.
            Todos assinam ao mesmo tempo, prazo de {config.deadline_days} dias.
            {config.test_mode ? " Modo teste: só e-mails da lista autorizada." : ""}
          </p>
          <MissingEmailList missing={missing} onIr={irParaParte} />

          <section className="space-y-1">
            <h4 className="font-medium">Partes da venda e corretor</h4>
            <ul className="divide-y rounded-md border">
              {partes.map((p) => (
                <li key={p.papel} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span>
                    {SALE_ROLE_LABEL[p.papel.startsWith("vendedor") ? "seller" : "buyer"]} ·{" "}
                    {p.nome || "(sem nome)"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {missing.some((m) => m.parte === p.papel) ? "sem e-mail" : "e-mail ok"}
                  </span>
                </li>
              ))}
              {config.corretores.map((c, i) => (
                <li key={`c-${i}`} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span>Corretor(a) · {c.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.email_ok ? "e-mail ok" : "cadastro sem e-mail"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-1">
            <h4 className="font-medium">Pela imobiliária</h4>
            {config.imobiliaria.length === 0 && (
              <p className="text-amber-800">
                Nenhuma pessoa autorizada configurada na imobiliária.
              </p>
            )}
            {config.imobiliaria.map((p) => (
              <label key={p.id} className="flex items-center gap-2">
                <Checkbox
                  checked={imobIds.includes(p.id)}
                  onCheckedChange={(v) =>
                    setImobIds((l) => (v ? [...l, p.id] : l.filter((x) => x !== p.id)))
                  }
                />
                {p.nome}
              </label>
            ))}
          </section>

          <section className="space-y-2">
            <h4 className="font-medium">Testemunhas ({WITNESS_COUNT} obrigatórias)</h4>
            {testemunhas.map((t, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label={`Nome da testemunha ${i + 1}`}
                  placeholder={`Testemunha ${i + 1}: nome completo`}
                  maxLength={200}
                  value={t.nome}
                  onChange={(e) =>
                    setTestemunhas((l) =>
                      l.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)),
                    )
                  }
                />
                <Input
                  aria-label={`E-mail da testemunha ${i + 1}`}
                  placeholder="e-mail"
                  type="email"
                  maxLength={200}
                  value={t.email}
                  onChange={(e) =>
                    setTestemunhas((l) =>
                      l.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)),
                    )
                  }
                />
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h4 className="font-medium">Partes extras (opcional)</h4>
            {extras.length > 0 && (
              <ul className="divide-y rounded-md border">
                {extras.map((x, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5"
                  >
                    <span className="min-w-0">
                      {x.nome} <span className="text-xs text-muted-foreground">{x.email}</span>
                      <span className="ml-1 text-xs">
                        ({x.origem === "sistema" ? "do sistema" : "de fora"})
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Select
                        value={x.role}
                        onValueChange={(v) =>
                          setExtras((l) => l.map((y, j) => (j === i ? { ...y, role: v } : y)))
                        }
                      >
                        <SelectTrigger className="h-8 w-48" aria-label={`Papel de ${x.nome}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXTRA_ROLE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remover ${x.nome}`}
                        onClick={() => setExtras((l) => l.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-1 rounded-md border p-2">
              <Label htmlFor="csv-busca">Do sistema: corretores e parceiros</Label>
              <div className="flex gap-2">
                <Input
                  id="csv-busca"
                  placeholder="Buscar pelo nome"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void buscar()}
                />
                <Button variant="outline" onClick={() => void buscar()}>
                  <Search className="mr-1 h-4 w-4" /> Buscar
                </Button>
              </div>
              {cands && cands.length === 0 && (
                <p className="text-xs text-muted-foreground">Ninguém encontrado com e-mail.</p>
              )}
              {cands?.map((c) => (
                <div key={c.ref} className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    {c.nome} · {c.tipo === "corretor" ? "corretor" : "parceiro"} · {c.email}
                  </span>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => addSistema(c)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Incluir
                  </Button>
                </div>
              ))}
            </div>
            <div className="space-y-2 rounded-md border p-2">
              <Label>Pessoa de fora (advogado, cônjuge anuente…)</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="Nome da pessoa de fora"
                  placeholder="Nome completo"
                  maxLength={200}
                  value={fora.nome}
                  onChange={(e) => setFora((f) => ({ ...f, nome: e.target.value }))}
                />
                <Input
                  aria-label="E-mail da pessoa de fora"
                  placeholder="e-mail"
                  type="email"
                  maxLength={200}
                  value={fora.email}
                  onChange={(e) => setFora((f) => ({ ...f, email: e.target.value }))}
                />
                <Input
                  aria-label="CPF da pessoa de fora (opcional)"
                  placeholder="CPF (opcional)"
                  maxLength={20}
                  value={fora.cpf}
                  onChange={(e) => setFora((f) => ({ ...f, cpf: e.target.value }))}
                />
                <Select
                  value={fora.role}
                  onValueChange={(v) => setFora((f) => ({ ...f, role: v }))}
                >
                  <SelectTrigger aria-label="Papel da pessoa de fora">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXTRA_ROLE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!fora.nome.trim() || !fora.email.trim()}
                onClick={addFora}
              >
                <Plus className="mr-1 h-4 w-4" /> Incluir pessoa de fora
              </Button>
            </div>
          </section>

          {check.errors.length > 0 && (
            <ul
              className="list-disc rounded-md border border-amber-300 bg-amber-50 py-2 pl-6 pr-3 text-amber-900"
              data-testid="clicksign-venda-erros"
            >
              {check.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button disabled={busy || blocked} onClick={() => void enviar()}>
            <Send className="mr-1 h-4 w-4" />
            {busy ? "Enviando…" : "Enviar pela Clicksign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
