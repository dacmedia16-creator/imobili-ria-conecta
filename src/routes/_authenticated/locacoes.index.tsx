import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Clock, FileSignature, KeyRound, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, KpiTile, ListSkeleton, PageHeader, Pill } from "@/components/visual/base";
import { AConfirmar } from "@/components/locacao/LocacaoDetalhe";
import { LocacaoRegras } from "@/components/locacao/LocacaoRegras";
import { errorMessage } from "@/lib/errors";
import {
  ETAPAS,
  GARANTIA_LABEL,
  MINUTA_LABEL,
  PAPEL_LABEL,
  brl,
  calcularComissao,
  dataBr,
  dataPagamento,
  diasParado,
  etapaLabel,
  lerContexto,
  lerLista,
  responsavelAtual,
  resumoPorEtapa,
  textoParado,
  titularidadePendente,
  tomParado,
  type ContextoLocacao,
  type EtapaLocacao,
  type Locacao,
} from "@/lib/locacao";
import { contextoLocacao, criarLocacao, guardLocacaoRoute, listarLocacoes } from "@/lib/locacao-db";

// Módulo de Locação Fase 1 (t_74426f94; maquete aprovada por Denis em 09/11/2026). Tudo atrás do módulo
// "locacao"; o banco decide o que cada papel vê e faz.
export const Route = createFileRoute("/_authenticated/locacoes/")({
  head: () => ({ meta: [{ title: "Locação" }] }),
  beforeLoad: guardLocacaoRoute,
  component: LocacoesPage,
});

type Aba = "minhas" | "gestora" | "contratos" | "pos" | "comissao" | "visao" | "regras";

function LocacoesPage() {
  const navigate = useNavigate();
  const [lista, setLista] = useState<Locacao[] | null>(null);
  const [ctx, setCtx] = useState<ContextoLocacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([listarLocacoes(), contextoLocacao()]);
      setLista(lerLista(l));
      setCtx(lerContexto(c));
      setErro(null);
    } catch (e) {
      setErro(errorMessage(e, "Não foi possível carregar as locações."));
    }
  }, []);
  useEffect(() => void carregar(), [carregar]);

  const abaPadrao: Aba = useMemo(() => {
    if (!ctx) return "minhas";
    if (ctx.papeis.includes("gestora")) return "gestora";
    if (ctx.papeis.includes("contratos")) return "contratos";
    if (ctx.papeis.includes("vistoria")) return "pos";
    return "minhas";
  }, [ctx]);

  if (erro) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{erro}</p>
        <Button variant="outline" onClick={() => void carregar()}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  if (!lista || !ctx) return <ListSkeleton />;

  const nova = async () => {
    setCriando(true);
    try {
      const { id } = await criarLocacao();
      await navigate({ to: "/locacoes/$id", params: { id } });
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível criar a locação."));
    } finally {
      setCriando(false);
    }
  };

  const ativas = lista.filter((l) => l.situacao === "ativa");
  const minhas = ativas.filter((l) => l.corretorId === ctx.usuarioId);
  const naEtapa = (...e: EtapaLocacao[]) => ativas.filter((l) => e.includes(l.etapa));
  const vePapel = (p: "gestora" | "contratos" | "vistoria") =>
    ctx.papeis.includes(p) || ctx.gerencia;
  const atual = aba ?? abaPadrao;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={KeyRound}
        title="Locação"
        description="Esteira da locação igual à da venda: o corretor preenche e sobe tudo; nada é enviado ao cliente."
        actions={
          <Button onClick={() => void nova()} disabled={criando}>
            <Plus className="mr-1 h-4 w-4" /> Nova locação
          </Button>
        }
      />
      <Tabs value={atual} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="minhas">Minhas locações ({minhas.length})</TabsTrigger>
          {vePapel("gestora") && (
            <TabsTrigger value="gestora">
              Gestora ({naEtapa("aprovacao", "conferencia").length})
            </TabsTrigger>
          )}
          {vePapel("contratos") && (
            <TabsTrigger value="contratos">
              Contratos ({naEtapa("minuta", "assinatura").length})
            </TabsTrigger>
          )}
          {vePapel("vistoria") && (
            <TabsTrigger value="pos">
              Pós-assinatura e chaves ({naEtapa("pos_assinatura", "chaves").length})
            </TabsTrigger>
          )}
          {ctx.veComissao && <TabsTrigger value="comissao">Comissão</TabsTrigger>}
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          {ctx.gerencia && <TabsTrigger value="regras">Regras e papéis</TabsTrigger>}
        </TabsList>

        <TabsContent value="minhas">
          <Tabela
            itens={minhas}
            ctx={ctx}
            vazio="Você ainda não tem locações. Clique em “Nova locação”."
          />
        </TabsContent>
        <TabsContent value="gestora" className="space-y-4">
          <Fila titulo="Pré-análises aguardando" itens={naEtapa("aprovacao")} />
          <Fila titulo="Documentações para conferir" itens={naEtapa("conferencia")} />
        </TabsContent>
        <TabsContent value="contratos">
          <Fila titulo="Minutas e assinaturas" itens={naEtapa("minuta", "assinatura")} />
        </TabsContent>
        <TabsContent value="pos">
          <Fila
            titulo="Pós-assinatura e entrega das chaves"
            itens={naEtapa("pos_assinatura", "chaves")}
            pos
          />
        </TabsContent>
        <TabsContent value="comissao">
          <Comissao itens={ativas.filter((l) => l.etapa === "comissao" && l.chaveEm)} ctx={ctx} />
        </TabsContent>
        <TabsContent value="visao">
          <Visao itens={ativas} ctx={ctx} />
        </TabsContent>
        <TabsContent value="regras">
          {ctx.gerencia && <LocacaoRegras config={ctx.config} onSalvo={() => void carregar()} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Parado({ l }: { l: Locacao }) {
  const d = diasParado(l.etapaDesde);
  return <Pill tom={tomParado(d)}>parado {textoParado(d)}</Pill>;
}

function EtapaPill({ l }: { l: Locacao }) {
  const extra =
    l.etapa === "minuta" && l.minuta.estado
      ? ` · ${MINUTA_LABEL[l.minuta.estado] ?? l.minuta.estado}`
      : "";
  return (
    <Pill tom={l.devolvida ? "amber" : l.etapa === "comissao" ? "green" : "blue"}>
      {etapaLabel(l.etapa)}
      {l.devolvida ? " · devolvida" : ""}
      {extra}
    </Pill>
  );
}

function Tabela({ itens, ctx, vazio }: { itens: Locacao[]; ctx: ContextoLocacao; vazio: string }) {
  if (!itens.length) return <EmptyState icon={KeyRound}>{vazio}</EmptyState>;
  return (
    <Card>
      <CardContent className="overflow-x-auto pt-4">
        <table className="w-full text-sm" data-testid="locacao-lista">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">Locação</th>
              <th>Candidato</th>
              <th>Imóvel</th>
              <th>Etapa</th>
              <th>Com quem</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {itens.map((l) => (
              <tr key={l.id} className="border-t align-top">
                <td className="py-2">
                  <Link
                    to="/locacoes/$id"
                    params={{ id: l.id }}
                    className="font-medium text-primary underline"
                  >
                    {l.codigo}
                  </Link>
                </td>
                <td>{l.candidato.nome || <i className="text-muted-foreground">(nova)</i>}</td>
                <td className="max-w-[240px] text-xs">{l.endereco || "—"}</td>
                <td>
                  <EtapaPill l={l} />
                </td>
                <td className="text-xs">{responsavelAtual(l, ctx.pessoas)}</td>
                <td>
                  <Parado l={l} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Fila({ titulo, itens, pos }: { titulo: string; itens: Locacao[]; pos?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {titulo} <Pill tom="blue">{itens.length}</Pill>
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {!itens.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1">Locação</th>
                <th>Candidato</th>
                <th>Corretor</th>
                <th>{pos ? "Vistoria · Seguro · Titularidade" : "Valores"}</th>
                <th>Etapa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((l) => (
                <tr key={l.id} className="border-t align-top">
                  <td className="py-2">
                    <Link
                      to="/locacoes/$id"
                      params={{ id: l.id }}
                      className="font-medium text-primary underline"
                    >
                      {l.codigo}
                    </Link>
                  </td>
                  <td>{l.candidato.nome}</td>
                  <td className="text-xs">{l.corretorNome}</td>
                  <td className="text-xs">
                    {pos ? (
                      <>
                        {l.pos.laudoEm
                          ? "laudo ok"
                          : l.pos.vistoriaPedida
                            ? "vistoria pedida"
                            : "vistoria pendente"}{" "}
                        · {l.pos.seguroEm ? "seguro ✅" : "seguro ⬜"} ·{" "}
                        {titularidadePendente(l.pos.tit).length ? "⚠️ protocolo" : "✅"}
                      </>
                    ) : (
                      <>
                        {brl(l.aluguel)} · {GARANTIA_LABEL[l.garantia]}
                        {l.etapa === "minuta" || l.etapa === "assinatura"
                          ? ` · ${l.tipo === "comercial" ? "Comercial" : "Residencial"}`
                          : ""}
                        {l.minuta.externa ? " · outra RE/MAX" : ""}
                      </>
                    )}
                  </td>
                  <td>
                    <EtapaPill l={l} />
                  </td>
                  <td>
                    <Parado l={l} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function Comissao({ itens, ctx }: { itens: Locacao[]; ctx: ContextoLocacao }) {
  const meses = useMemo(
    () => [...new Set(itens.map((l) => (l.chaveEm ?? "").slice(0, 7)))].sort(),
    [itens],
  );
  const [mes, setMes] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const m = mes && meses.includes(mes) ? mes : meses[meses.length - 1];
  const doMes = itens.filter((l) => (l.chaveEm ?? "").startsWith(m ?? "--"));
  const linhas = doMes.map((l) => ({ l, r: calcularComissao(l, ctx.config) }));
  const tot = linhas.reduce(
    (a, x) => ({ c: a.c + x.r.corretor, co: a.co + x.r.coordenador, pa: a.pa + x.r.parceiro }),
    { c: 0, co: 0, pa: 0 },
  );
  const s = linhas.find((x) => x.l.id === sel) ?? linhas[0];
  if (!meses.length) return <EmptyState icon={KeyRound}>Nenhuma chave entregue ainda.</EmptyState>;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="mes-com">Mês da entrega das chaves:</label>
            <select
              id="mes-com"
              className="h-9 rounded-md border bg-background px-2"
              value={m}
              onChange={(e) => setMes(e.target.value)}
            >
              {meses.map((x) => (
                <option key={x} value={x}>
                  {x.split("-").reverse().join("/")}
                </option>
              ))}
            </select>
            <span className="flex-1" />
            <Pill tom="blue">Corretores {brl(tot.c)}</Pill>
            <Pill tom="slate">Coordenadores {brl(tot.co)}</Pill>
            <Pill tom="slate">Parceiros {brl(tot.pa)}</Pill>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="locacao-comissao">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1">Locação</th>
                  <th>Corretor / coord.</th>
                  <th>Chave</th>
                  <th>1º aluguel</th>
                  <th>Taxa → %</th>
                  <th>Corretor</th>
                  <th>
                    Coord. <AConfirmar />
                  </th>
                  <th>
                    Parceria <AConfirmar />
                  </th>
                  <th>
                    Pagamento <AConfirmar />
                  </th>
                  <th>Titularidade</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ l, r }) => {
                  const pend = titularidadePendente(l.pos.tit);
                  return (
                    <tr
                      key={l.id}
                      className={`cursor-pointer border-t ${s?.l.id === l.id ? "bg-muted/50" : ""}`}
                      onClick={() => setSel(l.id)}
                    >
                      <td className="py-2">
                        <b>{l.codigo}</b>
                        <div className="text-xs text-muted-foreground">{l.candidato.nome}</div>
                      </td>
                      <td className="text-xs">
                        {l.corretorNome}
                        <div className="text-muted-foreground">{l.coordenadorNome ?? "—"}</div>
                      </td>
                      <td>{dataBr(l.chaveEm)}</td>
                      <td>{brl(l.aluguel)}</td>
                      <td>
                        {l.taxaAdm}% → {r.pct}%
                      </td>
                      <td>
                        <b>{brl(r.corretor)}</b>
                      </td>
                      <td>{brl(r.coordenador)}</td>
                      <td>{l.parceria ? brl(r.parceiro) : "—"}</td>
                      <td>{dataBr(dataPagamento(l.chaveEm, ctx.config))}</td>
                      <td>
                        {pend.length ? (
                          <Pill tom="amber">⚠️ falta {pend.join(", ")}</Pill>
                        ) : (
                          <Pill tom="green">ok</Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {s && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cálculo — {s.l.codigo}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full max-w-2xl text-sm">
              <tbody className="[&_td]:py-1 [&_td:last-child]:text-right">
                <tr>
                  <td>1º aluguel</td>
                  <td>{brl(s.l.aluguel)}</td>
                </tr>
                <tr>
                  <td>Taxa de administração negociada</td>
                  <td>{s.l.taxaAdm}%</td>
                </tr>
                <tr>
                  <td>% do 1º aluguel (tabela da imobiliária)</td>
                  <td>{s.r.pct}%</td>
                </tr>
                {s.l.parceria && ctx.config.parceriaDividePorDois && (
                  <tr>
                    <td>
                      Parceria: base = aluguel ÷ 2 <AConfirmar />
                    </td>
                    <td>{brl(s.r.base)}</td>
                  </tr>
                )}
                <tr className="border-t">
                  <td>
                    <b>Comissão do lado da casa</b> = {brl(s.r.base)} × {s.r.pct}%
                  </td>
                  <td>
                    <b>{brl(s.r.totalLado)}</b>
                  </td>
                </tr>
                <tr>
                  <td>
                    Coordenador {ctx.config.pctCoordenador}% (
                    {s.l.coordenadorNome ?? "sem coordenador vinculado"}) <AConfirmar />
                  </td>
                  <td>{brl(s.r.coordenador)}</td>
                </tr>
                <tr className="border-t">
                  <td>
                    <b>Corretor</b> ({s.l.corretorNome})
                  </td>
                  <td>
                    <b>{brl(s.r.corretor)}</b>
                  </td>
                </tr>
                {s.l.parceria && (
                  <tr>
                    <td>
                      Parceiro (outra metade) <AConfirmar />
                    </td>
                    <td>{brl(s.r.parceiro)}</td>
                  </tr>
                )}
                <tr>
                  <td>
                    Chave em {dataBr(s.l.chaveEm)} → pagamento <AConfirmar />
                  </td>
                  <td>{dataBr(dataPagamento(s.l.chaveEm, ctx.config))}</td>
                </tr>
              </tbody>
            </table>
            {titularidadePendente(s.l.pos.tit).length > 0 && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                ⚠️ <b>Alerta (não bloqueia):</b> troca de titularidade sem protocolo de{" "}
                {titularidadePendente(s.l.pos.tit).join(", ")}. A comissão segue normalmente; o
                aviso fica para o corretor e a gestora.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Só cálculo para conferência. Nada é lançado no financeiro nesta fase.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Visao({ itens, ctx }: { itens: Locacao[]; ctx: ContextoLocacao }) {
  const andamento = itens.filter((l) => l.etapa !== "comissao");
  const resumo = resumoPorEtapa(itens);
  const maxDias = Math.max(1, ...resumo.map((r) => r.maxDias));
  const porResp = new Map<string, Locacao[]>();
  for (const l of andamento) {
    const r = responsavelAtual(l, ctx.pessoas);
    porResp.set(r, [...(porResp.get(r) ?? []), l]);
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Em andamento" value={andamento.length} icon={KeyRound} />
        <KpiTile
          label="Paradas há mais de 5 dias"
          value={andamento.filter((l) => diasParado(l.etapaDesde) > 5).length}
          icon={AlertTriangle}
          tom="red"
        />
        <KpiTile
          label="Minutas em ajuste"
          value={itens.filter((l) => l.etapa === "minuta" && l.minuta.estado === "ajuste").length}
          icon={FileSignature}
          tom="amber"
        />
        <KpiTile
          label="Devolvidas ao corretor"
          value={andamento.filter((l) => l.devolvida).length}
          icon={Clock}
          tom="amber"
        />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tempo parado por etapa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2" data-testid="locacao-visao-etapas">
          {resumo.map((r) => {
            const e = ETAPAS.find((x) => x.key === r.etapa)!;
            return (
              <div
                key={r.etapa}
                className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-3 text-sm"
              >
                <span>
                  {e.label}
                  <span className="block text-xs text-muted-foreground">
                    {PAPEL_LABEL[e.papel]}
                  </span>
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${r.maxDias > 5 ? "bg-red-500" : r.maxDias >= 3 ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${(r.maxDias / maxDias) * 100}%` }}
                  />
                </div>
                <span className="whitespace-nowrap text-xs">
                  {r.quantidade} · média {r.mediaDias}d · máx. {r.maxDias}d
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Por responsável
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[...porResp.entries()].map(([resp, ls]) => (
            <div key={resp} className="flex flex-wrap items-center gap-2 text-sm">
              <b className="min-w-[200px]">{resp}</b>
              {ls
                .sort((a, b) => diasParado(b.etapaDesde) - diasParado(a.etapaDesde))
                .map((l) => (
                  <Link key={l.id} to="/locacoes/$id" params={{ id: l.id }}>
                    <Pill tom={tomParado(diasParado(l.etapaDesde))}>
                      {l.codigo} · {etapaLabel(l.etapa)} · {textoParado(diasParado(l.etapaDesde))}
                    </Pill>
                  </Link>
                ))}
            </div>
          ))}
          {!porResp.size && (
            <p className="text-sm text-muted-foreground">Nenhuma locação em andamento.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
