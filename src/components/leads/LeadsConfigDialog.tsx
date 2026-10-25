import { useEffect, useState } from "react";
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
import { DISTRIBUICAO_LABEL, validarConfig, type LeadConfig } from "@/lib/leads";
import { configurarFormulario, salvarConfig } from "@/lib/leads-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Prazos da distribuição e formulário público de teste (só administrador; o banco confere). */
export function LeadsConfigDialog({
  open,
  onOpenChange,
  config,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  config: LeadConfig;
  onSaved: () => void;
}) {
  const [c, setC] = useState<LeadConfig>(config);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setC(config);
  }, [open, config]);

  const num = (k: keyof LeadConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setC((x) => ({ ...x, [k]: Number(e.target.value) }));

  const salvar = async () => {
    const erro = validarConfig(c);
    if (erro) return void toast.error(erro);
    setBusy(true);
    try {
      await salvarConfig(c);
      toast.success("Configuração salva.");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar."));
    } finally {
      setBusy(false);
    }
  };

  const alternarForm = async () => {
    setBusy(true);
    try {
      const token = await configurarFormulario(!c.form_publico_ativo);
      setC((x) => ({ ...x, form_publico_ativo: !x.form_publico_ativo, form_token: token }));
      toast.success(c.form_publico_ativo ? "Formulário desligado." : "Formulário ligado.");
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível alterar o formulário."));
    } finally {
      setBusy(false);
    }
  };

  const link =
    c.form_token && typeof window !== "undefined"
      ? `${window.location.origin}/lead-form/${c.form_token}`
      : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configuração dos leads</DialogTitle>
          <DialogDescription>
            Prazos da distribuição automática. Avisos ao corretor só no sino do ADM.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="cfg-dist">Distribuição</Label>
            <select
              id="cfg-dist"
              className={SELECT}
              value={c.distribuicao}
              onChange={(e) =>
                setC((x) => ({ ...x, distribuicao: e.target.value as LeadConfig["distribuicao"] }))
              }
            >
              {Object.entries(DISTRIBUICAO_LABEL).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="cfg-aceite">Prazo para aceitar (minutos; 1440 = 24 h)</Label>
            <Input
              id="cfg-aceite"
              type="number"
              min={1}
              max={1440}
              value={c.prazo_aceite_min}
              onChange={num("prazo_aceite_min")}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="cfg-d1">Dias para a 1ª interação depois do aceite</Label>
            <Input
              id="cfg-d1"
              type="number"
              min={1}
              max={90}
              value={c.prazo_primeira_interacao_dias}
              onChange={num("prazo_primeira_interacao_dias")}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="cfg-d30">Dias sem interação para voltar ao banco</Label>
            <Input
              id="cfg-d30"
              type="number"
              min={1}
              max={365}
              value={c.prazo_sem_interacao_dias}
              onChange={num("prazo_sem_interacao_dias")}
            />
          </div>

          <section className="space-y-2 rounded-lg border p-3 text-sm">
            <h3 className="font-medium">Formulário público de teste</h3>
            <p className="text-xs text-muted-foreground">
              Página sem login com autorização LGPD e proteção anti-spam. Quem preencher vira lead e
              entra na distribuição. Use só para teste.
            </p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void alternarForm()}>
              {c.form_publico_ativo ? "Desligar formulário" : "Ligar formulário"}
            </Button>
            {c.form_publico_ativo && link && (
              <div className="grid gap-1">
                <Label htmlFor="cfg-link">Link</Label>
                <Input
                  id="cfg-link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <p className="text-xs text-muted-foreground">
                  Para ligar a um imóvel, acrescente ?imovel=&lt;id da captação&gt; ao link.
                </p>
              </div>
            )}
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Fechar
          </Button>
          <Button onClick={salvar} disabled={busy}>
            Salvar prazos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
