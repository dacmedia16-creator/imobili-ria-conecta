import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { urlRetornoZionTalk } from "@/lib/leads";
import {
  lerIaRetornoConfig,
  salvarModeloIa,
  tokenRetornoIa,
  type IaRetornoConfig,
} from "@/lib/leads-db";
import { MODELO_RE, MODELOS_SUGERIDOS } from "@/lib/leads-ia-modelo";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Card t_6f688b4b. Gestor/admin: modelo que ajuda a IA a entender o cliente (Gemini ou OpenRouter).
 * Só admin: link do retorno do WhatsApp (ZionTalk -> ADM). O banco confere os papéis.
 */
export function LeadsIaRetornoConfig({ open, admin }: { open: boolean; admin: boolean }) {
  const [c, setC] = useState<IaRetornoConfig | null>(null);
  const [modelo, setModelo] = useState("");
  const [url, setUrl] = useState(""); // só na memória desta tela, logo depois de gerar
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setUrl("");
      return;
    }
    lerIaRetornoConfig()
      .then((x) => {
        setC(x);
        setModelo(x.ia_modelo ?? "");
      })
      .catch(() => setC(null));
  }, [open]);

  if (!c) return null;

  const salvarModelo = async () => {
    const m = modelo.trim().toLowerCase();
    if (c.ia_modelo_provedor === "openrouter" && !MODELO_RE.test(m))
      return void toast.error('Escreva o modelo no formato "empresa/modelo", ex.: anthropic/claude-haiku-5.5.');
    setBusy(true);
    try {
      await salvarModeloIa(c.ia_modelo_provedor, c.ia_modelo_provedor === "openrouter" ? m : null);
      setC({ ...c, ia_modelo: c.ia_modelo_provedor === "openrouter" ? m : null });
      toast.success("Modelo salvo.");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar o modelo."));
    } finally {
      setBusy(false);
    }
  };

  const gerar = async () => {
    if (
      c.ia_retorno_token_em &&
      !window.confirm("Gerar um link novo desliga o link atual na hora. Você vai precisar colar o novo no painel da ZionTalk. Continuar?")
    )
      return;
    setBusy(true);
    try {
      const token = await tokenRetornoIa("gerar");
      if (!token) throw new Error("Não foi possível gerar o link.");
      setUrl(urlRetornoZionTalk(window.location.origin, token));
      setC({ ...c, ia_retorno_token_em: new Date().toISOString() });
      toast.success("Link novo gerado. Copie e cole no painel da ZionTalk.");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível gerar o link."));
    } finally {
      setBusy(false);
    }
  };

  const desligar = async () => {
    if (!window.confirm("Desligar o retorno? A IA deixa de responder pelo WhatsApp até gerar outro link.")) return;
    setBusy(true);
    try {
      await tokenRetornoIa("desligar");
      setUrl("");
      setC({ ...c, ia_retorno_token_em: null });
      toast.success("Retorno do WhatsApp desligado.");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível desligar."));
    } finally {
      setBusy(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  };

  return (
    <section className="space-y-2 rounded-lg border p-3 text-sm">
      <h3 className="font-medium">IA: modelo e WhatsApp</h3>
      <div className="grid gap-1">
        <Label htmlFor="cfg-ia-provedor">Modelo que ajuda a IA a entender o cliente</Label>
        <select
          id="cfg-ia-provedor"
          className={SELECT}
          value={c.ia_modelo_provedor}
          onChange={(e) => setC({ ...c, ia_modelo_provedor: e.target.value as IaRetornoConfig["ia_modelo_provedor"] })}
        >
          <option value="gemini">Gemini (padrão)</option>
          <option value="openrouter">OpenRouter (escolher modelo)</option>
        </select>
        {c.ia_modelo_provedor === "openrouter" && (
          <>
            <Input
              id="cfg-ia-modelo"
              list="cfg-ia-modelos"
              maxLength={120}
              placeholder="anthropic/claude-haiku-5.5"
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
            />
            <datalist id="cfg-ia-modelos">
              {MODELOS_SUGERIDOS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          O modelo só interpreta as respostas do cliente. As mensagens enviadas são sempre os textos fixos da IA. Se o
          OpenRouter não estiver configurado ou falhar, a IA usa o Gemini e, depois, as regras simples.
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void salvarModelo()}>
          Salvar modelo
        </Button>
      </div>

      {admin && (
        <div className="grid gap-1 border-t pt-2">
          <p className="text-xs text-muted-foreground">
            Para a IA responder no WhatsApp, cole este link no painel da ZionTalk: Canais → canal da IA → Webhook de
            mensagens recebidas. A IA só responde aos números liberados pela plataforma.
          </p>
          <p className="text-xs">
            {c.ia_retorno_token_em
              ? `Retorno ligado (link gerado em ${new Date(c.ia_retorno_token_em).toLocaleString("pt-BR")}).`
              : "Retorno desligado: nenhum link ativo."}
          </p>
          {url && (
            <div className="grid gap-1">
              <Label htmlFor="cfg-ia-retorno">Link para a ZionTalk</Label>
              <div className="flex gap-2">
                <Input id="cfg-ia-retorno" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" variant="outline" onClick={() => void copiar()}>
                  Copiar
                </Button>
              </div>
              <p className="text-xs text-amber-700">
                Guarde só no painel da ZionTalk: por segurança, este link aparece só agora. Se perder, gere outro.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void gerar()}>
              {c.ia_retorno_token_em ? "Gerar token novo" : "Gerar link"}
            </Button>
            {c.ia_retorno_token_em && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void desligar()}>
                Desligar retorno
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
