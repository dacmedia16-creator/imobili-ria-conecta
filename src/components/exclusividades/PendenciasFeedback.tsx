import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/errors";
import { formatDateBR } from "@/lib/exclusive-captures";
import { agruparPendencias, DIAS_AVISO_SEM_ANUNCIO, type Pendencia } from "@/lib/feedback-captacao";
import {
  listingDecide,
  pendencias,
  siteProvaveis,
  type SiteProvavel,
} from "@/lib/feedback-captacao-db";

/** Painel do gestor: não publicadas, anúncio de outro ID a confirmar e ações do Plano atrasadas. */
export function PendenciasFeedback() {
  const [rows, setRows] = useState<Pendencia[] | null>(null);
  const [provaveis, setProvaveis] = useState<Record<string, SiteProvavel>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setRows(await pendencias(DIAS_AVISO_SEM_ANUNCIO));
    } catch {
      setRows([]);
    }
    // Site RE/MAX: só um aviso; se falhar, o painel segue igual.
    const p = await siteProvaveis();
    setProvaveis(Object.fromEntries(p.map((x) => [x.capture_id, x])));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const g = useMemo(() => agruparPendencias(rows ?? []), [rows]);
  if (!rows) return null;
  const naoPublicadas = [...g.sem_anuncio, ...g.nao_coletado];
  const decide = async (p: Pendencia, ok: boolean) => {
    const motivo = ok ? undefined : window.prompt("Motivo da recusa:")?.trim();
    if (!ok && !motivo) return;
    setBusy(true);
    try {
      await listingDecide(p.link_id!, ok, motivo);
      toast.success(ok ? "Anúncio confirmado." : "Recusado.");
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar."));
    } finally {
      setBusy(false);
    }
  };
  const abrir = (p: Pendencia, txt: string) => (
    <Link
      to="/exclusividades/$id"
      params={{ id: p.capture_id }}
      className="font-medium hover:underline"
    >
      {txt}
    </Link>
  );

  return (
    <div className="space-y-3" data-testid="pendencias-feedback">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Kpi
          v={naoPublicadas.length}
          k={`Não publicadas nos portais (+${DIAS_AVISO_SEM_ANUNCIO} dias)`}
          alert
        />
        <Kpi v={g.confirmar.length} k="Anúncio de outro ID a confirmar" />
        <Kpi v={g.atrasada.length} k="Ações do Plano atrasadas" alert />
      </div>
      {naoPublicadas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">🚫 Não publicadas nos portais</CardTitle>
            <p className="text-xs text-muted-foreground">
              Captação aprovada há mais de {DIAS_AVISO_SEM_ANUNCIO} dias sem anúncio ligado, ou com
              código salvo que ainda não apareceu na coleta.
            </p>
          </CardHeader>
          <CardContent className="text-sm">
            <table className="w-full">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-normal">Imóvel</th>
                  <th className="text-left font-normal">Corretor</th>
                  <th className="text-left font-normal">Aprovada</th>
                  <th className="text-left font-normal">Situação</th>
                </tr>
              </thead>
              <tbody>
                {naoPublicadas.map((p) => (
                  <tr key={`${p.kind}-${p.capture_id}`} className="border-t">
                    <td className="py-1 pr-2">{abrir(p, p.imovel ?? "Captação")}</td>
                    <td className="pr-2">{p.corretor ?? "—"}</td>
                    <td className="pr-2">{p.aprovada_em ? formatDateBR(p.aprovada_em) : "—"}</td>
                    <td>
                      {p.kind === "sem_anuncio" ? (
                        <span className="flex flex-wrap items-center gap-1">
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
                            Sem anúncio ligado há {p.dias} dias
                          </span>
                          {provaveis[p.capture_id] && (
                            <span
                              className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-900"
                              title="Encontrado no site da RE/MAX. O corretor confirma na captação."
                            >
                              Provável anúncio encontrado:{" "}
                              <span className="font-mono">{provaveis[p.capture_id].code}</span>
                              {provaveis[p.capture_id].confianca === "alta" ? "" : " (possível)"}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                          {p.listing_code} não apareceu na coleta ({p.dias} dias)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {g.confirmar.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">🔐 Confirmar anúncio de outro ID</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {g.confirmar.map((p) => (
              <div
                key={p.link_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
              >
                <span>
                  {p.corretor ?? "—"} ligou {abrir(p, p.imovel ?? "a captação")} ao anúncio{" "}
                  <span className="font-mono">{p.listing_code}</span>
                  {p.acao ? `, que está no ID de ${p.acao}` : ", de um ID sem perfil"}.
                </span>
                <span className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => decide(p, true)}>
                    Confirmar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => decide(p, false)}
                  >
                    Recusar
                  </Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {g.atrasada.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">⏰ Ações do Plano atrasadas</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <table className="w-full">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-normal">Corretor</th>
                  <th className="text-left font-normal">Ação</th>
                  <th className="text-left font-normal">Imóvel</th>
                  <th className="text-left font-normal">Prazo</th>
                </tr>
              </thead>
              <tbody>
                {g.atrasada.map((p, i) => (
                  <tr key={`${p.capture_id}-${i}`} className="border-t bg-red-50/60">
                    <td className="py-1 pr-2">{p.corretor ?? "—"}</td>
                    <td className="pr-2">{p.acao}</td>
                    <td className="pr-2">{abrir(p, p.imovel ?? "Captação")}</td>
                    <td>{p.prazo ? formatDateBR(p.prazo) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ v, k, alert }: { v: number; k: string; alert?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className={`text-2xl font-semibold ${alert && v > 0 ? "text-red-700" : ""}`}>{v}</div>
      <div className="text-xs text-muted-foreground">{k}</div>
    </div>
  );
}
