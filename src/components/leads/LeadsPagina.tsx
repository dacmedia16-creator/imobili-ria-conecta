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
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

/**
 * "meus": corretor vê os leads em que é o responsável.
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

  const visiveis = useMemo(() => filtrarLeads(leads ?? [], filtro), [leads, filtro]);
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

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Etapas">
        <Button
          size="sm"
          variant={filtro.etapa === "" ? "default" : "outline"}
          onClick={() => setFiltro((f) => ({ ...f, etapa: "" }))}
        >
          Todas ({leads?.length ?? 0})
        </Button>
        {ETAPAS.map((e) => (
          <Button
            key={e}
            size="sm"
            variant={filtro.etapa === e ? "default" : "outline"}
            onClick={() => setFiltro((f) => ({ ...f, etapa: e as Etapa }))}
          >
            {ETAPA_LABEL[e]} ({porEtapa[e]})
          </Button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          placeholder="Buscar por nome, telefone ou e-mail"
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

      {erroCarga ? (
        <ErrorState onRetry={() => void carregar()} retrying={recarregando}>
          Não foi possível carregar os leads. A lista e os contadores não foram exibidos para não
          mostrar números errados.
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
        <div className="grid gap-2">
          {visiveis.map((l) => (
            <Card
              key={l.id}
              className="cursor-pointer transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => setAbertoId(l.id)}
              {...clicavelPorTeclado(() => setAbertoId(l.id), `Abrir lead ${l.nome}`)}
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="break-words font-medium">{l.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {ORIGEM_LABEL[l.origem]} · {dataCurta(l.created_at)}
                    {painel ? ` · ${l.no_banco_desde ? "No banco" : nomeDe(l.responsavel_id)}` : ""}
                    {l.capture_id ? " · com imóvel" : ""}
                    {l.simulado ? " · simulado" : ""}
                  </div>
                  {textoPrazo(prazoDoLead(l, config)) && (
                    <div className="text-xs text-amber-700 dark:text-amber-300">
                      {textoPrazo(prazoDoLead(l, config))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {aguardandoMeuAceite(l, user?.id) && (
                    <Pill tom="blue">Aguardando seu aceite</Pill>
                  )}
                  <Pill tom={ETAPA_TOM[l.etapa]}>{ETAPA_LABEL[l.etapa]}</Pill>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(atende || gestor) && (
        <LeadsBanco podePegar={atende} versao={versaoBanco} onChanged={() => void carregar()} />
      )}

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
