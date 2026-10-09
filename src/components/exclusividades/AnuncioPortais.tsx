import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Lock, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { formatDateBR } from "@/lib/exclusive-captures";
import {
  checkState,
  codigoValido,
  finalDigitado,
  montarCodigo,
  portaisTexto,
  type ListingCheck,
  type ListingContext,
} from "@/lib/feedback-captacao";
import {
  listingCheck,
  listingContext,
  listingDecide,
  listingLink,
  listingUnlink,
} from "@/lib/feedback-captacao-db";
import { SugestoesSite } from "./SugestoesSite";

const n = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("pt-BR"));

/** Área "Anúncio nos portais" da captação aprovada: prefixo do ID RE/MAX travado, o corretor digita o final. */
export function AnuncioPortais({ captureId }: { captureId: string }) {
  const [ctx, setCtx] = useState<ListingContext | null>(null);
  const [final, setFinal] = useState("");
  const [outroId, setOutroId] = useState(false);
  const [full, setFull] = useState("");
  const [res, setRes] = useState<ListingCheck | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCtx(await listingContext(captureId));
    } catch {
      setCtx(null);
    }
  }, [captureId]);
  useEffect(() => {
    void load();
  }, [load]);

  const code = outroId ? full.trim().toUpperCase() : montarCodigo(ctx?.prefix, final);
  useEffect(() => {
    setRes(null);
    if (!code || !codigoValido(code)) return;
    let alive = true;
    const t = setTimeout(() => {
      listingCheck(captureId, code)
        .then((r) => alive && setRes(r))
        .catch(() => alive && setRes(null));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [captureId, code]);

  if (!ctx) return null;
  const link =
    ctx.link && ["ativo", "aguardando_gestor"].includes(ctx.link.status) ? ctx.link : null;
  const state = checkState(res);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setFinal("");
      setFull("");
      setOutroId(false);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar."));
    } finally {
      setBusy(false);
    }
  };
  const ligar = () =>
    run(
      () => listingLink(captureId, code),
      outroId && !ctx.is_manager
        ? "Enviado para o gestor confirmar."
        : "Anúncio ligado à captação.",
    );

  return (
    <Card data-testid="anuncio-portais">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-4 w-4" /> Anúncio nos portais
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {link ? (
          <div className="space-y-2">
            <div
              className={`rounded-md border p-3 ${link.status === "ativo" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-blue-300 bg-blue-50 text-blue-900"}`}
            >
              <div className="font-medium">
                {link.status === "ativo" ? "✅" : "🔐"} {link.listing_code}
                {link.status === "aguardando_gestor" && " — aguardando confirmação do gestor"}
              </div>
              <div className="text-xs">
                Ligado por {link.linked_by_nome ?? "—"} em{" "}
                {new Date(link.linked_at).toLocaleDateString("pt-BR")}
                {link.decided_by_nome && link.outro_id && link.status === "ativo"
                  ? ` · confirmado por ${link.decided_by_nome}`
                  : ""}
              </div>
              <div className="mt-1 text-xs">
                {link.seen
                  ? `Coleta de ${formatDateBR(link.seen.collected_on)}: ${portaisTexto(link.seen.portals)} · ${n(link.seen.views)} visualizações e ${n(link.seen.contacts)} contatos.`
                  : `Ainda não apareceu nos portais. Confira na próxima segunda (${formatDateBR(ctx.next_monday)}); o sistema confere sozinho.`}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {link.status === "ativo" && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/feedback" search={{ codigo: link.listing_code }}>
                    Abrir Feedback ao proprietário
                  </Link>
                </Button>
              )}
              {ctx.is_manager && link.status === "aguardando_gestor" && (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => run(() => listingDecide(link.id, true), "Anúncio confirmado.")}
                  >
                    Confirmar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      const motivo = window.prompt("Motivo da recusa:")?.trim();
                      if (motivo)
                        void run(() => listingDecide(link.id, false, motivo), "Recusado.");
                    }}
                  >
                    Recusar
                  </Button>
                </>
              )}
              {ctx.can_link && (!link.outro_id || link.status !== "ativo" || ctx.is_manager) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    const motivo = window
                      .prompt(
                        "Desligar este anúncio? Informe o motivo (ex.: número digitado errado, troca de anúncio):",
                      )
                      ?.trim();
                    if (motivo)
                      void run(() => listingUnlink(captureId, motivo), "Anúncio desligado.");
                  }}
                >
                  Desligar / trocar
                </Button>
              )}
            </div>
          </div>
        ) : !ctx.can_link ? (
          <p className="text-muted-foreground">
            O anúncio é ligado depois da aprovação, quando o imóvel já estiver publicado.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_260px]">
            <div className="space-y-3">
              {ctx.prefix && (
                <SugestoesSite
                  captureId={captureId}
                  busy={busy}
                  onEscolher={(c) =>
                    void run(() => listingLink(captureId, c), "Anúncio ligado à captação.")
                  }
                />
              )}
              <p className="text-muted-foreground">
                Digite só o número final do anúncio. O começo (o ID RE/MAX) o sistema já sabe.
              </p>
              {!outroId &&
                (ctx.prefix ? (
                  <label className="block">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      Número do anúncio
                    </span>
                    <div className="mt-1 flex items-center overflow-hidden rounded-md border">
                      <span
                        className="flex items-center gap-1 bg-muted px-3 py-2 font-mono text-muted-foreground"
                        title="ID RE/MAX do captador (travado)"
                      >
                        <Lock className="h-3 w-3" /> {ctx.prefix} —
                      </span>
                      <input
                        className="h-9 flex-1 px-3 font-mono outline-none"
                        inputMode="numeric"
                        placeholder="114"
                        aria-label="Final do número do anúncio"
                        value={final}
                        onChange={(e) => setFinal(finalDigitado(e.target.value, ctx.prefix ?? ""))}
                      />
                    </div>
                  </label>
                ) : (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                    O captador está sem ID RE/MAX no perfil. Preencha em Meu perfil ou use a opção
                    abaixo com o código completo.
                  </p>
                ))}
              <label className="flex items-center gap-2">
                <Checkbox checked={outroId} onCheckedChange={(v) => setOutroId(v === true)} />O
                anúncio está no ID de outro corretor (parceiro ou TL)
              </label>
              {outroId && (
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Código completo do anúncio
                  </span>
                  <Input
                    className="mt-1 font-mono"
                    placeholder="630601021-087"
                    value={full}
                    onChange={(e) => setFull(e.target.value)}
                  />
                </label>
              )}
              {code && !codigoValido(code) && outroId && (
                <p className="text-xs text-muted-foreground">
                  Formato: 9 dígitos do ID, hífen e o número (ex.: 630601021-087).
                </p>
              )}
              {res && state === "conflito" && (
                <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
                  ⚠️ {res.code} já está ligado à captação “{res.conflict?.label ?? "sem descrição"}”
                  {res.conflict?.aprovada_em
                    ? ` (aprovada em ${formatDateBR(res.conflict.aprovada_em)})`
                    : ""}
                  . Confira o número. Se for troca de anúncio, peça ao gestor para mover.
                </div>
              )}
              {res && state === "encontrado" && (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
                  ✅ {res.seen?.listing_code} apareceu na coleta de{" "}
                  {formatDateBR(res.seen!.collected_on)} em {portaisTexto(res.seen?.portals)} ·{" "}
                  {n(res.seen?.views)} visualizações e {n(res.seen?.contacts)} contatos.
                  {!res.own_prefix && res.id_owner_nome && ` Dono do ID: ${res.id_owner_nome}.`}
                  <div className="mt-2 flex items-center gap-2">
                    <span>É este o imóvel?</span>
                    <Button size="sm" disabled={busy} onClick={ligar}>
                      {outroId && !ctx.is_manager
                        ? "Enviar para o gestor confirmar"
                        : "Confirmar e ligar"}
                    </Button>
                  </div>
                </div>
              )}
              {res && state === "nao_coletado" && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  ⌛ {res.code} ainda não apareceu nos portais. Confira na próxima segunda (
                  {formatDateBR(res.next_monday ?? ctx.next_monday)}).
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={ligar}>
                      {outroId && !ctx.is_manager
                        ? "Enviar para o gestor confirmar"
                        : "Salvar mesmo assim"}
                    </Button>
                    <span className="text-xs">O sistema confere sozinho toda segunda.</span>
                  </div>
                </div>
              )}
              {outroId && !ctx.is_manager && (
                <p className="rounded-md border border-blue-300 bg-blue-50 p-2 text-xs text-blue-900">
                  🔐 Vai para o gestor confirmar. Até ele aprovar, o Feedback desta captação fica
                  “aguardando confirmação do gestor”.
                </p>
              )}
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm font-medium">Seus anúncios ainda sem captação</div>
              <div className="mb-2 text-xs text-muted-foreground">
                {ctx.latest_collection
                  ? `Coleta de ${formatDateBR(ctx.latest_collection)} · clique para usar`
                  : "Ainda sem coleta"}
              </div>
              {ctx.suggestions.length ? (
                <ul className="space-y-1">
                  {ctx.suggestions.slice(0, 8).map((s) => (
                    <li key={s.code} className="flex items-center justify-between gap-2 text-xs">
                      <span>
                        <span className="font-mono font-medium">
                          {s.code.slice(9).replace(/^[-xX]+/, "-")}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {portaisTexto(s.portals)} · {n(s.views)} views
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          setOutroId(false);
                          setFinal(finalDigitado(s.code, ctx.prefix ?? ""));
                        }}
                      >
                        Usar
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Nenhum anúncio livre no seu ID.</p>
              )}
              {ctx.prefix && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Só anúncios do ID {ctx.prefix} que não estão em nenhuma captação.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
