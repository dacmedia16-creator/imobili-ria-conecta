import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Inbox, KanbanSquare, Plus, Trophy, Users, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ListSkeleton, PageHeader, Pill, TOM_PILL } from "@/components/visual/base";
import { gruposDaFila, tituloHoje } from "@/lib/telas-lote1";
import {
  contarSituacoes,
  filtrarQuadro,
  filtroAtivo,
  FILTRO_VAZIO,
  origensPresentes,
  type FiltroQuadro,
  type Situacao,
} from "@/lib/telas-lote2";
import { LeadDetalhe } from "@/components/leads/LeadDetalhe";
import { NovoLeadDialog } from "@/components/leads/NovoLeadDialog";
import { CrmQuadro } from "@/components/crm/CrmQuadro";
import { CrmMoverDialog, type PedidoMover } from "@/components/crm/CrmMoverDialog";
import {
  aguardandoMeuAceite,
  CONFIG_PADRAO,
  ORIGEM_LABEL,
  type CapturaOpcao,
  type Lead,
  type LeadConfig,
  type MotivoPerda,
  type Origem,
  type Pessoa,
} from "@/lib/leads";
import { carregarOpcoes, lerConfig, listarMotivos } from "@/lib/leads-db";
import { exclusiveEnabled, listUnits } from "@/lib/exclusive-captures-db";
import type { ExclusiveUnit } from "@/lib/exclusive-captures";
import {
  diaMes,
  FUNIL,
  FUNIS,
  filaDoDia,
  funilDe,
  hojeSP,
  nomeEtapa,
  pedidoAoMover,
  type Etapa,
  type Funil,
} from "@/lib/crm";
import { definirFunil, listarLeadsCrm } from "@/lib/crm-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-ring";

// Texto do botão "É …? Trocar de funil" para cada funil de destino.
const TROCA_TXT: Record<Funil, string> = {
  venda: "comprador (Venda)",
  captacao: "proprietário (Captação)",
  locacao: "locação (Locação)",
};

type Pedido = PedidoMover | { lead: Lead; para: null; tipo: "proximo" } | null;

/**
 * CRM com três funis (Venda, Captação e Locação — t_d4c8b724) e fila do dia. Individual para todos os papéis (Denis 24/11,
 * t_b855dbb8): só os leads em que o usuário é o responsável. Visão de equipe fica no painel Leads.
 */
export function CrmPagina() {
  const { user, hasAny } = useAuth();
  const gestor = hasAny(["admin", "super_admin", "gestor"]);
  const meuId = user?.id;
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [capturas, setCapturas] = useState<CapturaOpcao[]>([]);
  const [motivos, setMotivos] = useState<MotivoPerda[]>([]);
  const [config, setConfig] = useState<LeadConfig>(CONFIG_PADRAO);
  const [captacaoLigada, setCaptacaoLigada] = useState(false);
  const [unidades, setUnidades] = useState<ExclusiveUnit[]>([]);
  const [aba, setAba] = useState<string>("venda");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Pedido>(null);
  const [novo, setNovo] = useState(false);
  const [busy, setBusy] = useState(false);
  // Filtros rápidos por funil (t_29b7cd5e): só filtram o que já veio da mesma consulta.
  const [filtros, setFiltros] = useState<Record<Funil, FiltroQuadro>>({
    venda: FILTRO_VAZIO,
    captacao: FILTRO_VAZIO,
    locacao: FILTRO_VAZIO,
  });
  const mudarFiltro = (f: Funil, novo: Partial<FiltroQuadro>) =>
    setFiltros((atual) => ({ ...atual, [f]: { ...atual[f], ...novo } }));
  const hoje = hojeSP();

  const carregar = useCallback(async () => {
    if (!meuId) return; // login ainda carregando: mantém o esqueleto
    try {
      setLeads(await listarLeadsCrm(meuId));
    } catch (e) {
      setLeads([]);
      toast.error(errorMessage(e, "Não foi possível carregar os leads."));
    }
  }, [meuId]);

  useEffect(() => {
    void carregar();
    carregarOpcoes()
      .then((o) => {
        setPessoas(o.responsaveis);
        setCapturas(o.capturas);
      })
      .catch(() => undefined);
    listarMotivos()
      .then(setMotivos)
      .catch(() => undefined);
    lerConfig()
      .then(setConfig)
      .catch(() => undefined);
    exclusiveEnabled()
      .then((on) => {
        setCaptacaoLigada(on);
        if (on)
          void listUnits()
            .then(setUnidades)
            .catch(() => undefined);
      })
      .catch(() => undefined);
  }, [carregar]);

  const nomeDe = useCallback(
    (id: string | null) =>
      id ? (pessoas.find((p) => p.id === id)?.nome ?? "Pessoa") : "Sem responsável",
    [pessoas],
  );
  const doFunil = (f: Funil) => (leads ?? []).filter((l) => funilDe(l) === f);
  const fila = useMemo(() => filaDoDia(leads ?? [], hoje, user?.id), [leads, hoje, user?.id]);
  const grupos = useMemo(() => gruposDaFila(fila), [fila]);
  const aberto = leads?.find((l) => l.id === abertoId) ?? null;

  const podeMexer = (l: Lead) =>
    !aguardandoMeuAceite(l, user?.id) &&
    (gestor || l.responsavel_id === user?.id) &&
    (gestor || (l.etapa !== "ganho" && l.etapa !== "perdido"));

  const pedirMover = (l: Lead, para: Etapa) => {
    const p = pedidoAoMover(l, para, {
      gestor,
      aguardandoAceite: aguardandoMeuAceite(l, user?.id),
    });
    if (p === "nada") return;
    if (p === "bloqueado") {
      toast.error(
        aguardandoMeuAceite(l, user?.id)
          ? "Aceite o lead antes de movê-lo."
          : "Este lead não pode ir para essa etapa.",
      );
      return;
    }
    setPedido({ lead: l, para, tipo: p });
  };

  const trocarFunil = async (l: Lead, f: Funil) => {
    setBusy(true);
    try {
      await definirFunil(l.id, f);
      toast.success(`Lead movido para o ${FUNIL[f].nome}.`);
      await carregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível trocar o funil."));
    } finally {
      setBusy(false);
    }
  };

  const blocoCrm = (l: Lead) => {
    const f = funilDe(l);
    const mexe = podeMexer(l);
    const aberta = l.etapa !== "ganho" && l.etapa !== "perdido";
    const convertido = l.sale_id || l.capture_convertida_id;
    return (
      <section className="space-y-2 rounded-lg border p-3">
        <h3 className="font-medium">CRM · {FUNIL[f].nome}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tom="slate">{nomeEtapa(f, l.etapa as Etapa)}</Pill>
          {convertido && (
            <Pill tom="green">{l.sale_id ? "Venda vinculada" : "Captação vinculada"}</Pill>
          )}
        </div>
        {aberta && (
          <p className={l.proximo_contato_em ? "" : "font-medium text-red-700 dark:text-red-300"}>
            Próximo contato:{" "}
            {l.proximo_contato_em
              ? `${diaMes(l.proximo_contato_em)} — ${l.proximo_contato_motivo ?? ""}`
              : "sem próximo passo"}
          </p>
        )}
        {mexe && (
          <div className="space-y-2">
            {aberta && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPedido({ lead: l, para: null, tipo: "proximo" })}
              >
                {l.proximo_contato_em ? "Remarcar próximo contato" : "Definir próximo contato"}
              </Button>
            )}
            <select
              className={SELECT}
              value=""
              onChange={(e) => e.target.value && pedirMover(l, e.target.value as Etapa)}
              aria-label="Mover para"
            >
              <option value="">Mover para…</option>
              {FUNIL[f].etapas
                .filter((e) => e !== l.etapa)
                .map((e) => (
                  <option key={e} value={e}>
                    {nomeEtapa(f, e)}
                  </option>
                ))}
            </select>
            {!convertido &&
              l.etapa !== "perdido" &&
              (f === "venda" || (f === "captacao" && captacaoLigada)) && (
                <Button
                  size="sm"
                  onClick={() => setPedido({ lead: l, para: "ganho", tipo: "fechar" })}
                >
                  {FUNIL[f].conv}
                </Button>
              )}
            {(l.etapa === "novo" || l.etapa === "em_atendimento") &&
              FUNIS.filter((o) => o !== f).map((o) => (
                <Button
                  key={o}
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void trocarFunil(l, o)}
                >
                  É {TROCA_TXT[o]}? Trocar de funil
                </Button>
              ))}
          </div>
        )}
      </section>
    );
  };

  const SITUACOES: { valor: Situacao; rotulo: string }[] = [
    { valor: "todos", rotulo: "Todos" },
    { valor: "atrasados", rotulo: "Atrasados" },
    { valor: "sem", rotulo: "Sem próximo passo" },
  ];

  const quadro = (f: Funil) => {
    const todos = doFunil(f);
    const filtro = filtros[f];
    const conta = contarSituacoes(todos, filtro.origem, hoje);
    const origens = origensPresentes(todos);
    const filtrados = filtrarQuadro(todos, filtro, hoje);
    return (
      <TabsContent value={f} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {FUNIL[f].nome}: leads de {FUNIL[f].publico}. Arraste o cartão para mudar de etapa (no
          celular: segure o cartão ou use “Mover para…” no lead). Vermelho = sem próximo passo ou
          atrasado.
        </p>
        {/* Filtros rápidos (t_29b7cd5e). Cor + texto + número, como no resto do ADM MAX. */}
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filtros rápidos"
          data-testid={`crm-filtros-${f}`}
        >
          {SITUACOES.map((o) => {
            const ativo = filtro.situacao === o.valor;
            const n = conta[o.valor];
            const alerta = o.valor !== "todos" && n > 0;
            return (
              <button
                key={o.valor}
                type="button"
                aria-pressed={ativo}
                data-testid={`crm-filtro-${f}-${o.valor}`}
                onClick={() => mudarFiltro(f, { situacao: o.valor })}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  ativo
                    ? alerta
                      ? TOM_PILL.red + " ring-1 ring-rose-500/40"
                      : "border-primary bg-primary text-primary-foreground"
                    : alerta
                      ? "border-rose-500/30 bg-background text-rose-700 hover:bg-rose-500/5 dark:text-rose-300"
                      : "bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.rotulo}
                <span className="tabular-nums opacity-80">{n}</span>
              </button>
            );
          })}
          <select
            className="h-8 rounded-full border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            value={filtro.origem}
            onChange={(e) => mudarFiltro(f, { origem: e.target.value as Origem | "" })}
            aria-label="Filtrar por origem"
            data-testid={`crm-filtro-${f}-origem`}
            disabled={origens.length === 0}
          >
            <option value="">Todas as origens</option>
            {origens.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
          {filtroAtivo(filtro) && (
            <button
              type="button"
              onClick={() => mudarFiltro(f, FILTRO_VAZIO)}
              className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              data-testid={`crm-filtro-${f}-limpar`}
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Limpar filtros
              <span className="sr-only">
                (mostrando {filtrados.length} de {todos.length})
              </span>
            </button>
          )}
          {filtroAtivo(filtro) && (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              Mostrando {filtrados.length} de {todos.length}
            </span>
          )}
        </div>
        {leads === null ? (
          <ListSkeleton />
        ) : (
          <CrmQuadro
            funil={f}
            leads={filtrados}
            hoje={hoje}
            nomeDe={nomeDe}
            mostrarDono={false}
            podeArrastar={podeMexer}
            onSoltar={pedirMover}
            onOpen={(l) => setAbertoId(l.id)}
          />
        )}
      </TabsContent>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={KanbanSquare}
        title="CRM"
        description="Funil de Venda (compradores), Funil de Captação (proprietários) e Funil de Locação (aluguel). Todo lead em andamento precisa de um próximo contato."
        actions={
          gestor ? (
            <Button onClick={() => setNovo(true)} className="max-sm:h-9 max-sm:w-9 max-sm:p-0">
              <Plus className="h-4 w-4 sm:mr-1" aria-hidden />
              <span className="max-sm:sr-only">Novo lead</span>
            </Button>
          ) : undefined
        }
      />

      <Tabs value={aba} onValueChange={setAba}>
        {/* Celular (t_d97f306e, item 9): nomes curtos e contador pequeno, as 4 abas numa linha. */}
        <TabsList className="grid h-auto w-full grid-cols-4 sm:flex sm:w-auto sm:flex-wrap sm:justify-start">
          {(
            [
              { v: "venda", longo: "Funil de Venda", curto: "Venda", n: doFunil("venda").length },
              {
                v: "captacao",
                longo: "Funil de Captação",
                curto: "Captação",
                n: doFunil("captacao").length,
              },
              {
                v: "locacao",
                longo: "Funil de Locação",
                curto: "Locação",
                n: doFunil("locacao").length,
              },
              { v: "fila", longo: "Minha fila do dia", curto: "Fila", n: fila.length },
            ] as const
          ).map((a) => (
            <TabsTrigger
              key={a.v}
              value={a.v}
              aria-label={`${a.longo} (${a.n})`}
              className="gap-1 px-1.5 text-xs sm:px-3 sm:text-sm"
            >
              <span className="sm:hidden">{a.curto}</span>
              <span className="max-sm:hidden">{a.longo}</span>
              <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground sm:text-[11px]">
                {a.n}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {quadro("venda")}
        {quadro("captacao")}
        {quadro("locacao")}

        <TabsContent value="fila" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight" data-testid="fila-titulo">
              {tituloHoje(hoje)}
            </h2>
            <p className="text-xs text-muted-foreground">
              Ordem: aceite → atrasados → sem próximo passo → para hoje.
            </p>
          </div>
          {leads === null ? (
            <ListSkeleton />
          ) : (
            <>
              {/* Contadores dos 4 grupos, com cor + texto (regra de Denis). Fila vazia: só o estado vazio. */}
              {fila.length > 0 && (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="fila-contadores">
                  {grupos.map((g) => (
                    <li key={g.motivo}>
                      <a
                        href={`#fila-${g.motivo}`}
                        onClick={(e) => {
                          if (!g.total) e.preventDefault();
                        }}
                        aria-disabled={!g.total}
                        className={`flex h-full flex-col rounded-lg border p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          g.total
                            ? `${TOM_PILL[g.tom]} hover:shadow-sm`
                            : "bg-card text-muted-foreground"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{g.titulo}</span>
                          <span className="text-2xl font-semibold tabular-nums">{g.total}</span>
                        </span>
                        <span className="mt-0.5 text-xs opacity-90">
                          {g.total ? g.explica : "Nada aqui."}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {fila.length === 0 ? (
                <EmptyState
                  icon={Trophy}
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      {gestor && (
                        <Button size="sm" onClick={() => setNovo(true)}>
                          <Plus className="mr-1 h-4 w-4" /> Novo lead
                        </Button>
                      )}
                      <Button size="sm" variant="outline" asChild>
                        <Link to={gestor ? "/painel-leads" : "/meus-leads"} hash="banco">
                          <Inbox className="mr-1 h-4 w-4" /> Ver Banco da imobiliária
                        </Link>
                      </Button>
                    </div>
                  }
                >
                  {(leads ?? []).length === 0
                    ? "Você ainda não tem leads no CRM. Pegue um no Banco da imobiliária para começar."
                    : "Tudo em dia: nenhum lead pendente para hoje."}
                </EmptyState>
              ) : (
                grupos
                  .filter((g) => g.total > 0)
                  .map((g) => (
                    <section
                      key={g.motivo}
                      id={`fila-${g.motivo}`}
                      className="scroll-mt-4 space-y-1.5"
                      aria-labelledby={`fila-${g.motivo}-titulo`}
                      data-testid={`fila-grupo-${g.motivo}`}
                    >
                      <h3
                        id={`fila-${g.motivo}-titulo`}
                        className="flex items-center gap-2 text-sm font-semibold"
                      >
                        <Pill tom={g.tom}>{g.titulo}</Pill>
                        <span className="tabular-nums text-muted-foreground">{g.total}</span>
                      </h3>
                      <ul className="divide-y rounded-lg border bg-card">
                        {g.itens.map(({ lead: l, motivo }) => {
                          const f = funilDe(l);
                          return (
                            <li
                              key={l.id}
                              className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                            >
                              <button
                                type="button"
                                className="min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => setAbertoId(l.id)}
                                aria-label={`Abrir lead ${l.nome}`}
                              >
                                <div className="truncate font-medium">{l.nome}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {FUNIL[f].nome} · {nomeEtapa(f, l.etapa as Etapa)} ·{" "}
                                  {ORIGEM_LABEL[l.origem]}
                                  {l.proximo_contato_em
                                    ? ` · ${diaMes(l.proximo_contato_em)} — ${l.proximo_contato_motivo ?? ""}`
                                    : ""}
                                </div>
                              </button>
                              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                                {motivo === "aceite" ? (
                                  <Button size="sm" onClick={() => setAbertoId(l.id)}>
                                    Abrir e aceitar
                                  </Button>
                                ) : (
                                  <>
                                    {podeMexer(l) && (
                                      <Button
                                        size="sm"
                                        variant={motivo === "hoje" ? "outline" : "default"}
                                        onClick={() =>
                                          setPedido({ lead: l, para: null, tipo: "proximo" })
                                        }
                                      >
                                        {l.proximo_contato_em
                                          ? "Remarcar"
                                          : "Definir próximo contato"}
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setAbertoId(l.id)}
                                    >
                                      Abrir
                                    </Button>
                                  </>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <LeadDetalhe
        lead={aberto}
        gestor={gestor}
        userId={user?.id}
        config={config}
        pessoas={pessoas}
        capturas={capturas}
        motivos={motivos}
        onClose={() => setAbertoId(null)}
        onChanged={() => void carregar()}
        crm={aberto ? blocoCrm(aberto) : undefined}
      />
      <CrmMoverDialog
        pedido={pedido}
        motivos={motivos}
        captacaoLigada={captacaoLigada}
        unidades={unidades}
        onClose={() => setPedido(null)}
        onDone={() => void carregar()}
      />
      {gestor && (
        <NovoLeadDialog
          open={novo}
          onOpenChange={setNovo}
          pessoas={pessoas}
          capturas={capturas}
          onCreated={() => void carregar()}
        />
      )}
      {/* Na fila do dia o estado vazio é um só, com botões (t_7bd432c2). */}
      {leads !== null && leads.length === 0 && aba !== "fila" && (
        <EmptyState icon={Users}>Nenhum lead ainda.</EmptyState>
      )}
    </div>
  );
}
