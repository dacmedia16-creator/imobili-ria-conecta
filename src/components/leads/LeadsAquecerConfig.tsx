import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/errors";
import { urlRetornoAquecer } from "@/lib/leads-aquecer";
import {
  lerAquecerConfig,
  lerAquecerPainel,
  lerAquecerPrevia,
  pausarAquecer,
  retomarChip,
  salvarAquecer,
  tokenRetornoAquecer,
  tokenRetornoChip,
  validarAquecer,
  type AquecerChip,
  type AquecerConfig,
  type AquecerPainel,
} from "@/lib/leads-aquecer-db";

/**
 * t_a2cae373: "Aquecer leads parados". Gestor e administrador veem o painel; só o administrador liga, ajusta, pausa e
 * gera o link do retorno. Nasce desligado. Separado da IA de atendimento (chip próprio, decisão de Denis 15/11).
 */
export function LeadsAquecerConfig({ open, admin }: { open: boolean; admin: boolean }) {
  const [c, setC] = useState<AquecerConfig | null>(null);
  const [p, setP] = useState<AquecerPainel | null>(null);
  const [previa, setPrevia] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  // t_879234c7: link recém-gerado de um chip (mostrado uma vez, só nesta tela).
  const [urlChip, setUrlChip] = useState<{ id: string; url: string } | null>(null);

  const carregar = useCallback(async () => {
    // Qualquer falha (sem conexão, migration ausente, sem permissão) = o bloco não aparece.
    const [cfg, painel, pv] = await Promise.all([
      lerAquecerConfig().catch(() => null),
      lerAquecerPainel(30).catch(() => null),
      lerAquecerPrevia().catch(() => [] as string[]),
    ]);
    setC(cfg);
    setP(painel);
    setPrevia(pv);
  }, []);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setUrlChip(null);
      return;
    }
    void carregar();
  }, [open, carregar]);

  if (!c) return null;

  const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));
  const campo = (k: keyof AquecerConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setC({ ...c, [k]: num(e.target.value) });

  const salvar = async () => {
    const erro = validarAquecer(c);
    if (erro) return void toast.error(erro);
    setBusy(true);
    try {
      await salvarAquecer(c);
      toast.success(c.ativo ? "Aquecimento salvo e ligado." : "Aquecimento salvo (desligado).");
      await carregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar o aquecimento."));
    } finally {
      setBusy(false);
    }
  };

  const pausar = async (v: boolean) => {
    if (
      v &&
      !window.confirm("Pausar o aquecimento agora? Nenhuma mensagem nova sai até você retomar.")
    )
      return;
    setBusy(true);
    try {
      await pausarAquecer(v);
      toast.success(
        v ? "Aquecimento pausado." : "Aquecimento retomado. O limite recomeça do início da rampa.",
      );
      await carregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível alterar a pausa."));
    } finally {
      setBusy(false);
    }
  };

  const gerar = async () => {
    if (c.retorno_em && !window.confirm("Gerar um link novo desliga o link atual. Continuar?"))
      return;
    setBusy(true);
    try {
      const t = await tokenRetornoAquecer("gerar");
      if (!t) throw new Error("Não foi possível gerar o link.");
      setUrl(urlRetornoAquecer(window.location.origin, t));
      setC({ ...c, retorno_em: new Date().toISOString() });
      toast.success("Link gerado. Cole no painel da ZionTalk, no canal do chip do aquecimento.");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível gerar o link."));
    } finally {
      setBusy(false);
    }
  };

  const gerarChip = async (k: AquecerChip) => {
    if (
      k.retorno_em &&
      !window.confirm(
        `Gerar um link novo para o chip ${k.chip} desliga o link atual dele. Continuar?`,
      )
    )
      return;
    setBusy(true);
    try {
      const t = await tokenRetornoChip(k.id, "gerar");
      if (!t) throw new Error("Não foi possível gerar o link.");
      setUrlChip({ id: k.id, url: urlRetornoAquecer(window.location.origin, t) });
      toast.success(`Link gerado. Cole no painel da ZionTalk, no canal do chip ${k.chip}.`);
      await carregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível gerar o link."));
    } finally {
      setBusy(false);
    }
  };

  const retomar = async (k: AquecerChip) => {
    setBusy(true);
    try {
      await retomarChip(k.id);
      toast.success(`Chip ${k.chip} retomado. O limite dele recomeça do início da rampa.`);
      await carregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível retomar o chip."));
    } finally {
      setBusy(false);
    }
  };

  const chips = c.chips ?? [];
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("pt-BR");

  return (
    <section className="space-y-2 rounded-lg border p-3 text-sm" aria-label="Aquecer leads parados">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Aquecer leads parados</h3>
        <div className="flex items-center gap-2">
          <Label htmlFor="cfg-aq-ativo" className="text-xs">
            {c.ativo ? "Ligado" : "Desligado"}
          </Label>
          <Switch
            id="cfg-aq-ativo"
            checked={c.ativo}
            disabled={!admin}
            onCheckedChange={(v) => setC({ ...c, ativo: v })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A {c.ia_nome} chama, aos poucos, quem já falou com a imobiliária e está sem conversa há{" "}
        {Number.isFinite(c.dias) ? c.dias : "N"} dias ou mais, para saber se ainda procura imóvel.
        Se responder que sim, ela retoma a conversa normal e passa ao corretor. Se disser que não,
        registra o motivo e encerra. Quem pede SAIR nunca mais recebe. Sem resposta: 1 lembrete e o
        lead fica frio. Sai por um chip próprio, separado do chip de atendimento; sem o chip
        configurado pela plataforma, funciona em <span className="font-medium">modo teste</span>{" "}
        (nada é enviado).
      </p>
      {!c.ia_ativa && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          A IA de atendimento está desligada: o aquecimento não roda.
        </p>
      )}
      {c.pausado_em && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
          role="status"
        >
          <span>
            Pausado em {new Date(c.pausado_em).toLocaleString("pt-BR")}:{" "}
            {c.pausa_motivo ?? "sem motivo"}.
          </span>
          {admin && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void pausar(false)}>
              Retomar
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="cfg-aq-dias" className="text-xs">
            Dias sem conversa
          </Label>
          <Input
            id="cfg-aq-dias"
            type="number"
            min={7}
            max={365}
            disabled={!admin}
            value={Number.isFinite(c.dias) ? c.dias : ""}
            onChange={campo("dias")}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cfg-aq-limite" className="text-xs">
            Limite por dia (chip)
          </Label>
          <Input
            id="cfg-aq-limite"
            type="number"
            min={1}
            max={50}
            disabled={!admin}
            value={Number.isFinite(c.limite_dia) ? c.limite_dia : ""}
            onChange={campo("limite_dia")}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cfg-aq-lembrete" className="text-xs">
            Lembrete após (dias)
          </Label>
          <Input
            id="cfg-aq-lembrete"
            type="number"
            min={1}
            max={14}
            disabled={!admin}
            value={Number.isFinite(c.lembrete_dias) ? c.lembrete_dias : ""}
            onChange={campo("lembrete_dias")}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cfg-aq-rampa" className="text-xs">
            Rampa: começa com
          </Label>
          <Input
            id="cfg-aq-rampa"
            type="number"
            min={1}
            max={50}
            disabled={!admin}
            value={Number.isFinite(c.rampa_inicio) ? c.rampa_inicio : ""}
            onChange={campo("rampa_inicio")}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cfg-aq-passo" className="text-xs">
            Rampa: +por dia
          </Label>
          <Input
            id="cfg-aq-passo"
            type="number"
            min={0}
            max={20}
            disabled={!admin}
            value={Number.isFinite(c.rampa_passo) ? c.rampa_passo : ""}
            onChange={campo("rampa_passo")}
          />
        </div>
        <div className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Hoje</span>
          <span className="font-medium" data-testid="aq-hoje">
            {c.enviados_hoje} de {c.limite_hoje} envios
          </span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Intervalo variado de 5 a 15 min entre envios, só seg. a sáb. das 9h às 19h (domingo segue a
        opção de domingo da IA). Freio automático: erro no canal do chip ou muitas falhas/pedidos de
        SAIR pausam sozinhos e avisam o administrador. Elegíveis agora:{" "}
        {c.elegiveis >= 500 ? "500 ou mais" : n(c.elegiveis)}.
        {chips.length === 0 && <> Chip: {c.chip ?? "não configurado (modo teste)"}.</>}
      </p>

      {chips.length > 0 && (
        <div className="space-y-1" data-testid="aq-chips">
          <span className="text-xs font-medium">
            Chips do aquecimento ({chips.length}) — os envios se dividem entre eles; cada cliente
            fica sempre no mesmo chip.
          </span>
          <ul className="space-y-1">
            {chips.map((k) => (
              <li key={k.id} className="space-y-1 rounded-md border p-2 text-xs" data-testid="aq-chip">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{k.chip}</span>
                  <span
                    className={
                      k.pausado_em
                        ? "rounded bg-amber-100 px-1.5 py-0.5 text-amber-900"
                        : "rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800"
                    }
                  >
                    {k.pausado_em ? "Pausado" : "Ativo"}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  Hoje: {k.enviados_hoje} de {k.limite_hoje} envios
                  {k.ultimo_envio
                    ? ` · último envio ${new Date(k.ultimo_envio).toLocaleString("pt-BR")}`
                    : " · ainda sem envio"}
                  {" · "}
                  {k.retorno_em
                    ? `link de retorno ativo desde ${new Date(k.retorno_em).toLocaleString("pt-BR")}`
                    : "sem link de retorno"}
                </div>
                {k.pausado_em && (
                  <div className="text-amber-900">
                    Pausado em {new Date(k.pausado_em).toLocaleString("pt-BR")}:{" "}
                    {k.pausa_motivo ?? "sem motivo"}. Os outros chips seguem.
                  </div>
                )}
                {admin && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void gerarChip(k)}
                    >
                      {k.retorno_em ? "Gerar link novo do retorno" : "Gerar link do retorno"}
                    </Button>
                    {k.pausado_em && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void retomar(k)}
                      >
                        Retomar chip
                      </Button>
                    )}
                  </div>
                )}
                {urlChip?.id === k.id && (
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={urlChip.url}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label={`Link do retorno do chip ${k.chip}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(urlChip.url)
                          .then(() => toast.success("Link copiado."))
                      }
                    >
                      Copiar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {previa.length > 0 && (
        <div className="space-y-1 rounded-md bg-muted/50 p-2 text-xs">
          <span className="font-medium">Prévia (o texto varia entre os leads):</span>
          <ul className="list-disc space-y-1 pl-4" data-testid="aq-previa">
            {previa.slice(0, 3).map((t) => (
              <li key={t}>{t}</li>
            ))}
            {previa[3] && (
              <li>
                <span className="font-medium">Lembrete: </span>
                {previa[3]}
              </li>
            )}
          </ul>
        </div>
      )}

      {p && (
        <div className="space-y-1" data-testid="aq-painel">
          <span className="text-xs font-medium">Últimos {p.dias} dias</span>
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-4">
            {[
              ["Enviados", p.enviados],
              ["Responderam", p.responderam],
              ["Voltaram a procurar", p.voltaram],
              ["Viraram visita", p.visitas],
              ["Não procuram mais", p.nao],
              ["Pediram SAIR", p.optouts],
              ["Frios", p.frios],
              ["Pausas", p.pausas],
            ].map(([rot, v]) => (
              <div key={rot as string} className="rounded-md border p-2">
                <div className="text-base font-semibold">{n(v as number)}</div>
                <div className="text-[11px] text-muted-foreground">{rot}</div>
              </div>
            ))}
          </div>
          {p.enviados_teste > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {n(p.enviados_teste)} dos envios foram em modo teste (não saíram).
            </p>
          )}
        </div>
      )}

      {admin && (
        <div className="grid gap-2 border-t pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void salvar()}>
              Salvar aquecimento
            </Button>
            {c.ativo && !c.pausado_em && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void pausar(true)}>
                Pausar agora
              </Button>
            )}
            {chips.length === 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void gerar()}>
                {c.retorno_em ? "Gerar link novo do retorno" : "Gerar link do retorno"}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground" hidden={chips.length > 0}>
            O link do retorno vai no painel da ZionTalk, no canal do chip do aquecimento (não no da
            IA de atendimento). As respostas caem na mesma conversa do lead.{" "}
            {c.retorno_em
              ? `Link ativo desde ${new Date(c.retorno_em).toLocaleString("pt-BR")}.`
              : "Nenhum link ativo."}
          </p>
          {url && (
            <div className="flex gap-2">
              <Input
                id="cfg-aq-retorno"
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link do retorno do aquecimento"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard.writeText(url).then(() => toast.success("Link copiado."))
                }
              >
                Copiar
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
