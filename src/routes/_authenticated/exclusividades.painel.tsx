import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { listCaptures, listUnits, setCaptureGeo } from "@/lib/exclusive-captures-db";
import { guardExclusiveRoute } from "@/lib/exclusive-captures-guard";
import {
  formatDateBR,
  validityText,
  VALIDITY_STYLE,
  type Capture,
  type ExclusiveUnit,
} from "@/lib/exclusive-captures";
import {
  applyFilters,
  bairroLabel,
  brl,
  buildDashboard,
  EMPTY_FILTERS,
  geoKey,
  geoQueries,
  SITUATION_COLOR,
  SITUATION_LABEL,
  situation,
  type Filters,
  type Group,
  type Situation,
} from "@/lib/exclusive-captures-dashboard";
import { loadAgencyProfile, type AgencyProfile } from "@/lib/agency-profile";
import { CapturesMap } from "@/components/exclusividades/CapturesMap";
import { CapturesFilters } from "@/components/exclusividades/CapturesFilters";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/exclusividades/painel")({
  head: () => ({ meta: [{ title: "Painel e mapa das captações" }] }),
  beforeLoad: guardExclusiveRoute,
  component: CapturesDashboard,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** OpenStreetMap/Nominatim: só o endereço do imóvel, 1 consulta por segundo (política de uso). */
async function geocode(c: Capture, agency: AgencyProfile | null): Promise<[number, number] | null> {
  for (const q of geoQueries(c, agency ?? undefined)) {
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

function Ranking({ title, rows }: { title: string; rows: Group[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">Sem dados.</p>
        ) : (
          <table className="w-full">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-normal">Nome</th>
                <th className="text-right font-normal">Captações</th>
                <th className="text-right font-normal">Em vigor</th>
                <th className="text-right font-normal">Valor em vigor</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((g) => (
                <tr key={g.key} className="border-t">
                  <td className="py-1 pr-2">{g.key}</td>
                  <td className="text-right">{g.total}</td>
                  <td className="text-right">{g.aprovadas}</td>
                  <td className="text-right">{g.valor ? brl(g.valor) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function CapturesDashboard() {
  const navigate = useNavigate();
  const today = hojeSaoPaulo();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [units, setUnits] = useState<ExclusiveUnit[]>([]);
  const [agency, setAgency] = useState<AgencyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [hidden, setHidden] = useState<Situation[]>([]);
  const [locating, setLocating] = useState<{ done: number; total: number } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    Promise.all([listCaptures(), listUnits(), loadAgencyProfile()])
      .then(([list, unitList, agencyProfile]) => {
        setCaptures(list);
        setUnits(unitList);
        setAgency(agencyProfile);
      })
      .catch((e) => toast.error(errorMessage(e, "Falha ao carregar captações")))
      .finally(() => setLoading(false));
  }, []);

  // Localiza no mapa as captações cujo endereço ainda não tem coordenada (ou mudou).
  useEffect(() => {
    if (loading || started.current) return;
    const pending = captures.filter((c) => !c.archived_at && geoKey(c) && c.geo_key !== geoKey(c));
    if (!pending.length) return;
    started.current = true;
    void (async () => {
      setLocating({ done: 0, total: pending.length });
      for (const [i, c] of pending.entries()) {
        try {
          const hit = await geocode(c, agency);
          const key = geoKey(c);
          await setCaptureGeo(c.id, key, hit?.[0] ?? null, hit?.[1] ?? null);
          setCaptures((list) =>
            list.map((x) =>
              x.id === c.id
                ? { ...x, geo_key: key, geo_lat: hit?.[0] ?? null, geo_lon: hit?.[1] ?? null }
                : x,
            ),
          );
        } catch {
          break; // serviço indisponível: tenta de novo na próxima visita
        }
        setLocating({ done: i + 1, total: pending.length });
      }
      setLocating(null);
    })();
  }, [loading, captures, agency]);

  const filtered = useMemo(
    () => applyFilters(captures, filters, today, units),
    [captures, filters, today, units],
  );
  const d = useMemo(() => buildDashboard(filtered, today, units), [filtered, today, units]);
  const onMap = filtered.filter((c) => !hidden.includes(situation(c, today).s));
  const semLocal = filtered.filter((c) => c.geo_lat == null).length;
  const active = captures.filter((c) => !c.archived_at);

  const kpi = (label: string, value: string | number, color?: string) => (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Painel e mapa das captações</h1>
          <p className="text-sm text-muted-foreground">
            Mostra só as captações que você pode ver. Valores consideram exclusividades em vigor.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/exclusividades">
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar para a lista
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <CapturesFilters captures={active} value={filters} onChange={setFilters} units={units} />
        </CardContent>
      </Card>

      {loading ? (
        <p>Carregando…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {kpi("Captações", d.total)}
            {kpi(SITUATION_LABEL.em_vigor, d.porSituacao.em_vigor, SITUATION_COLOR.em_vigor)}
            {kpi(SITUATION_LABEL.vencendo, d.porSituacao.vencendo, SITUATION_COLOR.vencendo)}
            {kpi(SITUATION_LABEL.vencida, d.porSituacao.vencida, SITUATION_COLOR.vencida)}
            {kpi("Em andamento", d.porSituacao.em_andamento, SITUATION_COLOR.em_andamento)}
            {kpi(SITUATION_LABEL.rascunho, d.porSituacao.rascunho, SITUATION_COLOR.rascunho)}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {kpi("Valor dos imóveis em exclusividade", brl(d.valorEmVigor))}
            {kpi("Comissão potencial (pelo % do contrato)", brl(d.comissaoPotencial))}
            {kpi(
              "Média de dias da criação à assinatura",
              d.mediaDiasAteAssinatura === null ? "—" : `${d.mediaDiasAteAssinatura} dias`,
            )}
          </div>
          {d.semValor > 0 && (
            <p className="text-xs text-muted-foreground">
              {d.semValor} exclusividade(s) em vigor sem valor do imóvel preenchido não entram na
              soma.
            </p>
          )}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Mapa</CardTitle>
              <div className="flex flex-wrap gap-2 text-xs">
                {(Object.keys(SITUATION_LABEL) as Situation[]).map((s) => {
                  const off = hidden.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setHidden((h) => (off ? h.filter((x) => x !== s) : [...h, s]))}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${off ? "opacity-40 line-through" : ""}`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: SITUATION_COLOR[s] }}
                      />
                      {SITUATION_LABEL[s]}
                    </button>
                  );
                })}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <CapturesMap
                captures={onMap}
                today={today}
                city={agency?.cidade ?? null}
                uf={agency?.uf ?? null}
                onOpen={(id) => navigate({ to: "/exclusividades/$id", params: { id } })}
              />
              <p className="text-xs text-muted-foreground">
                {locating
                  ? `Localizando endereços no mapa… ${locating.done}/${locating.total}`
                  : semLocal > 0
                    ? `${semLocal} captação(ões) sem endereço localizável ficam fora do mapa (rascunhos sem endereço ou endereço não encontrado).`
                    : "Todas as captações filtradas estão no mapa."}{" "}
                Localização aproximada pelo OpenStreetMap.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Vencimentos (vencidas e próximos 60 dias)</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {d.proximosVencimentos.length === 0 ? (
                <p className="text-muted-foreground">
                  Nenhuma exclusividade vencendo nos próximos 60 dias.
                </p>
              ) : (
                <ul className="divide-y">
                  {d.proximosVencimentos.map(({ c, v }) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <Link
                        to="/exclusividades/$id"
                        params={{ id: c.id }}
                        className="hover:underline"
                      >
                        {c.form_data.imovel?.endereco || "Imóvel"} · {bairroLabel(c)} ·{" "}
                        {c.broker_name}
                      </Link>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${VALIDITY_STYLE[v.level]}`}
                      >
                        {validityText(v)} · assinada em {formatDateBR(v.start)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-3">
            <Ranking title="Por corretor" rows={d.porCorretor} />
            <Ranking title="Por bairro" rows={d.porBairro} />
            <Ranking title="Por unidade" rows={d.porUnidade} />
          </div>
        </>
      )}
    </div>
  );
}
