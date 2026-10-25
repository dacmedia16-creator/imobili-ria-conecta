import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { previaPrimeiraMensagem, validarIaConfig, type IaConfig } from "@/lib/leads-ia";
import { lerIaConfig, salvarIaConfig } from "@/lib/leads-db";

/** IA de atendimento: ligar/desligar, nome e boas-vindas (só administrador; o banco confere). */
export function LeadsIaConfig({ open }: { open: boolean }) {
  const [c, setC] = useState<IaConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    lerIaConfig()
      .then(setC)
      .catch(() => setC(null));
  }, [open]);

  if (!c) return null;

  const salvar = async () => {
    const erro = validarIaConfig(c);
    if (erro) return void toast.error(erro);
    setBusy(true);
    try {
      await salvarIaConfig(c);
      toast.success(c.ia_ativa ? "IA de atendimento ligada." : "IA de atendimento salva (desligada).");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar a IA."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">IA de atendimento</h3>
        <div className="flex items-center gap-2">
          <Label htmlFor="cfg-ia-ativa" className="text-xs">
            {c.ia_ativa ? "Ligada" : "Desligada"}
          </Label>
          <Switch
            id="cfg-ia-ativa"
            checked={c.ia_ativa}
            onCheckedChange={(v) => setC({ ...c, ia_ativa: v })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Ligada, a IA prepara a 1ª mensagem de todo lead novo e faz a qualificação (comprar ou alugar, prazo,
        pagamento, faixa de valor e região). Ela não informa preço nem condição e passa ao corretor no fim,
        quando o cliente pede uma pessoa ou em assunto sensível.{" "}
        {c.ia_canal === "teste"
          ? "Modo teste: nenhuma mensagem é enviada ao cliente. Teste a conversa no detalhe do lead."
          : "Canal WhatsApp (ZionTalk) ligado pela plataforma."}
      </p>
      <div className="grid gap-1">
        <Label htmlFor="cfg-ia-nome">Nome com que a IA se apresenta</Label>
        <Input
          id="cfg-ia-nome"
          maxLength={40}
          value={c.ia_nome}
          onChange={(e) => setC({ ...c, ia_nome: e.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="cfg-ia-boas">Texto de boas-vindas (opcional)</Label>
        <Textarea
          id="cfg-ia-boas"
          maxLength={400}
          value={c.ia_boas_vindas ?? ""}
          placeholder="Recebi seu contato"
          onChange={(e) => setC({ ...c, ia_boas_vindas: e.target.value })}
        />
      </div>
      <p className="rounded-md bg-muted/50 p-2 text-xs">
        <span className="font-medium">Prévia: </span>
        {previaPrimeiraMensagem(c, "sua imobiliária", "Maria Silva", "apartamento no bairro Centro")}
      </p>
      <Button size="sm" disabled={busy} onClick={() => void salvar()}>
        Salvar IA
      </Button>
    </section>
  );
}
