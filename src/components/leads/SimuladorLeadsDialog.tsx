import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { ORIGEM_LABEL, ORIGENS_SIMULADOR, type OrigemSimulador } from "@/lib/leads";
import { simularLeads } from "@/lib/leads-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Simulador (P2, gestor/admin): cria leads FICTÍCIOS para testar a distribuição.
 * "OLX/Meta/Site" é só o rótulo de origem — nada é chamado nesses serviços e nada é enviado.
 */
export function SimuladorLeadsDialog({
  open,
  onOpenChange,
  temCaptacoes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  temCaptacoes: boolean;
  onCreated: () => void;
}) {
  const [n, setN] = useState(3);
  const [origem, setOrigem] = useState<OrigemSimulador>("olx");
  const [comCaptacao, setComCaptacao] = useState(false);
  const [busy, setBusy] = useState(false);

  const criar = async () => {
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      toast.error("O simulador cria de 1 a 20 leads por vez.");
      return;
    }
    setBusy(true);
    try {
      await simularLeads(n, origem, comCaptacao);
      toast.success(`${n} lead(s) simulado(s) criados e distribuídos.`);
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível simular."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simular leads</DialogTitle>
          <DialogDescription>
            Cria leads fictícios (e-mail .invalid, sem telefone) e já distribui: com imóvel vai para
            o captador; sem imóvel, para o próximo do rodízio. Nada é enviado a ninguém.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="sim-n">Quantidade (1 a 20)</Label>
            <Input
              id="sim-n"
              type="number"
              min={1}
              max={20}
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="sim-origem">Origem (só rótulo)</Label>
            <select
              id="sim-origem"
              className={SELECT}
              value={origem}
              onChange={(e) => setOrigem(e.target.value as OrigemSimulador)}
            >
              {ORIGENS_SIMULADOR.map((o) => (
                <option key={o} value={o}>
                  {ORIGEM_LABEL[o]}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={comCaptacao}
              disabled={!temCaptacoes}
              onChange={(e) => setComCaptacao(e.target.checked)}
            />
            Ligar a um imóvel captado (sorteado){!temCaptacoes ? " — sem captações" : ""}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={criar} disabled={busy}>
            Criar leads simulados
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
