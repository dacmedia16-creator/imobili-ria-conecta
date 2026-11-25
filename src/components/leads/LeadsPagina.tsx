import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Contact,
  FlaskConical,
  Hourglass,
  Settings2,
  KanbanSquare,
  Percent,
  Plus,
  SearchX,
  Trophy,
  Users,
  UserX,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Paginacao } from "@/components/visual/Paginacao";
import { esperaDoLead, ordenarPorEspera, paginar, POR_PAGINA_LEADS } from "@/lib/telas-lote1";
import {
  EmptyState,
  ErrorState,
  KpiTile,
  ListSkeleton,
  PageHeader,
  Pill,
} from "@/components/visual/base";
import { LeadDetalhe } from "@/components/leads/LeadDetalhe";
import { LeadsBanco } from "@/components/leads/LeadsBanco";
import { LeadsConfigDialog } from "@/components/leads/LeadsConfigDialog";
import { NovoLeadDialog } from "@/components/leads/NovoLeadDialog";
import { SimuladorLeadsDialog } from "@/components/leads/SimuladorLeadsDialog";
import {
  aguardandoMeuAceite,
  CONFIG_PADRAO,
  contarPorEtapa,
  duracaoTxt,
  podeAtenderLeads,
  prazoDoLead,
  textoPrazo,
  type LeadConfig,
  ETAPA_LABEL,
  ETAPA_TOM,
  ETAPAS,
  filtrarLeads,
  FILTRO_VAZIO,
  ORIGEM_LABEL,
  resumoPainel,
  SEM_RESPONSAVEL,
  type CapturaOpcao,
  type Etapa,
  type FiltroLeads,
  type Lead,
  type MotivoPerda,
  type Pessoa,
} from "@/lib/leads";
import { carregarOpcoes, lerConfig, listarLeads, listarMotivos } from "@/lib/leads-db";
import { clicavelPorTeclado } from "@/lib/clicavel";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

/**
 * "painel": admin vê a imobiliária; gestor e Team Leader, os próprios + os da equipe (a RLS decide, t_b855dbb8).
 * "painel": gestor/admin vê a imobiliária; Team Leader vê a própria equipe (a RLS decide).
 */
export function LeadsPagina({ modo }: { modo: "meus" | "painel" }) {
  const { user, hasAny, roles } = useAuth();
  const gestor = hasAny(["admin", "super_admin", "gestor"]);
  const admin = hasAny(["admin", "super_admin"]);
  const atende = podeAtenderLeads(roles);
  const [config, setConfig] = useState<LeadConfig>(CONFIG_PADRAO);
  const [simular, setSimular] = useState(false);
  const [configurar, setConfigurar] = useState(false);
  const [versaoBanco, setVersaoBanco] = useState(0);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [capturas, setCapturas] = useState<CapturaOpcao[]>([]);
  const [motivos, setMotivos] = useState<MotivoPerda[]>([]);
  const [filtro, setFiltro] = useState<FiltroLeads>(FILTRO_VAZIO);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  const [erroCarga, setErroCarga] = useState(false);
  const [recarregando, setRecarregando] = useState(false);

  const carregar = useCallback(async () => {
    setRecarregando(true);
    try {
      const l = await listarLeads(modo === "meus" && user ? { responsavel: user.id } : {});
      setLeads(l);
      setErroCarga(false);
      setVersaoBanco((v) => v + 1);
    } catch (e) {
      // Erro de carga NUNCA vira "Nenhum lead" nem zeros (item 1 t_8730be75).
      setLeads(null);
      setErroCarga(true);
      toast.error(errorMessage(e, "Não foi possível carregar os leads."));
    } finally {
      setRecarregando(false);
    }
  }, [modo, user]);

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
  }, [carregar]);
  const recarregarConfig = () =>
    void lerConfig()
      .then(setConfig)
      .catch(() => undefined);

  // t_7bd432c2: abas Equipe/Banco, ordem por tempo sem atendimento e 25 por vez. Só tela: a lista
  // continua vindo de listarLeads/lead_banco_listar e a RLS decide quem vê o quê (#412/#413/#414).
  const temBanco = atende || gestor;
  // "#banco" no endereço (botão "Ver Banco da imobiliária" da fila do dia) abre direto na aba do banco.
  const [aba, setAba] = useState<"equipe" | "banco">(() =>
    typeof window !== "undefined" && window.location.hash === "#banco" ? "banco" : "equipe",
  );
  const [totalBanco, setTotalBanco] = useState<number | null>(null);
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [filtro]);
  const agora = new Date();
  const visiveis = useMemo(
    () => ordenarPorEspera(filtrarLeads(leads ?? [], filtro)),
    [leads, filtro],
  );
  const pag = paginar(visiveis, pagina, POR_PAGINA_LEADS);
  const chips: { chave: string; texto: string; limpar: () => void }[] = [];
  if (filtro.etapa)
    chips.push({
      chave: "etapa",
      texto: `Etapa: ${ETAPA_LABEL[filtro.etapa]}`,
      limpar: () => setFiltro((f) => ({ ...f, etapa: "" })),
    });
  if (filtro.responsavel)
    chips.push({
      chave: "resp",
      texto:
        filtro.responsavel === SEM_RESPONSAVEL
          ? "Sem responsável"
          : `Responsável: ${pessoas.find((p) => p.id === filtro.responsavel)?.nome ?? "Pessoa"}`,
      limpar: () => setFiltro((f) => ({ ...f, responsavel: "" })),
    });
  if (filtro.busca.trim())
    chips.push({
      chave: "busca",
      texto: `Busca: “${filtro.busca.trim()}”`,
      limpar: () => setFiltro((f) => ({ ...f, busca: "" })),
    });
  const porEtapa = useMemo(() => contarPorEtapa(leads ?? []), [leads]);
  const resumo = useMemo(() => resumoPainel(leads ?? []), [leads]);
  const nomeDe = (id: string | null) =>
    id ? (pessoas.find((p) => p.id === id)?.nome ?? "Pessoa") : "Sem responsável";
  const aberto = leads?.find((l) => l.id === abertoId) ?? null;
  const painel = modo === "painel";
  const pendentesAceite = (leads ?? []).filter((l) => aguardandoMeuAceite(l, user?.id)).length;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={painel ? KanbanSquare : Contact}
        title={painel ? "Painel de leads" : "Meus leads"}
        description={
          painel
            ? "Todos os leads que você pode acompanhar, por etapa do funil. Piloto: dados de teste."
            : "Leads em que você é o responsável. Atualize a etapa e registre o atendimento."
        }
        actions={
          gestor ? (
            <div className="flex flex-wrap gap-2">
              {painel && (
                <Button variant="outline" onClick={() => setSimular(true)}>
                  <FlaskConical className="mr-1 h-4 w-4" /> Simular leads
                </Button>
              )}
              {painel && (
                <Button variant="outline" onClick={() => setConfigurar(true)}>
                  <Settings2 className="mr-1 h-4 w-4" /> Configurar
                </Button>
              )}
              <Button onClick={() => setNovo(true)}>
                <Plus className="mr-1 h-4 w-4" /> Novo lead
              </Button>
            </div>
          ) : undefined
        }
      />

      {!painel && pendentesAceite > 0 && (
        <p className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          Você tem {pendentesAceite} lead(s) aguardando aceite. Abra o lead e clique em “Aceitar
          lead”. Prazo para aceitar: {duracaoTxt(config.prazo_aceite_min * 60_000)}.
        </p>
      )}

      {painel && leads && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <KpiTile icon={Users} label="Total" value={String(resumo.total)} />
          <KpiTile icon={Hourglass} tom="amber" label="Em aberto" value={String(resumo.abertos)} />
          <KpiTile
            icon={UserX}
            tom="red"
            label="Sem responsável"
            value={String(resumo.semResponsavel)}
          />
          <KpiTile icon={Trophy} tom="green" label="Ganhos" value={String(resumo.ganhos)} />
          <KpiTile
            icon={Percent}
            tom="violet"
            label="% ganho (encerrados)"
            value={resumo.taxaGanho === null ? "—" : `${resumo.taxaGanho}%`}
          />
        </div>
      )}

      <Tabs value={aba} onValueChange={(v) => setAba(v as "equipe" | "banco")}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="equipe" data-testid="aba-equipe">
            {painel ? "Leads da equipe" : "Meus leads"} ({leads?.length ?? 0})
          </TabsTrigger>
          {temBanco && (
            <TabsTrigger value="banco" data-testid="aba-banco">
              Banco da imobiliária ({totalBanco ?? "…"})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="equipe" className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Etapas">
            <Button
              size="sm"
              variant={filtro.etapa === "" ? "default" : "outline"}
              aria-pressed={filtro.etapa === ""}
              onClick={() => setFiltro((f) => ({ ...f, etapa: "" }))}
            >
              Todas ({leads?.length ?? 0})
            </Button>
            {ETAPAS.map((e) => (
              <Button
                key={e}
                size="sm"
                variant={filtro.etapa === e ? "default" : "outline"}
                aria-pressed={filtro.etapa === e}
                onClick={() => setFiltro((f) => ({ ...f, etapa: e as Etapa }))}
              >
                {ETAPA_LABEL[e]} ({porEtapa[e]})
              </Button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              placeholder="Buscar por nome, telefone ou e-mail"
              aria-label="Buscar lead"
              value={filtro.busca}
              onChange={(e) => setFiltro((f) => ({ ...f, busca: e.target.value }))}
            />
            {painel && (
              <select
                className={SELECT}
                value={filtro.responsavel}
                onChange={(e) => setFiltro((f) => ({ ...f, responsavel: e.target.value }))}
                aria-label="Responsável"
              >
                <option value="">Todos os responsáveis</option>
                <option value={SEM_RESPONSAVEL}>Sem responsável</option>
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            )}
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="filtros-ativos">
              <span className="text-muted-foreground">Filtros:</span>
              {chips.map((c) => (
                <button
                  key={c.chave}
                  type="button"
                  onClick={c.limpar}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remover filtro ${c.texto}`}
                >
                  {c.texto} <X className="h-3 w-3" aria-hidden />
                </button>
              ))}
              <button
                type="button"
                className="font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => setFiltro(FILTRO_VAZIO)}
              >
                Limpar tudo
              </button>
            </div>
          )}

          {erroCarga ? (
            <ErrorState onRetry={() => void carregar()} retrying={recarregando}>
              Não foi possível carregar os leads. A lista e os contadores não foram exibidos para
              não mostrar números errados.
            </ErrorState>
          ) : leads === null ? (
            <ListSkeleton />
          ) : visiveis.length === 0 ? (
            <EmptyState icon={SearchX}>
              {leads.length === 0
                ? painel
                  ? "Nenhum lead ainda. Use “Novo lead” para cadastrar um lead de teste."
                  : "Você ainda não tem leads."
                : "Nenhum lead com esses filtros."}
            </EmptyState>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Ordem: há mais tempo sem atendimento primeiro. Encerrados (ganho/perdido) no fim.
              </p>
              <ul className="divide-y rounded-lg border bg-card" data-testid="leads-lista">
                {pag.itens.map((l) => {
                  const espera = esperaDoLead(l, agora);
                  const prazo = textoPrazo(prazoDoLead(l, config, agora));
                  return (
                    <li
                      key={l.id}
                      className="grid cursor-pointer gap-1.5 px-3 py-2.5 transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3"
                      onClick={() => setAbertoId(l.id)}
                      {...clicavelPorTeclado(() => setAbertoId(l.id), `Abrir lead ${l.nome}`)}
                      data-testid="lead-linha"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate font-medium">{l.nome}</span>
                          {aguardandoMeuAceite(l, user?.id) && (
                            <Pill tom="blue">Sua vez: aceitar</Pill>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {ORIGEM_LABEL[l.origem]}
                          {painel
                            ? ` · ${l.no_banco_desde ? "No banco" : nomeDe(l.responsavel_id)}`
                            : ""}
                          {` · chegou ${dataCurta(l.created_at)}`}
                          {l.capture_id ? " · com imóvel" : ""}
                          {l.simulado ? " · simulado" : ""}
                        </div>
                        {prazo && (
                          <div className="text-xs text-amber-800 dark:text-amber-300">{prazo}</div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                        <Pill tom={espera.tom}>{espera.texto}</Pill>
                        <Pill tom={ETAPA_TOM[l.etapa]}>{ETAPA_LABEL[l.etapa]}</Pill>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Paginacao {...pag} rotulo="leads" onIr={setPagina} />
            </>
          )}
        </TabsContent>

        {temBanco && (
          <TabsContent value="banco" forceMount className="data-[state=inactive]:hidden">
            <LeadsBanco
              podePegar={atende}
              versao={versaoBanco}
              onChanged={() => void carregar()}
              onTotal={setTotalBanco}
            />
          </TabsContent>
        )}
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
      {gestor && painel && (
        <SimuladorLeadsDialog
          open={simular}
          onOpenChange={setSimular}
          temCaptacoes={capturas.length > 0}
          onCreated={() => void carregar()}
        />
      )}
      {gestor && painel && (
        <LeadsConfigDialog
          admin={admin}
          open={configurar}
          onOpenChange={setConfigurar}
          config={config}
          onSaved={recarregarConfig}
        />
      )}
    </div>
  );
}
