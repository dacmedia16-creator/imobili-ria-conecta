// Assinatura da VENDA: escolha "Como vai ser assinado?" (Clicksign ou papel) e cartão "Assinatura
// manual (papel)" — maquete aprovada por Denis em 19/10/2026 (t_e6f778ac). Sem regra própria: os
// botões chamam as mesmas ações da tela (changeStatus, upload do assinado, Clicksign) e o banco
// confere papel, organização e etapa de novo.
import { useState } from "react";
import { Ban, FileCheck, FileSignature, PenLine, Send, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { STATUS_AGUARDANDO_MANUAL, TEXTO_ORIENTACAO_PAPEL } from "@/lib/assinatura-manual";

type Modo = "clicksign" | "manual";

/** Cartão "Como vai ser assinado?" (contrato_ok_corretor, org com Clicksign). */
export function EscolhaAssinaturaVenda({
  bloqueado,
  contratoNome,
  alvo = "A venda",
  ultimoPasso = "clique em “Marcar contrato assinado”",
  tituloClicksign = "Pela Clicksign (sistema)",
  tituloManual = "Manual – papel",
  onClicksign,
  onManual,
}: {
  /** Títulos das opções (o atalho do gestor usa "Assinatura digital (Clicksign)" / "Manual (papel)"). */
  tituloClicksign?: string;
  tituloManual?: string;
  /** Jurídico travou a assinatura (contrato_libera_assinatura = false). */
  bloqueado: boolean;
  contratoNome?: string | null;
  /** "A venda" (padrão) ou "A captação". */
  alvo?: string;
  /** Final do passo 3 da confirmação do papel. */
  ultimoPasso?: string;
  onClicksign: () => void;
  onManual: () => Promise<void> | void;
}) {
  const [modo, setModo] = useState<Modo>("clicksign");
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const opcao = (m: Modo, titulo: string, texto: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={modo === m}
      data-testid={`escolha-${m}`}
      onClick={() => setModo(m)}
      className={cn(
        "flex flex-1 items-start gap-2 rounded-md border p-3 text-left text-sm transition-colors",
        modo === m ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0 rounded-full border",
          modo === m ? "border-[5px] border-primary" : "border-muted-foreground/40",
        )}
      />
      <span>
        <span className="block font-medium">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{texto}</span>
      </span>
    </button>
  );
  return (
    <div
      className="space-y-3 rounded-md border border-l-4 border-l-primary p-3"
      data-testid="escolha-assinatura"
    >
      <div>
        <p className="text-sm font-semibold">Como vai ser assinado?</p>
        <p className="text-xs text-muted-foreground">
          Escolha uma opção. Dá para trocar depois, sem enviar duas vezes.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup">
        {opcao(
          "clicksign",
          tituloClicksign,
          "Cada pessoa recebe o link por e-mail e assina pelo celular ou computador. O assinado volta sozinho para o sistema.",
        )}
        {opcao("manual", tituloManual, TEXTO_ORIENTACAO_PAPEL)}
      </div>
      <Button
        disabled={bloqueado || busy}
        title={bloqueado ? "Jurídico marcou que ainda não pode ir para assinatura" : undefined}
        onClick={() => (modo === "clicksign" ? onClicksign() : setConfirmar(true))}
      >
        <Send className="mr-2 h-4 w-4" />
        {modo === "clicksign" ? "Continuar com a Clicksign" : "Continuar com assinatura manual"}
      </Button>
      <AlertDialog open={confirmar} onOpenChange={(o) => !busy && setConfirmar(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar assinatura manual (papel)?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {alvo} vai para <b>{STATUS_AGUARDANDO_MANUAL}</b>. Ninguém recebe link da
                  Clicksign.
                </p>
                <ol className="list-inside list-decimal space-y-1">
                  <li>
                    Imprima o contrato
                    {contratoNome ? ` (${contratoNome})` : " (versão mais recente do jurídico)"}.
                  </li>
                  <li>Colete as assinaturas.</li>
                  <li>
                    <b>Suba o contrato assinado aqui no mesmo dia</b> e {ultimoPasso}.
                  </li>
                </ol>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await onManual();
                  setConfirmar(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirmar: assinatura manual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Cartão "Assinatura manual (papel)" em aguardando_assinatura sem envelope ativo. */
export function AssinaturaManualCard({
  podeOperar,
  podeMarcar,
  podeDevolver,
  podeTrocarParaClicksign,
  assinadoNome,
  onSubir,
  onMarcar,
  onTrocarParaClicksign,
  onDevolver,
}: {
  podeOperar: boolean;
  /** Gestor/TL e ADM. O jurídico só sobe/substitui o assinado (Denis 19/10, t_6efe0960). */
  podeMarcar: boolean;
  podeDevolver: boolean;
  podeTrocarParaClicksign: boolean;
  /** Último contrato assinado anexado (nome do arquivo) ou null. */
  assinadoNome: string | null;
  onSubir: () => void;
  onMarcar: () => void;
  onTrocarParaClicksign: () => void;
  onDevolver: () => void;
}) {
  return (
    <div
      className="space-y-3 rounded-md border border-l-4 border-l-violet-500 p-3"
      data-testid="assinatura-manual"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <FileSignature className="h-4 w-4 text-violet-600" /> Assinatura manual (papel)
        </p>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200">
          {STATUS_AGUARDANDO_MANUAL}
        </span>
      </div>
      <p className="text-sm">{TEXTO_ORIENTACAO_PAPEL}</p>
      {assinadoNome ? (
        <p className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          Contrato assinado anexado: <b>{assinadoNome}</b>.{" "}
          {podeMarcar
            ? "Confira o arquivo e marque como assinado."
            : "O gestor, team leader ou ADM confere e marca como assinado."}
        </p>
      ) : (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Nenhum contrato assinado anexado ainda.
        </p>
      )}
      {podeOperar ? (
        <div className="flex flex-wrap gap-2">
          <Button variant={assinadoNome ? "outline" : "default"} onClick={onSubir}>
            <Upload className="mr-2 h-4 w-4" />
            {assinadoNome ? "Substituir contrato assinado" : "Subir contrato assinado"}
          </Button>
          {podeMarcar && (
            <Button
              variant={assinadoNome ? "default" : "secondary"}
              onClick={onMarcar}
              disabled={!assinadoNome}
            >
              <FileCheck className="mr-2 h-4 w-4" />
              Marcar contrato assinado
            </Button>
          )}
          {podeTrocarParaClicksign && (
            <Button variant="outline" onClick={onTrocarParaClicksign}>
              <PenLine className="mr-2 h-4 w-4" />
              Trocar para Clicksign
            </Button>
          )}
          {podeDevolver && (
            <Button variant="outline" onClick={onDevolver}>
              <XCircle className="mr-2 h-4 w-4" />
              Devolver ao jurídico
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Gestor, team leader, jurídico ou ADM sobem o contrato assinado; gestor, team leader ou ADM
          marcam a venda como assinada.
        </p>
      )}
    </div>
  );
}

/** Botão "Cancelar Clicksign e assinar no papel" (envelope em assinatura), com confirmação. */
export function TrocarParaPapelButton({
  faltam,
  total,
  alvo = "a venda",
  onConfirm,
}: {
  /** Quantos ainda não assinaram (null = desconhecido). */
  faltam?: number | null;
  total?: number | null;
  /** "a venda" (padrão) ou "a captação". */
  alvo?: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const jaAssinaram =
    typeof faltam === "number" && typeof total === "number" ? Math.max(total - faltam, 0) : null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="trocar-papel">
        <Ban className="mr-1 h-4 w-4" /> Cancelar Clicksign e assinar no papel
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a Clicksign e assinar no papel?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {jaAssinaram !== null && jaAssinaram > 0 && (
                  <p>
                    <b>
                      {jaAssinaram} de {total}{" "}
                      {jaAssinaram === 1 ? "pessoa já assinou" : "pessoas já assinaram"} na
                      Clicksign.
                    </b>
                  </p>
                )}
                <p>Ao confirmar:</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>
                    o envelope na Clicksign é cancelado (as assinaturas eletrônicas feitas não valem
                    para o papel);
                  </li>
                  <li>
                    {alvo} fica em <b>{STATUS_AGUARDANDO_MANUAL}</b>;
                  </li>
                  <li>suba o contrato assinado no papel no mesmo dia.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirmar troca para manual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
