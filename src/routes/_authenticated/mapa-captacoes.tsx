import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadMyAccess } from "@/lib/platform-context";
import { useAuth, type AppRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { geoKey, geoQueries } from "@/lib/exclusive-captures-dashboard";
import { setCaptureGeo } from "@/lib/exclusive-captures-db";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { PAPEIS_VENDAS_REGIAO, podeAcessarVendasPorRegiao } from "@/lib/vendas-por-regiao";
import {
  captacoesPendentesGeo,
  comoCapture,
  COR_CAPTACAO,
  pinosCaptacoes,
  type CaptacaoMapaRow,
} from "@/lib/mapa-captacoes";
import { loadAgencyProfile, type AgencyProfile } from "@/lib/agency-profile";
import { PinsMap } from "@/components/mapa/PinsMap";
import type { SupabaseClient } from "@supabase/supabase-js";

// mapa_captacoes ainda não consta do types.ts gerado.
const db = supabase as unknown as SupabaseClient;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** OpenStreetMap/Nominatim (gratuito): só o endereço do imóvel, 1 consulta por segundo. */
async function geocodeConsultas(consultas: string[]): Promise<[number, number] | null> {
  for (const q of consultas) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=" +
      encodeURIComponent(q);
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    await sleep(1100);
    if (!r.ok) throw new Error(`OpenStreetMap ${r.status}`);
    const [hit] = (await r.json()) as { lat: string; lon: string }[];
    if (hit) return [Number(hit.lat), Number(hit.lon)];
  }
  return null;
}

// Mesmos 9 perfis de Vendas por região (Denis, 08/10/2026): o mapa só saiu daquela tela.
const PAPEIS: AppRole[] = [...PAPEIS_VENDAS_REGIAO];

export const Route = createFileRoute("/_authenticated/mapa-captacoes")({
  head: () => ({ meta: [{ title: "Mapa de captações" }] }),
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { roles } = await loadMyAccess(session.user.id);
    if (!podeAcessarVendasPorRegiao(roles)) {
      toast.error("Acesso não autorizado.");
      throw redirect({ to: "/dashboard" });
    }
  },
  component: MapaCaptacoesPage,
});

function MapaCaptacoesPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(PAPEIS);
  const hoje = hojeSaoPaulo();
  const [loading, setLoading] = useState(true);
  const [captacoes, setCaptacoes] = useState<CaptacaoMapaRow[]>([]);
  const [agency, setAgency] = useState<AgencyProfile | null>(null);
  const [localizandoCap, setLocalizandoCap] = useState<{ feitos: number; total: number } | null>(
    null,
  );
  const iniciouGeoCap = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelado = false;
    void loadAgencyProfile()
      .then((a) => !cancelado && setAgency(a))
      .catch(() => undefined);
    void db.rpc("mapa_captacoes").then(({ data, error }) => {
      if (cancelado) return;
      if (error) toast.error("Não foi possível carregar o mapa de captações.");
      else setCaptacoes((data ?? []) as CaptacaoMapaRow[]);
      setLoading(false);
    });
    return () => {
      cancelado = true;
    };
  }, [allowed]);

  // Localiza as captações que a pessoa pode abrir (captador, líder, admin) e ainda sem coordenada.
  useEffect(() => {
    if (iniciouGeoCap.current || !captacoes.length) return;
    const pendentes = captacoesPendentesGeo(captacoes);
    if (!pendentes.length) return;
    iniciouGeoCap.current = true;
    void (async () => {
      setLocalizandoCap({ feitos: 0, total: pendentes.length });
      for (const [i, r] of pendentes.entries()) {
        try {
          const c = comoCapture(r);
          const hit = await geocodeConsultas(geoQueries(c, agency ?? undefined));
          const key = geoKey(c);
          await setCaptureGeo(r.id, key, hit?.[0] ?? null, hit?.[1] ?? null);
          setCaptacoes((list) =>
            list.map((x) =>
              x.id === r.id
                ? { ...x, geo_key: key, geo_lat: hit?.[0] ?? null, geo_lon: hit?.[1] ?? null }
                : x,
            ),
          );
        } catch {
          break; // serviço indisponível ou sem permissão: tenta de novo na próxima visita
        }
        setLocalizandoCap({ feitos: i + 1, total: pendentes.length });
      }
      setLocalizandoCap(null);
    })();
    // agency lido uma vez no início; não reiniciar a fila a cada coordenada gravada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captacoes]);

  const pinosCap = useMemo(() => pinosCaptacoes(captacoes, hoje), [captacoes, hoje]);
  const capSemLocal = captacoes.length - pinosCap.length;

  if (authLoading || loading)
    return <div className="p-8 text-center text-muted-foreground">Carregando…</div>;
  if (!allowed)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a usuários da imobiliária.
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mapa de captações</h1>
        <p className="text-sm text-muted-foreground">
          Onde estão as captações exclusivas assinadas da imobiliária.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Mapa das captações</CardTitle>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COR_CAPTACAO }} />
            {captacoes.length}{" "}
            {captacoes.length === 1 ? "captação assinada" : "captações assinadas"}
          </span>
        </CardHeader>
        <CardContent className="space-y-2">
          <PinsMap
            pins={pinosCap}
            city={agency?.cidade ?? null}
            uf={agency?.uf ?? null}
            onOpen={(id) => navigate({ to: "/exclusividades/$id", params: { id } })}
          />
          <p className="text-xs text-muted-foreground">
            {localizandoCap
              ? `Localizando captações no mapa… ${localizandoCap.feitos}/${localizandoCap.total}. `
              : ""}
            {capSemLocal > 0
              ? `${capSemLocal} ${capSemLocal === 1 ? "captação assinada ainda fora do mapa" : "captações assinadas ainda fora do mapa"} (sem endereço ou ainda não localizada). `
              : ""}
            Só captações com contrato de exclusividade assinado; rascunhos, captações em andamento,
            descartadas e arquivadas ficam de fora. Os dados do proprietário nunca aparecem no mapa.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
