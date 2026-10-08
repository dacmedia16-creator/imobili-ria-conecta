import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mail, MessageCircle, Phone, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadMyAccess } from "@/lib/platform-context";
import { useAuth, type AppRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { geoKey, geoQueries } from "@/lib/exclusive-captures-dashboard";
import { setCaptureGeo } from "@/lib/exclusive-captures-db";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import {
  nomeExibicao,
  PAPEIS_VENDAS_REGIAO,
  podeAcessarVendasPorRegiao,
} from "@/lib/vendas-por-regiao";
import {
  captacoesPendentesGeo,
  comoCapture,
  COR_CAPTACAO,
  COR_NEGOCIACAO,
  pinosCaptacoes,
  type CaptacaoMapaRow,
} from "@/lib/mapa-captacoes";
import {
  FILTROS_VAZIOS,
  filtrarCaptacoes,
  filtrosAtivos,
  opcoesFiltro,
  precoTexto,
  whatsappLink,
  type FiltrosMapa,
} from "@/lib/mapa-captacoes-filtros";
import { loadAgencyProfile, type AgencyProfile } from "@/lib/agency-profile";
import { PinsMap } from "@/components/mapa/PinsMap";
import type { SupabaseClient } from "@supabase/supabase-js";

// mapa_captacoes_v2 ainda não consta do types.ts gerado.
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

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

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
  const [filtros, setFiltros] = useState<FiltrosMapa>(FILTROS_VAZIOS);
  const [foco, setFoco] = useState<{ id: string; n: number } | null>(null);
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
    void db.rpc("mapa_captacoes_v2").then(({ data, error }) => {
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

  const opcoes = useMemo(() => opcoesFiltro(captacoes), [captacoes]);
  const filtradas = useMemo(() => filtrarCaptacoes(captacoes, filtros), [captacoes, filtros]);
  const pinosCap = useMemo(() => pinosCaptacoes(filtradas, hoje), [filtradas, hoje]);
  const capSemLocal = filtradas.length - pinosCap.length;
  const nFiltros = filtrosAtivos(filtros);
  const set = (k: keyof FiltrosMapa) => (v: string) => setFiltros((f) => ({ ...f, [k]: v }));

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
          Onde estão as captações exclusivas assinadas da imobiliária, com preço e contato do
          corretor captador.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="space-y-1 lg:col-span-2">
            <span className="text-xs text-muted-foreground">Bairro ou cidade</span>
            <Input
              placeholder="Ex.: Campolim, Sorocaba"
              value={filtros.busca}
              onChange={(e) => set("busca")(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Tipo de imóvel</span>
            <select
              className={selectCls}
              value={filtros.tipo}
              onChange={(e) => set("tipo")(e.target.value)}
            >
              <option value="">Todos</option>
              {opcoes.tipos.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Preço (R$)</span>
            <div className="flex gap-1">
              <Input
                inputMode="numeric"
                placeholder="Mín."
                aria-label="Preço mínimo"
                value={filtros.precoMin}
                onChange={(e) => set("precoMin")(e.target.value)}
              />
              <Input
                inputMode="numeric"
                placeholder="Máx."
                aria-label="Preço máximo"
                value={filtros.precoMax}
                onChange={(e) => set("precoMax")(e.target.value)}
              />
            </div>
          </div>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Captador</span>
            <select
              className={selectCls}
              value={filtros.captador}
              onChange={(e) => set("captador")(e.target.value)}
            >
              <option value="">Todos</option>
              {opcoes.captadores.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Equipe</span>
            <select
              className={selectCls}
              value={filtros.equipe}
              onChange={(e) => set("equipe")(e.target.value)}
              disabled={!opcoes.equipes.length}
            >
              <option value="">Todas</option>
              {opcoes.equipes.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </label>
          {nFiltros > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2 lg:col-span-6">
              {filtradas.length} de {captacoes.length} captações com os filtros.
              <Button variant="ghost" size="sm" onClick={() => setFiltros(FILTROS_VAZIOS)}>
                <X className="mr-1 h-3 w-3" /> Limpar filtros
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">Mapa das captações</CardTitle>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COR_CAPTACAO }} />
              {filtradas.length}{" "}
              {filtradas.length === 1 ? "captação assinada" : "captações assinadas"}
              {filtradas.some((r) => r.negociacao) && (
                <>
                  <span
                    className="ml-2 h-2.5 w-2.5 rounded-full"
                    style={{ background: COR_NEGOCIACAO }}
                  />
                  {filtradas.filter((r) => r.negociacao).length} em negociação
                </>
              )}
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            <PinsMap
              pins={pinosCap}
              city={agency?.cidade ?? null}
              uf={agency?.uf ?? null}
              focusId={foco}
              onOpen={(id) => navigate({ to: "/exclusividades/$id", params: { id } })}
            />
            <p className="text-xs text-muted-foreground">
              {localizandoCap
                ? `Localizando captações no mapa… ${localizandoCap.feitos}/${localizandoCap.total}. `
                : ""}
              {capSemLocal > 0
                ? `${capSemLocal} ${capSemLocal === 1 ? "captação assinada ainda fora do mapa" : "captações assinadas ainda fora do mapa"} (sem endereço ou ainda não localizada). `
                : ""}
              Só captações com contrato de exclusividade assinado; rascunhos, captações em
              andamento, descartadas e arquivadas ficam de fora. Os dados do proprietário nunca
              aparecem no mapa.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:max-h-[560px] lg:overflow-y-auto">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lista</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {filtradas.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma captação com esses filtros.</p>
            )}
            {filtradas.map((r) => (
              <ItemLista
                key={r.id}
                r={r}
                noMapa={r.geo_lat != null && r.geo_lon != null}
                onVer={() => setFoco((f) => ({ id: r.id, n: (f?.n ?? 0) + 1 }))}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ItemLista({
  r,
  noMapa,
  onVer,
}: {
  r: CaptacaoMapaRow;
  noMapa: boolean;
  onVer: () => void;
}) {
  const wa = whatsappLink(r.captador_telefone, r.codigo);
  const local = [
    r.bairro ? nomeExibicao(r.bairro) : "Sem bairro",
    r.cidade ? nomeExibicao(r.cidade) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-md border p-2 text-sm" data-testid="item-captacao">
      <button
        type="button"
        className="w-full text-left disabled:cursor-default"
        onClick={onVer}
        disabled={!noMapa}
        title={noMapa ? "Ver no mapa" : "Ainda sem localização no mapa"}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">
            {r.tipo_imovel ? nomeExibicao(r.tipo_imovel) : "Imóvel"}
          </span>
          <span className="font-semibold text-emerald-700">{precoTexto(r.valor_imovel)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {local} · {r.codigo}
        </div>
        {r.detalhe && r.endereco && <div className="text-xs">{r.endereco}</div>}
      </button>
      <div className="mt-1 border-t pt-1 text-xs">
        <div>
          Captador: <span className="font-medium">{r.captador || "—"}</span>
          {r.equipe ? <span className="text-muted-foreground"> · {r.equipe}</span> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
            >
              <MessageCircle className="h-3 w-3" /> WhatsApp
            </a>
          )}
          {r.captador_telefone && !wa && (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" /> {r.captador_telefone}
            </span>
          )}
          {r.captador_email && (
            <a
              href={`mailto:${r.captador_email}`}
              className="inline-flex items-center gap-1 text-blue-700 hover:underline"
            >
              <Mail className="h-3 w-3" /> {r.captador_email}
            </a>
          )}
          {!r.captador_telefone && !r.captador_email && (
            <span className="text-muted-foreground">Sem contato no cadastro</span>
          )}
        </div>
      </div>
    </div>
  );
}
