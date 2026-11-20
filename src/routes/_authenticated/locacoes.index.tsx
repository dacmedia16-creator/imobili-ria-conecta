import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Clock,
  FileSignature,
  KeyRound,
  Lightbulb,
  Plus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, KpiTile, ListSkeleton, PageHeader, Pill } from "@/components/visual/base";
import { AConfirmar } from "@/components/locacao/LocacaoDetalhe";
import { LocacaoFinanceiro } from "@/components/locacao/LocacaoFinanceiro";
import { LocacaoRegras } from "@/components/locacao/LocacaoRegras";
import { LocacaoModelosContrato } from "@/components/locacao/LocacaoModelosContrato";
import { errorMessage } from "@/lib/errors";
import {
  ETAPAS,
  GARANTIA_LABEL,
  MINUTA_LABEL,
  PAPEL_LABEL,
  brl,
  IMOVEL_TIPO_LABEL,
  calcularComissao,
  dataBr,
  enderecoCompleto,
  equipeTexto,
  valoresParaComissao,
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
  type ImovelTipo,
  type Locacao,
} from "@/lib/locacao";
import {
  ajudaMaxLocacaoEnabled,
  contextoLocacao,
  criarLocacao,
  guardLocacaoRoute,
  listarLocacoes,
} from "@/lib/locacao-db";

// Módulo de Locação Fase 1 (t_74426f94; maquete aprovada por Denis em 09/11/2026). Tudo atrás do módulo
// "locacao"; o banco decide o que cada papel vê e faz.
export const Route = createFileRoute("/_authenticated/locacoes/")({
  head: () => ({ meta: [{ title: "Locação" }] }),
  beforeLoad: guardLocacaoRoute,
  component: LocacoesPage,
});

type Aba =
  | "minhas"
  | "gestora"
  | "contratos"
  | "pos"
  | "comissao"
  | "financeiro"
  | "visao"
  | "regras"
  | "modelos";

function LocacoesPage() {
  const navigate = useNavigate();
  const [lista, setLista] = useState<Locacao[] | null>(null);
  const [ctx, setCtx] = useState<ContextoLocacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba | null>(null);
  const [criando, setCriando] = useState(false);
  const [escolhendoTipo, setEscolhendoTipo] = useState(false);
  // t_8f09d406 item 5: filtro por equipe gravada na abertura ("" = todas).
  const [equipeFiltro, setEquipeFiltro] = useState("");

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
  // Ajuda MAX 2/2 (t_365484dc): atalho para "Sugestões e erros" só com a chave ligada (o banco confere).
  const [ajudaMax, setAjudaMax] = useState(false);
  useEffect(() => {
    void ajudaMaxLocacaoEnabled().then(setAjudaMax);
  }, []);

  const abaPadrao: Aba = useMemo(() => {
    if (!ctx) return "minhas";
    if (ctx.papeis.includes("gestora")) return "gestora";
    if (ctx.papeis.includes("contratos")) return "contratos";
    if (ctx.papeis.includes("vistoria")) return "pos";
    if (ctx.papeis.includes("financeiro") && !ctx.gerencia) return "financeiro";
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

  // t_8f09d406 item 2: o corretor escolhe o tipo do imóvel ao abrir a locação.
  const nova = async (tipo: ImovelTipo) => {
    setCriando(true);
    try {
      const { id } = await criarLocacao(tipo);
      setEscolhendoTipo(false);
      await navigate({ to: "/locacoes/$id", params: { id } });
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível criar a locação."));
    } finally {
      setCriando(false);
    }
  };

  const equipes = [
    ...new Set(lista.map((l) => l.equipe.nome).filter((x): x is string => !!x)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const ativas = lista
    .filter((l) => l.situacao === "ativa")
    .filter((l) => !equipeFiltro || l.equipe.nome === equipeFiltro);
  const minhas = ativas.filter((l) => l.corretorId === ctx.usuarioId);
  const naEtapa = (...e: EtapaLocacao[]) => ativas.filter((l) => e.includes(l.etapa));
  const vePapel = (p: "gestora" | "contratos" | "vistoria") =>
    ctx.papeis.includes(p) || ctx.gerencia;
  // Fase 2: quem só tem o papel Financeiro da locação vê apenas a aba Financeiro (o banco não lhe mostra a esteira).
  const veFinanceiro = ctx.papeis.includes("financeiro");
  const soFinanceiro =
    veFinanceiro && ctx.papeis.length === 1 && !ctx.gerencia && minhas.length === 0;
  const atual = soFinanceiro ? "financeiro" : (aba ?? abaPadrao);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={KeyRound}
        title="Locação"
        description="Esteira da locação igual à da venda: o corretor preenche e sobe tudo; nada é enviado ao cliente."
        actions={
          soFinanceiro && !ajudaMax ? undefined : (
            <div className="flex flex-wrap gap-2">
              {ajudaMax && (
                <Button variant="outline" asChild>
                  <Link to="/locacoes/sugestoes">
                    <Lightbulb className="mr-1 h-4 w-4" /> Sugestões e erros
                  </Link>
                </Button>
              )}
              {!soFinanceiro && (
                <Button onClick={() => setEscolhendoTipo(true)} disabled={criando}>
                  <Plus className="mr-1 h-4 w-4" /> Nova locação
                </Button>
              )}
            </div>
          )
        }
      />
      <Dialog open={escolhendoTipo} onOpenChange={(o) => !criando && setEscolhendoTipo(o)}>
        <DialogContent data-testid="locacao-nova-tipo">
          <DialogHeader>
            <DialogTitle>Nova locação — qual o tipo do imóvel?</DialogTitle>
            <DialogDescription>
              Condomínio pede a CND do condomínio (opcional). Comercial já vem com prazo de 36
              meses. Dá para trocar depois, ainda na pré-análise.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {(Object.keys(IMOVEL_TIPO_LABEL) as ImovelTipo[]).map((t) => (
              <Button
                key={t}
                variant="outline"
                className="justify-start"
                disabled={criando}
                onClick={() => void nova(t)}
              >
                {IMOVEL_TIPO_LABEL[t]}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {equipes.length > 0 && !soFinanceiro && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="filtro-equipe">Equipe:</label>
          <select
            id="filtro-equipe"
            data-testid="locacao-filtro-equipe"
            className="h-9 rounded-md border bg-background px-2"
            value={equipeFiltro}
            onChange={(e) => setEquipeFiltro(e.target.value)}
          >
            <option value="">Todas</option>
            {equipes.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
      )}
      <Tabs value={atual} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList className="flex h-auto flex-wrap">
          {!soFinanceiro && (
            <TabsTrigger value="minhas">Minhas locações ({minhas.length})</TabsTrigger>
          )}
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
          {veFinanceiro && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
          {!soFinanceiro && <TabsTrigger value="visao">Visão geral</TabsTrigger>}
          {ctx.gerencia && <TabsTrigger value="regras">Regras e papéis</TabsTrigger>}
          {(ctx.gerencia || vePapel("contratos")) && (
            <TabsTrigger value="modelos">Modelos de contrato</TabsTrigger>
          )}
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
        <TabsContent value="financeiro">{veFinanceiro && <LocacaoFinanceiro />}</TabsContent>
        <TabsContent value="visao">
          <Visao itens={ativas} ctx={ctx} />
        </TabsContent>
        <TabsContent value="regras">
          {ctx.gerencia && <LocacaoRegras config={ctx.config} onSalvo={() => void carregar()} />}
        </TabsContent>
        <TabsContent value="modelos">
          {(ctx.gerencia || vePapel("contratos")) && <LocacaoModelosContrato />}
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
        <table className="w-full min-w-[720px] text-sm" data-testid="locacao-lista">
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
                <td className="max-w-[240px] text-xs">
                  {enderecoCompleto(l.endereco, l.complemento) || "—"}
                </td>
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

/** Equipe gravada na abertura + Gestor e Team Leader (t_8f09d406 item 5). */
function EquipeLinha({ l }: { l: Locacao }) {
  const e = l.equipe;
  return (
    <div className="text-muted-foreground" data-testid="locacao-equipe-linha">
      {equipeTexto(e)}
      {e.gravadaEm && (e.gestorNome || e.teamLeaderNome) && (
        <span className="block">
          Gestor: {e.gestorNome ?? "—"} · TL: {e.teamLeaderNome ?? "—"}
        </span>
      )}
    </div>
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
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1">Locação</th>
                <th>Candidato</th>
                <th>Corretor · equipe</th>
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
                  <td className="text-xs">
                    {l.corretorNome}
                    <EquipeLinha l={l} />
                  </td>
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
  // t_8f09d406 item 6: com lançamento da Fernanda, valem os valores lançados (ver valoresParaComissao).
  const linhas = doMes.map((l) => {
    const v = valoresParaComissao(l);
    return { l, v, r: calcularComissao(v, ctx.config) };
  });
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
            <table className="w-full min-w-[960px] text-sm" data-testid="locacao-comissao">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1">Locação</th>
                  <th>Corretor / equipe</th>
                  <th>Chave</th>
                  <th>1º aluguel</th>
                  <th>Taxa → %</th>
                  <th>Corretor</th>
                  <th>
                    Coord. <AConfirmar />
                  </th>
                  <th>
                    Parceiro (½ aluguel)
                  </th>
                  <th>
                    Pagamento <AConfirmar />
                  </th>
                  <th>Titularidade</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ l, v, r }) => {
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
                        <EquipeLinha l={l} />
                      </td>
                      <td>{dataBr(l.chaveEm)}</td>
                      <td>
                        {brl(v.aluguel)}
                        {v.lancado && <div className="text-xs text-muted-foreground">lançado</div>}
                      </td>
                      <td>
                        {v.taxaAdm}% → {r.pct}%
                      </td>
                      <td>
                        <b>{brl(r.corretor)}</b>
                      </td>
                      <td>{brl(r.coordenador)}</td>
                      <td>{v.parceria ? brl(r.parceiro) : "—"}</td>
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
                  <td>
                    1º aluguel{" "}
                    {s.v.lancado ? "(lançamento da vistoria)" : "(pré-análise; sem lançamento)"}
                  </td>
                  <td>{brl(s.v.aluguel)}</td>
                </tr>
                <tr>
                  <td>Taxa de administração negociada</td>
                  <td>{s.v.taxaAdm}%</td>
                </tr>
                <tr>
                  <td>% do 1º aluguel (tabela da imobiliária)</td>
                  <td>{s.r.pct}%</td>
                </tr>
                {s.v.parceria && ctx.config.parceriaDividePorDois && (
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
                {s.v.parceria && (
                  <tr>
                    <td>
                      Parceiro (metade de 1 aluguel)
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
