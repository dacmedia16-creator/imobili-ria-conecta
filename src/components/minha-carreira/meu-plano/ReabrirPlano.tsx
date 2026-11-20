import { useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import { erroPlano, planoDb } from "@/lib/meu-plano-2027/modulo";
import { MOTIVO_MAX, MOTIVO_MIN, motivoValido } from "@/lib/meu-plano-2027/reabrir";

/**
 * "Reabrir plano" (t_495e4305): gestor/admin da imobiliária e Team Leader da equipe voltam um plano assinado para
 * "em preenchimento". Pede confirmação com motivo. O banco (carreira_plano_reabrir) decide quem pode, zera só as
 * assinaturas (corretor e broker), mantém todos os valores e grava o histórico. Depois, `aoReabrir` recarrega a tela.
 */
export function BotaoReabrirPlano({
  userId,
  nome,
  aoReabrir,
  compacto = false,
}: {
  userId: string;
  nome: string;
  aoReabrir: () => void | Promise<void>;
  compacto?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    if (!motivoValido(motivo)) return;
    setOcupado(true);
    const { error } = await planoDb.rpc("carreira_plano_reabrir", {
      _corretor: userId,
      _ano: ANO_PLANO,
      _motivo: motivo.trim(),
    });
    setOcupado(false);
    if (error) {
      toast.error(erroPlano(error.message));
      return;
    }
    toast.success(`Plano de ${nome} reaberto. Ele volta para "em preenchimento".`);
    setAberto(false);
    setMotivo("");
    await aoReabrir();
  }

  const n = motivo.trim().length;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={compacto ? "h-8 px-2 text-xs" : "w-full"}
        onClick={() => setAberto(true)}
        data-testid="reabrir-plano"
      >
        <RotateCcw className="mr-1 h-4 w-4" aria-hidden /> Reabrir plano
      </Button>
      <Dialog open={aberto} onOpenChange={(o) => !ocupado && setAberto(o)}>
        <DialogContent className="max-w-md" data-testid="reabrir-confirmar">
          <DialogHeader>
            <DialogTitle>Reabrir o plano de {nome}?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  A assinatura do corretor (e a do broker, se houver) será desfeita e o plano volta
                  para <b>em preenchimento</b>. Ele sai da meta e do farol da equipe até ser
                  assinado de novo.
                </p>
                <p>Nenhum valor digitado é apagado. O motivo fica registrado no histórico.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Motivo da reabertura</span>
            <Textarea
              value={motivo}
              maxLength={MOTIVO_MAX}
              rows={3}
              placeholder="Ex.: corrigir o número de transações digitado errado"
              onChange={(e) => setMotivo(e.target.value)}
              data-testid="reabrir-motivo"
            />
            <span className="block text-xs text-muted-foreground">
              {n < MOTIVO_MIN ? `Mínimo de ${MOTIVO_MIN} letras.` : `${n}/${MOTIVO_MAX}`}
            </span>
          </label>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={ocupado} onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={ocupado || !motivoValido(motivo)}
              onClick={() => void confirmar()}
              data-testid="reabrir-ok"
            >
              {ocupado ? "Reabrindo…" : "Reabrir plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
