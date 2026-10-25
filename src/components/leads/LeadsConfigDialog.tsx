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
import { LeadsIaConfig } from "@/components/leads/LeadsIaConfig";
import { errorMessage } from "@/lib/errors";
import { DISTRIBUICAO_LABEL, urlGrupoOlx, validarConfig, type LeadConfig } from "@/lib/leads";
import { configurarFormulario, salvarConfig, tokenGrupoOlx } from "@/lib/leads-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Prazos da distribuição e formulário público de teste (só administrador) e link do Grupo ZAP
 * (gestor ou administrador). O banco confere os papéis.
 */
export function LeadsConfigDialog({
  open,
  onOpenChange,
  config,
  onSaved,
  admin,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  config: LeadConfig;
  onSaved: () => void;
  admin: boolean;
}) {
  const [c, setC] = useState<LeadConfig>(config);
  const [busy, setBusy] = useState(false);
  // URL com o token novo: só existe na memória desta tela, logo depois de gerar.
  const [urlZap, setUrlZap] = useState("");
  useEffect(() => {
    if (open) setC(config);
    else setUrlZap("");
  }, [open, config]);

  const gerarZap = async () => {
    if (
      c.grupo_olx_token_em &&
      !window.confirm(
        "Gerar um link novo desliga o link atual na hora. Você vai precisar colar o link novo no Canal Pro. Continuar?",
      )
    )
      return;
    setBusy(true);
    try {
      const token = await tokenGrupoOlx("gerar");
      if (!token) throw new Error("Não foi possível gerar o link.");
      setUrlZap(urlGrupoOlx(window.location.origin, token));
      setC((x) => ({ ...x, grupo_olx_token_em: new Date().toISOString() }));
      toast.success("Link novo gerado. Copie e cole no Canal Pro.");
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível gerar o link."));
    } finally {
      setBusy(false);
    }
  };

  const desligarZap = async () => {
    if (
      !window.confirm("Desligar o recebimento? O Canal Pro deixa de conseguir entregar leads aqui.")
    )
      return;
    setBusy(true);
    try {
      await tokenGrupoOlx("desligar");
      setUrlZap("");
      setC((x) => ({ ...x, grupo_olx_token_em: null }));
      toast.success("Recebimento do Grupo ZAP desligado.");
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível desligar."));
    } finally {
      setBusy(false);
    }
  };

  const copiarZap = async () => {
    try {
      await navigator.clipboard.writeText(urlZap);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  };

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
            Entrada de leads do Grupo ZAP e prazos da distribuição automática. Avisos ao corretor só
            no sino do ADM.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <section className="space-y-2 rounded-lg border p-3 text-sm">
            <h3 className="font-medium">Grupo ZAP (ZAP Imóveis, Viva Real e OLX)</h3>
            <p className="text-xs text-muted-foreground">
              No Canal Pro: Configurações → Integrações → Leads → “Receber leads no CRM”. Cole o
              link abaixo no campo da URL. Cada lead entra aqui e vai para o captador do imóvel
              (pelo código do anúncio) ou para o rodízio.
            </p>
            <p className="text-xs">
              {c.grupo_olx_token_em
                ? `Recebimento ligado (link gerado em ${new Date(c.grupo_olx_token_em).toLocaleString("pt-BR")}).`
                : "Recebimento desligado: nenhum link ativo."}
            </p>
            {urlZap && (
              <div className="grid gap-1">
                <Label htmlFor="cfg-zap">Link para o Canal Pro</Label>
                <div className="flex gap-2">
                  <Input
                    id="cfg-zap"
                    readOnly
                    value={urlZap}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button size="sm" variant="outline" onClick={() => void copiarZap()}>
                    Copiar
                  </Button>
                </div>
                <p className="text-xs text-amber-700">
                  Guarde só no Canal Pro: por segurança, este link aparece só agora. Se perder, gere
                  outro.
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void gerarZap()}>
                {c.grupo_olx_token_em ? "Gerar link novo" : "Gerar link"}
              </Button>
              {c.grupo_olx_token_em && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void desligarZap()}
                >
                  Desligar recebimento
                </Button>
              )}
            </div>
          </section>

          {admin && (
            <>
              <div className="grid gap-1">
                <Label htmlFor="cfg-dist">Distribuição</Label>
                <select
                  id="cfg-dist"
                  className={SELECT}
                  value={c.distribuicao}
                  onChange={(e) =>
                    setC((x) => ({
                      ...x,
                      distribuicao: e.target.value as LeadConfig["distribuicao"],
                    }))
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
                  Página sem login com autorização LGPD e proteção anti-spam. Quem preencher vira
                  lead e entra na distribuição. Use só para teste.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void alternarForm()}
                >
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
            </>
          )}

          {admin && <LeadsIaConfig open={open} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Fechar
          </Button>
          {admin && (
            <Button onClick={salvar} disabled={busy}>
              Salvar prazos
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
