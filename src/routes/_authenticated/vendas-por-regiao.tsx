import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-access";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Handshake,
  Map as MapIcon,
  MapPin,
  MapPinOff,
  Printer,
  Wallet,
} from "lucide-react";
import {
  EmptyState,
  KpiGridSkeleton,
  KpiTile,
  ListSkeleton,
  PageHeader,
} from "@/components/visual/base";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mesAtualRange } from "@/lib/producao-por-pessoa-filters";
import { brl } from "@/lib/exclusive-captures-dashboard";
import {
  agruparPorRegiao,
  filtrarPinos,
  filtrarVendas,
  geoKeyVenda,
  geoQueriesVenda,
  linhaFichaPino,
  montarVendasTodos,
  nomeExibicao,
  PAPEIS_VENDAS_REGIAO,
  podeAcessarVendasPorRegiao,
  somaQtd,
  vendasNoMapa,
  vendasPendentesGeo,
  type FiltrosRegiao,
  type PinoAnonimo,
  type SaleGeo,
  type VendaRegiao,
  type VendaRegiaoTodosRow,
} from "@/lib/vendas-por-regiao";
import { loadAgencyProfile, type AgencyProfile } from "@/lib/agency-profile";
import { PinsMap, type MapPin as Pino } from "@/components/mapa/PinsMap";
import type { SupabaseClient } from "@supabase/supabase-js";

// vendas_por_regiao_todos/sale_set_geo ainda não constam do types.ts gerado.
const db = supabase as unknown as SupabaseClient;
const COR_PADRAO = "#2563eb";
const COR_LANCAMENTO = "#f59e0b";

/** Ficha no pino: tipo, área útil e preço/m² (estes dois só quando a área útil existe). */
const linhasFicha = (
  tipo: string | null | undefined,
  area: number | null | undefined,
  valor: number | null | undefined,
) => {
  const t = linhaFichaPino(tipo, area, valor);
  return t ? [{ text: t }] : [];
};

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

const PAPEIS: AppRole[] = [...PAPEIS_VENDAS_REGIAO];

export const Route = createFileRoute("/_authenticated/vendas-por-regiao")({
  head: () => ({ meta: [{ title: "Vendas por região" }] }),
  beforeLoad: ({ context }) => requireRoles(context.auth, podeAcessarVendasPorRegiao),
  component: VendasPorRegiaoPage,
});

const fmtData = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const local = (bairro: string, cidade: string) =>
  [bairro ? nomeExibicao(bairro) : "", nomeExibicao(cidade.split("|")[0] ?? "")]
    .filter(Boolean)
    .join(" · ");

function VendasPorRegiaoPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(PAPEIS);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [vendas, setVendas] = useState<VendaRegiao[]>([]);
  const [anonimos, setAnonimos] = useState<PinoAnonimo[]>([]);
  const [filtros, setFiltros] = useState<FiltrosRegiao>({ dataDe: "", dataAte: "", busca: "" });
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [agency, setAgency] = useState<AgencyProfile | null>(null);
  const [geo, setGeo] = useState<Map<string, SaleGeo>>(new Map());
  const [localizando, setLocalizando] = useState<{ feitos: number; total: number } | null>(null);
  const iniciouGeo = useRef(false);
  const carregouUmaVez = useRef(false);
  const navigate = useNavigate();

  // Perfil da imobiliária: uma vez por visita (não depende do período).
  // O mapa das captações saiu desta tela e foi para /mapa-captacoes (Denis, 08/10/2026).
  useEffect(() => {
    if (!allowed) return;
    let cancelado = false;
    void loadAgencyProfile()
      .then((a) => !cancelado && setAgency(a))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [allowed]);

  // Vendas: o período vai para o banco, porque os totais das vendas de outras pessoas chegam somados.
  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelado = false;
    if (!carregouUmaVez.current) setLoading(true);
    setErro(null);
    void db
      .rpc("vendas_por_regiao_todos", {
        _de: filtros.dataDe || null,
        _ate: filtros.dataAte || null,
      })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) setErro(error.message);
        else {
          const m = montarVendasTodos((data ?? []) as VendaRegiaoTodosRow[]);
          setVendas(m.vendas);
          setAnonimos(m.pinos);
          setGeo((atual) => {
            const n = new Map(m.geo);
            for (const [k, g] of atual) if (!n.has(k)) n.set(k, g);
            return n;
          });
        }
        carregouUmaVez.current = true;
        setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [allowed, filtros.dataDe, filtros.dataAte]);

  // Localiza no mapa as vendas DA PESSOA cujo endereço ainda não tem coordenada. Uma vez por visita.
  useEffect(() => {
    if (loading || iniciouGeo.current || !vendas.length) return;
    const pendentes = vendasPendentesGeo(vendas, geo);
    if (!pendentes.length) return;
    iniciouGeo.current = true;
    void (async () => {
      setLocalizando({ feitos: 0, total: pendentes.length });
      for (const [i, v] of pendentes.entries()) {
        try {
          const hit = await geocodeConsultas(geoQueriesVenda(v, agency ?? undefined));
          const key = geoKeyVenda(v);
          const { error } = await db.rpc("sale_set_geo", {
            _sale_id: v.saleId,
            _key: key,
            _lat: hit?.[0] ?? null,
            _lon: hit?.[1] ?? null,
          });
          if (error) throw error;
          setGeo((m) => {
            const n = new Map(m);
            n.set(v.saleId, {
              sale_id: v.saleId,
              geo_key: key,
              geo_lat: hit?.[0] ?? null,
              geo_lon: hit?.[1] ?? null,
            });
            return n;
          });
        } catch {
          break; // serviço indisponível ou sem permissão: tenta de novo na próxima visita
        }
        setLocalizando({ feitos: i + 1, total: pendentes.length });
      }
      setLocalizando(null);
    })();
    // geo/agency lidos uma vez no início; não reiniciar a fila a cada coordenada gravada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, vendas]);

  const filtradas = useMemo(() => filtrarVendas(vendas, filtros), [vendas, filtros]);
  const anonimosFiltrados = useMemo(
    () => filtrarPinos(anonimos, filtros.busca),
    [anonimos, filtros.busca],
  );
  const { noMapa } = useMemo(() => vendasNoMapa(filtradas, geo), [filtradas, geo]);
  const pinos = useMemo<Pino[]>(
    () => [
      ...noMapa.map((v) => ({
        id: v.saleId,
        lat: v.lat,
        lon: v.lon,
        color: v.modalidade === "lancamento" ? COR_LANCAMENTO : COR_PADRAO,
        lines: [
          {
            text: `${v.codigo} · ${v.modalidade === "lancamento" ? "Lançamento" : "Padrão"}`,
            bold: true,
          },
          { text: v.endereco || "Sem endereço cadastrado" },
          { text: local(v.bairro, v.cidade) },
          ...linhasFicha(v.tipoImovel, v.areaUtil, v.vgv),
          { text: `VGV ${brl(v.vgv)} · assinada em ${fmtData(v.data)}` },
        ],
        actionLabel: "Abrir venda →",
      })),
      ...anonimosFiltrados.map((p) => ({
        id: p.id,
        lat: p.lat,
        lon: p.lon,
        color: p.modalidade === "lancamento" ? COR_LANCAMENTO : COR_PADRAO,
        lines: [
          {
            text: `Venda · ${p.modalidade === "lancamento" ? "Lançamento" : "Padrão"}`,
            bold: true,
          },
          { text: local(p.bairro, p.cidade) || "Sem bairro informado" },
          ...linhasFicha(p.tipoImovel, p.areaUtil, p.valor),
          ...(p.valor != null && Number.isFinite(p.valor)
            ? [{ text: `Valor ${brl(p.valor)}` }]
            : []),
          { text: "Localização aproximada" },
        ],
      })),
    ],
    [noMapa, anonimosFiltrados],
  );
  const cidades = useMemo(() => agruparPorRegiao(filtradas), [filtradas]);
  const totalQtd = somaQtd(filtradas);
  const totalVgv = filtradas.reduce((s, v) => s + v.vgv, 0);
  const semEndereco = somaQtd(filtradas.filter((v) => !v.bairro || !v.cidade));
  const totalNoMapa = pinos.length;
  const semLocal = Math.max(totalQtd - totalNoMapa, 0);

  const alternar = (k: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const atalhoMes = () => {
    const { de, ate } = mesAtualRange();
    setFiltros((f) => ({ ...f, dataDe: de, dataAte: ate }));
  };

  if (authLoading || loading)
    return (
      <div role="status" aria-live="polite" className="space-y-6">
        <span className="sr-only">Carregando…</span>
        <KpiGridSkeleton count={3} className="sm:grid-cols-3 md:grid-cols-3" />
        <ListSkeleton rows={5} label="Carregando regiões" />
      </div>
    );
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
      <PageHeader
        icon={MapIcon}
        title="Vendas por região"
        description={
          <span className="print:hidden">
            Onde estão os imóveis vendidos da imobiliária: quantidade e VGV por cidade e bairro.
          </span>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            className="print:hidden"
            onClick={() => window.print()}
          >
            <Printer className="mr-2 h-4 w-4" />
            Imprimir / baixar
          </Button>
        }
      />

      {erro && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{erro}</CardContent>
        </Card>
      )}

      <Card className="print:hidden">
        <CardContent className="grid gap-3 pt-6 md:grid-cols-4">
          <div className="space-y-1">
            <Label>De</Label>
            <Input
              type="date"
              value={filtros.dataDe}
              onChange={(e) => setFiltros((f) => ({ ...f, dataDe: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>Até</Label>
            <Input
              type="date"
              value={filtros.dataAte}
              onChange={(e) => setFiltros((f) => ({ ...f, dataAte: e.target.value }))}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Buscar bairro ou cidade</Label>
            <Input
              placeholder="Ex.: Campolim, Votorantim"
              value={filtros.busca}
              onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-4">
            <Button variant="outline" size="sm" onClick={atalhoMes}>
              Este mês
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setFiltros((f) => ({
                  ...f,
                  dataDe: `${new Date().getFullYear()}-01-01`,
                  dataAte: "",
                }))
              }
            >
              Este ano
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFiltros({ dataDe: "", dataAte: "", busca: "" })}
            >
              Todo o período
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiTile icon={Handshake} tom="blue" label="Vendas" value={String(totalQtd)} />
        <KpiTile icon={Wallet} tom="green" label="VGV" value={brl(totalVgv)} />
        <div className="col-span-2 sm:col-span-1">
          <KpiTile
            icon={MapPinOff}
            tom={semEndereco > 0 ? "amber" : "slate"}
            label="Sem bairro ou cidade"
            value={String(semEndereco)}
          />
        </div>
      </div>

      {totalQtd > 0 && (
        <Card className="print:hidden">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">Mapa das vendas</CardTitle>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: COR_PADRAO }} />
                Padrão
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: COR_LANCAMENTO }} />
                Lançamento
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <PinsMap
              pins={pinos}
              city={agency?.cidade ?? null}
              uf={agency?.uf ?? null}
              onOpen={(id) => navigate({ to: "/vendas/$id", params: { id } })}
            />
            <p className="text-xs text-muted-foreground">
              {localizando
                ? `Localizando endereços no mapa… ${localizando.feitos}/${localizando.total}. `
                : ""}
              {semLocal > 0
                ? `${semLocal} ${semLocal === 1 ? "venda sem localização" : "vendas sem localização"} no mapa (sem endereço ou endereço não encontrado). `
                : "Todas as vendas filtradas estão no mapa. "}
              Localização pelo OpenStreetMap; nas vendas de outras pessoas o ponto é aproximado.
            </p>
          </CardContent>
        </Card>
      )}

      {cidades.length === 0 && (
        <EmptyState icon={MapPin}>Nenhuma venda encontrada com esses filtros.</EmptyState>
      )}

      {cidades.map((c) => (
        <Card key={c.chave}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                {c.cidade}
                {c.uf ? ` / ${c.uf}` : ""}
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                {c.qtd} {c.qtd === 1 ? "venda" : "vendas"} · {brl(c.vgv)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {c.bairros.map((b) => {
              const k = `${c.chave}/${b.chave}`;
              const aberto = abertos.has(k);
              return (
                <div key={k} className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => alternar(k)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                  >
                    <span className="flex items-center gap-1 font-medium">
                      {aberto ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      {b.bairro}
                    </span>
                    <span className="text-muted-foreground">
                      {b.qtd} {b.qtd === 1 ? "venda" : "vendas"} · {brl(b.vgv)}
                    </span>
                  </button>
                  {aberto && (
                    <ul className="divide-y border-t text-sm">
                      {b.vendas.map((v) => (
                        <li
                          key={v.saleId}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <Link
                              to="/vendas/$id"
                              params={{ id: v.saleId }}
                              className="font-medium text-primary hover:underline"
                            >
                              {v.endereco || "Sem endereço cadastrado"}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {v.codigo} · assinada em {fmtData(v.data)}
                            </div>
                          </div>
                          <span className="whitespace-nowrap">{brl(v.vgv)}</span>
                        </li>
                      ))}
                      {b.outras > 0 && (
                        <li className="px-3 py-2 text-xs text-muted-foreground">
                          {b.outras}{" "}
                          {b.outras === 1
                            ? "venda de outra pessoa da imobiliária"
                            : "vendas de outras pessoas da imobiliária"}{" "}
                          (só entram nos totais).
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        Mesmas vendas dos demais relatórios: data da assinatura do contrato (Lançamentos: entrada no
        Financeiro); canceladas e arquivadas ficam de fora. Os totais são da imobiliária inteira e
        iguais para todos; o detalhe de cada venda aparece só para quem já tem acesso a ela. Grafias
        diferentes do mesmo bairro ou cidade são somadas juntas.
      </p>
    </div>
  );
}
