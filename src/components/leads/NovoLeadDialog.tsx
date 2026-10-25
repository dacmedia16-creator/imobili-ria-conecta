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
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import {
  ORIGEM_LABEL,
  ORIGENS,
  validarNovoLead,
  type CapturaOpcao,
  type NovoLeadForm,
  type Origem,
  type Pessoa,
} from "@/lib/leads";
import { criarLead } from "@/lib/leads-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const VAZIO: NovoLeadForm = {
  nome: "",
  telefone: "",
  email: "",
  origem: "manual",
  mensagem: "",
  captureId: "",
  responsavelId: "",
};

/** Cadastro manual de lead (gestor/admin). Nenhuma mensagem é enviada ao cliente. */
export function NovoLeadDialog({
  open,
  onOpenChange,
  pessoas,
  capturas,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pessoas: Pessoa[];
  capturas: CapturaOpcao[];
  onCreated: () => void;
}) {
  const [f, setF] = useState<NovoLeadForm>(VAZIO);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NovoLeadForm>(k: K, v: NovoLeadForm[K]) =>
    setF((x) => ({ ...x, [k]: v }));

  const salvar = async () => {
    const erro = validarNovoLead(f);
    if (erro) {
      toast.error(erro);
      return;
    }
    setBusy(true);
    try {
      await criarLead(f);
      toast.success("Lead cadastrado.");
      setF(VAZIO);
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível cadastrar."));
    } finally {
      setBusy(false);
    }
  };

  // P3: com "Distribuição automática" o banco entrega ao captador do imóvel (ou ao rodízio).
  const escolherCaptura = (id: string) => setF((x) => ({ ...x, captureId: id }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>
            Cadastro manual. Nada é enviado ao cliente. Telefone ou e-mail é obrigatório.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="lead-nome">Nome</Label>
            <Input
              id="lead-nome"
              value={f.nome}
              maxLength={120}
              onChange={(e) => set("nome", e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="lead-tel">Telefone</Label>
              <Input
                id="lead-tel"
                inputMode="tel"
                value={f.telefone}
                onChange={(e) => set("telefone", e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="lead-email">E-mail</Label>
              <Input
                id="lead-email"
                type="email"
                value={f.email}
                maxLength={160}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="lead-origem">Origem</Label>
            <select
              id="lead-origem"
              className={SELECT}
              value={f.origem}
              onChange={(e) => set("origem", e.target.value as Origem)}
            >
              {ORIGENS.map((o) => (
                <option key={o} value={o}>
                  {ORIGEM_LABEL[o]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="lead-imovel">Imóvel de interesse (captação)</Label>
            <select
              id="lead-imovel"
              className={SELECT}
              value={f.captureId}
              onChange={(e) => escolherCaptura(e.target.value)}
            >
              <option value="">Sem imóvel</option>
              {capturas.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.tipo, c.bairro].filter(Boolean).join(" · ") || "Captação"} —{" "}
                  {c.captador ?? "captador"}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="lead-resp">Responsável</Label>
            <select
              id="lead-resp"
              className={SELECT}
              value={f.responsavelId}
              onChange={(e) => set("responsavelId", e.target.value)}
            >
              <option value="">Distribuição automática (captador do imóvel ou rodízio)</option>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="lead-msg">Mensagem do cliente</Label>
            <Textarea
              id="lead-msg"
              value={f.mensagem}
              maxLength={4000}
              onChange={(e) => set("mensagem", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={busy}>
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
