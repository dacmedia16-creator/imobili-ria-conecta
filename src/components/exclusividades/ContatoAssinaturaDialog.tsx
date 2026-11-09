import { useState } from "react";
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
import { contatoErrors } from "@/lib/exclusive-clicksign";

/**
 * "Corrigir contato" do proprietário numa captação já enviada (t_867f464c): e-mail (obrigatório) e
 * telefone (opcional). Grava na captação; quem gerencia o envelope aplica na Clicksign em seguida,
 * quem não gerencia vê o aviso de que o gestor foi avisado.
 */
export function ContatoAssinaturaDialog({
  label,
  atual,
  canManage,
  busy,
  onCancel,
  onSave,
}: {
  label: string;
  /** E-mail atual mascarado (só como dica). */
  atual: string;
  canManage: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (email: string, telefone: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const errors = contatoErrors(email, telefone);
  return (
    <Dialog open onOpenChange={(o) => !busy && !o && onCancel()}>
      <DialogContent className="max-w-md" data-testid="contato-assinatura-dialog">
        <DialogHeader>
          <DialogTitle>Corrigir contato: {label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Grava na captação e troca o e-mail na Clicksign: o convite vai para o e-mail novo e o antigo deixa de poder assinar."
              : "O documento já foi enviado. Grava na captação e avisa o gestor, que aplica a troca na Clicksign em Signatários."}
          </p>
          <div className="space-y-1">
            <Label htmlFor="ct-email">E-mail correto</Label>
            <Input
              id="ct-email"
              type="email"
              maxLength={200}
              placeholder={atual ? `atual: ${atual}` : ""}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-tel">Telefone (opcional)</Label>
            <Input
              id="ct-tel"
              inputMode="tel"
              maxLength={30}
              placeholder="(15) 99999-9999"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>
          {errors.length > 0 && (email || telefone) && (
            <ul className="list-disc rounded-md border border-amber-300 bg-amber-50 py-2 pl-6 pr-3 text-sm text-amber-900">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={busy || errors.length > 0} onClick={() => onSave(email, telefone)}>
            {busy
              ? "Salvando…"
              : canManage
                ? "Salvar e enviar convite"
                : "Salvar e avisar o gestor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
