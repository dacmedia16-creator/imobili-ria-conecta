import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  ativarPush,
  avisosExclusividadeEnabled,
  desativarPush,
  lerPreferencias,
  salvarPreferencias,
  situacaoPush,
  type PreferenciasAviso,
  type SituacaoPush,
} from "@/lib/avisos-exclusividade-module";
import { chavePublicaPush } from "@/lib/avisos-exclusividade.functions";

/**
 * Meu acesso → Avisos de exclusividade (cartão t_c337fc12). O sino fica sempre ligado; o corretor
 * pode desligar o push e o WhatsApp. Também ativa o push NESTE aparelho (precisa de clique).
 * Só aparece com o módulo avisos_exclusividade ligado na imobiliária.
 */
export function AvisosExclusividadePreferencias({ userId }: { userId: string | null }) {
  const [ligado, setLigado] = useState(false);
  const [prefs, setPrefs] = useState<PreferenciasAviso | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [push, setPush] = useState<SituacaoPush | null>(null);
  const [ativando, setAtivando] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelado = false;
    void (async () => {
      if (!(await avisosExclusividadeEnabled())) return;
      const [p, s] = await Promise.all([lerPreferencias(userId), situacaoPush()]);
      if (cancelado) return;
      setLigado(true);
      setPrefs(p);
      setPush(s);
    })();
    return () => {
      cancelado = true;
    };
  }, [userId]);

  if (!ligado || !prefs) return null;

  const alterar = async (k: keyof PreferenciasAviso, v: boolean) => {
    const novo = { ...prefs, [k]: v };
    setSalvando(true);
    try {
      await salvarPreferencias(novo);
      setPrefs(novo);
      toast.success("Preferência salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };

  const ativar = async () => {
    setAtivando(true);
    try {
      const { chave } = await chavePublicaPush();
      if (!chave) throw new Error("Avisos no celular ainda não estão disponíveis. Tente mais tarde.");
      await ativarPush(chave);
      setPush("ativo");
      toast.success("Pronto! Este aparelho vai receber os avisos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ativar os avisos.");
      setPush(await situacaoPush());
    } finally {
      setAtivando(false);
    }
  };
  const desativar = async () => {
    setAtivando(true);
    try {
      await desativarPush();
      setPush(await situacaoPush());
      toast.success("Este aparelho não vai mais receber avisos.");
    } finally {
      setAtivando(false);
    }
  };

  return (
    <Card data-testid="avisos-preferencias">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4" /> Avisos de exclusividade
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Você recebe aviso quando a exclusividade estiver perto de vencer (30 e 15 dias), no dia do
          vencimento, 1 vez por semana depois de vencida e quando a reunião de 45 dias com o
          proprietário estiver pendente. A mensagem leva só o código e o bairro do imóvel.
        </p>
        <div className="flex items-center justify-between rounded-md border p-3">
          <span>
            Sino do ADM MAX <span className="text-xs text-muted-foreground">(sempre ligado)</span>
          </span>
          <Switch aria-label="Sino do ADM MAX (sempre ligado)" checked disabled />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <span>Aviso no celular (push)</span>
          <Switch
            aria-label="Aviso no celular (push)"
            data-testid="pref-push"
            checked={prefs.push}
            disabled={salvando}
            onCheckedChange={(v) => alterar("push", v)}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <span>WhatsApp</span>
          <Switch
            aria-label="WhatsApp"
            data-testid="pref-whatsapp"
            checked={prefs.whatsapp}
            disabled={salvando}
            onCheckedChange={(v) => alterar("whatsapp", v)}
          />
        </div>

        {prefs.push && (
          <div data-testid="push-aparelho" className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="font-medium">Avisos neste aparelho</div>
            {push === "ativo" && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  Ativo neste aparelho
                </span>
                <Button size="sm" variant="ghost" disabled={ativando} onClick={desativar}>
                  Desativar neste aparelho
                </Button>
              </div>
            )}
            {push === "pode_ativar" && (
              <Button size="sm" data-testid="push-ativar" disabled={ativando} onClick={ativar}>
                {ativando ? "Ativando…" : "Ativar avisos no celular"}
              </Button>
            )}
            {push === "bloqueado" && (
              <p className="text-xs text-amber-800">
                As notificações do ADM MAX estão bloqueadas neste navegador. Libere em Configurações
                do navegador → Notificações → app.somosunihub.com.br e volte aqui.
              </p>
            )}
            {(push === "iphone_sem_instalar" || push === "pode_ativar" || push === "ativo") && (
              <div data-testid="push-iphone" className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground">No iPhone:</p>
                <ol className="ml-4 list-decimal space-y-0.5">
                  <li>Abra app.somosunihub.com.br no Safari.</li>
                  <li>Toque em Compartilhar (quadrado com seta) → “Adicionar à Tela de Início”.</li>
                  <li>Abra o ADM MAX pelo ícone novo na tela inicial.</li>
                  <li>Volte em Meu acesso e toque em “Ativar avisos no celular” → Permitir.</li>
                </ol>
                <p className="mt-1">No Android, basta tocar em “Ativar avisos no celular” e Permitir.</p>
              </div>
            )}
            {push === "sem_suporte" && (
              <p className="text-xs text-muted-foreground">
                Este navegador não aceita avisos. Use o Chrome no Android ou o ADM MAX instalado na
                tela inicial do iPhone.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
