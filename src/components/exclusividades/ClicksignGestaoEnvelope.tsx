import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, Mail, Pencil, RefreshCw, Send } from "lucide-react";
import { SignerStatusBadge } from "@/components/clicksign/SignerStatusBadge";
import { Button } from "@/components/ui/button";
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
  applyCaptureContact,
  AVISO_NAO_ENTREGUE,
  AVISO_PECA_GESTOR,
  clicksignSignersStatus,
  editClicksignSigner,
  editSignerErrors,
  notifyWaitMinutes,
  ownerNumberOfPapel,
  resendClicksignNotice,
  salvarContatoAssinatura,
  type ClicksignEnvelopeInfo,
  type ManagedSigner,
} from "@/lib/exclusive-clicksign";
import { ContatoAssinaturaDialog } from "@/components/exclusividades/ContatoAssinaturaDialog";

/**
 * Envelope em assinatura (gestor/jurídico/ADM): mostra quem já assinou, reenvia o aviso a quem falta
 * (espera de 10 min entre reenvios) e corrige nome/e-mail de quem ainda não assinou. Tudo passa pela
 * edge function clicksign-manage, que confere papel, envelope e allowlist de novo no servidor.
 * canManage=false (corretor que só acompanha, t_82e51349): lista, "faltam N" e Atualizar, sem
 * Editar nem Reenviar aviso. O servidor também nega essas ações a quem não gerencia.
 */
export function ClicksignGestaoEnvelope({
  db,
  captureId,
  envelope,
  testMode,
  canManage = true,
  podeCorrigirContato = false,
  onChanged,
}: {
  db: SupabaseClient;
  captureId: string;
  envelope: ClicksignEnvelopeInfo;
  testMode: boolean;
  canManage?: boolean;
  /** Corretor captador ou gestor da captação: "Corrigir contato" do proprietário (t_867f464c). */
  podeCorrigirContato?: boolean;
  onChanged: () => Promise<unknown> | void;
}) {
  const [contato, setContato] = useState<ManagedSigner | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [signers, setSigners] = useState<ManagedSigner[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ManagedSigner | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setSigners(await clicksignSignersStatus(db, captureId));
    } catch (e) {
      setSigners(null);
      setLoadError(errorMessage(e, "Não foi possível consultar a Clicksign agora."));
    }
  }, [db, captureId]);
  useEffect(() => {
    void load();
  }, [load]);
  // Atualiza o contador do "Reenviar aviso" a cada 30 s.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  const wait = notifyWaitMinutes(envelope, now);
  const pendentes = signers?.filter((s) => !s.signed).length ?? null;
  const editErrors = editing ? editSignerErrors(nome, email) : [];

  const reenviar = async () => {
    if (!window.confirm("Reenviar o aviso por e-mail a quem ainda não assinou?")) return;
    setBusy(true);
    try {
      const r = await resendClicksignNotice(db, captureId);
      if (r.warning) toast.warning(r.warning);
      else toast.success("Aviso reenviado a quem ainda não assinou.");
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível reenviar o aviso"));
    } finally {
      setBusy(false);
    }
  };

  const abrirEdicao = (s: ManagedSigner) => {
    setEditing(s);
    setNome(s.nome);
    setEmail("");
  };
  const salvar = async () => {
    if (!editing || editErrors.length) return;
    setBusy(true);
    try {
      const r = await editClicksignSigner(db, { captureId, idx: editing.idx, nome, email });
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

  // Troca na Clicksign com o e-mail já gravado na captação (só quem gerencia; o servidor confere).
  const aplicar = async (s: ManagedSigner, confirmar = true) => {
    if (
      confirmar &&
      !window.confirm(
        `Aplicar na Clicksign o e-mail corrigido na captação (${s.capture_email ?? ""}) para ${s.label}? O convite vai para o e-mail novo.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await applyCaptureContact(db, { captureId, idx: s.idx });
      if (r.warning) toast.warning(r.warning, { duration: 10000 });
      else toast.success(`${s.label} alterado. A Clicksign enviou o convite ao e-mail novo.`);
      setAviso(null);
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível aplicar na Clicksign"));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const salvarContato = async (email: string, telefone: string) => {
    const s = contato;
    const owner = s ? ownerNumberOfPapel(s.papel) : null;
    if (!s || !owner) return;
    setBusy(true);
    let aplicarAgora = false;
    try {
      const r = await salvarContatoAssinatura(db, { captureId, owner, email, telefone });
      setContato(null);
      if (!r.mudou) toast.info("Nada mudou: o contato já estava assim na captação.");
      if (r.precisa_aplicar && r.pode_aplicar && canManage) aplicarAgora = true;
      else if (r.precisa_aplicar) {
        setAviso(AVISO_PECA_GESTOR);
        toast.warning(AVISO_PECA_GESTOR, { duration: 12000 });
      } else if (r.mudou) toast.success("Contato corrigido na captação.");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível corrigir o contato"));
    } finally {
      setBusy(false);
    }
    if (aplicarAgora) await aplicar(s, false);
    else void load();
  };

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="clicksign-gestao">
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
                {s.undelivered && !s.signed && !s.capture_differs && (
                  <p
                    role="alert"
                    data-testid="signer-nao-entregue"
                    className="mt-1 flex items-start gap-1 text-xs text-red-700"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {AVISO_NAO_ENTREGUE}
                  </p>
                )}
                {s.capture_differs && (
                  <p data-testid="signer-falta-aplicar" className="mt-1 text-xs text-amber-800">
                    Corrigido na captação ({s.capture_email}), mas a Clicksign ainda usa o e-mail
                    antigo.{" "}
                    {canManage
                      ? "Use “Aplicar na Clicksign”."
                      : "O gestor precisa aplicar a troca em Signatários."}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SignerStatusBadge signer={s} />
                {canManage && s.editable && s.capture_differs && (
                  <Button
                    size="sm"
                    disabled={busy}
                    data-testid="signer-aplicar"
                    onClick={() => void aplicar(s)}
                  >
                    <Send className="mr-1 h-4 w-4" /> Aplicar na Clicksign
                  </Button>
                )}
                {podeCorrigirContato && !s.signed && ownerNumberOfPapel(s.papel) !== null && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    aria-label={`Corrigir contato ${s.label}`}
                    onClick={() => setContato(s)}
                  >
                    <Mail className="mr-1 h-4 w-4" /> Corrigir contato
                  </Button>
                )}
                {canManage && s.editable && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    aria-label={`Editar ${s.label}`}
                    onClick={() => abrirEdicao(s)}
                  >
                    <Pencil className="mr-1 h-4 w-4" /> Editar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <>
          <p className="text-xs text-muted-foreground">
            Dá para corrigir nome e e-mail de proprietário e testemunha que ainda não assinou.
            Corretor e imobiliária vêm do cadastro: corrija lá.
          </p>
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
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Você acompanha quem já abriu e assinou. Reenviar aviso e trocar o signatário na Clicksign
          ficam com o gestor, o team leader, o jurídico ou o ADM.
          {podeCorrigirContato
            ? " E-mail errado? Use “Corrigir contato”: a captação é corrigida e o gestor é avisado."
            : ""}
        </p>
      )}
      {aviso && (
        <p
          role="status"
          data-testid="aviso-peca-gestor"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {aviso}
        </p>
      )}
      {contato && (
        <ContatoAssinaturaDialog
          label={contato.label}
          atual={contato.email}
          canManage={canManage}
          busy={busy}
          onCancel={() => setContato(null)}
          onSave={(email, telefone) => void salvarContato(email, telefone)}
        />
      )}
      <Dialog open={canManage && !!editing} onOpenChange={(o) => !busy && !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar signatário: {editing?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A Clicksign troca a pessoa no envelope e manda o convite ao e-mail novo. O endereço
              antigo deixa de poder assinar.
              {testMode ? " Modo teste: só e-mails da lista autorizada de teste." : ""}
            </p>
            <div className="space-y-1">
              <Label htmlFor="cs-edit-nome">Nome completo</Label>
              <Input
                id="cs-edit-nome"
                maxLength={200}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cs-edit-email">E-mail correto</Label>
              <Input
                id="cs-edit-email"
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
