import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, MapPin, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadMyAccess } from "@/lib/platform-context";
import { useAuth, type AppRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { podeAcessarProducaoPorPessoa } from "@/lib/producao-por-pessoa-calc";
import { mesAtualRange } from "@/lib/producao-por-pessoa-filters";
import { brl } from "@/lib/exclusive-captures-dashboard";
import {
  agruparPorRegiao,
  filtrarVendas,
  montarVendas,
  type FiltrosRegiao,
  type VendaRegiao,
  type VendaRegiaoRow,
} from "@/lib/vendas-por-regiao";

const PAPEIS: AppRole[] = ["admin", "super_admin", "financeiro", "gestor", "team_leader"];

export const Route = createFileRoute("/_authenticated/vendas-por-regiao")({
  head: () => ({ meta: [{ title: "Vendas por região" }] }),
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { roles } = await loadMyAccess(session.user.id);
    if (!podeAcessarProducaoPorPessoa(roles)) {
      toast.error("Acesso não autorizado.");
      throw redirect({ to: "/dashboard" });
    }
  },
  component: VendasPorRegiaoPage,
});

const fmtData = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

function VendasPorRegiaoPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(PAPEIS);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [vendas, setVendas] = useState<VendaRegiao[]>([]);
  const [filtros, setFiltros] = useState<FiltrosRegiao>({ dataDe: "", dataAte: "", busca: "" });
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelado = false;
    setLoading(true);
    setErro(null);
    supabase
      .rpc("vendas_por_regiao" as never)
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) setErro(error.message);
        else setVendas(montarVendas((data ?? []) as unknown as VendaRegiaoRow[]));
      })
      .then(
        () => !cancelado && setLoading(false),
        () => !cancelado && setLoading(false),
      );
    return () => {
      cancelado = true;
    };
  }, [allowed]);

  const filtradas = useMemo(() => filtrarVendas(vendas, filtros), [vendas, filtros]);
  const cidades = useMemo(() => agruparPorRegiao(filtradas), [filtradas]);
  const totalVgv = filtradas.reduce((s, v) => s + v.vgv, 0);
  const semEndereco = filtradas.filter((v) => !v.bairro || !v.cidade).length;

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
    return <div className="p-8 text-center text-muted-foreground">Carregando…</div>;
  if (!allowed)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a administradores, financeiro, gestores e Team Leaders.
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vendas por região</h1>
          <p className="text-sm text-muted-foreground print:hidden">
            Onde os imóveis vendidos estão: quantidade e VGV por cidade e bairro. Clique num bairro
            para ver as vendas.
          </p>
        </div>
        <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Imprimir / baixar
        </Button>
      </div>

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
            <Label>Buscar endereço, bairro ou cidade</Label>
            <Input
              placeholder="Ex.: Campolim, Rua Antônio Perez, Votorantim"
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Vendas</div>
            <div className="text-2xl font-semibold">{filtradas.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">VGV</div>
            <div className="text-2xl font-semibold">{brl(totalVgv)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Sem bairro ou cidade</div>
            <div className="text-2xl font-semibold">{semEndereco}</div>
          </CardContent>
        </Card>
      </div>

      {cidades.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma venda encontrada com esses filtros.
          </CardContent>
        </Card>
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
        Financeiro); canceladas e arquivadas ficam de fora. Grafias diferentes do mesmo bairro ou
        cidade são somadas juntas. Vendas sem bairro ou cidade aparecem separadas até alguém
        completar o endereço.
      </p>
    </div>
  );
}
