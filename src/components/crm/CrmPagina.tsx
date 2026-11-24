import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { KanbanSquare, Plus, Trophy, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ListSkeleton, PageHeader, Pill } from "@/components/visual/base";
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
  type Pessoa,
} from "@/lib/leads";
import { carregarOpcoes, lerConfig, listarMotivos } from "@/lib/leads-db";
import { exclusiveEnabled, listUnits } from "@/lib/exclusive-captures-db";
import type { ExclusiveUnit } from "@/lib/exclusive-captures";
import {
  diaMes,
  FUNIL,
  filaDoDia,
  funilDe,
  hojeSP,
  nomeEtapa,
  pedidoAoMover,
  type Etapa,
  type Funil,
} from "@/lib/crm";
import { definirFunil, listarLeadsCrm } from "@/lib/crm-db";
import { clicavelPorTeclado } from "@/lib/clicavel";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const FILA_TXT = {
  aceite: { t: "Aguardando aceite", tom: "blue" },
  atrasado: { t: "Atrasado", tom: "red" },
  sem: { t: "Sem próximo passo", tom: "red" },
  hoje: { t: "Hoje", tom: "amber" },
} as const;

type Pedido = PedidoMover | { lead: Lead; para: null; tipo: "proximo" } | null;

/**
 * CRM com dois funis (Venda e Captação) e fila do dia. Individual para todos os papéis (Denis 24/11,
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
            {!convertido && l.etapa !== "perdido" && (f === "venda" || captacaoLigada) && (
              <Button
                size="sm"
                onClick={() => setPedido({ lead: l, para: "ganho", tipo: "fechar" })}
              >
                {FUNIL[f].conv}
              </Button>
            )}
            {(l.etapa === "novo" || l.etapa === "em_atendimento") && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void trocarFunil(l, f === "venda" ? "captacao" : "venda")}
              >
                É {f === "venda" ? "proprietário (Captação)" : "comprador (Venda)"}? Trocar de funil
              </Button>
            )}
          </div>
        )}
      </section>
    );
  };

  const quadro = (f: Funil) => (
    <TabsContent value={f} className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {FUNIL[f].nome}: leads de {FUNIL[f].publico}. Arraste o cartão para mudar de etapa (no
        celular: segure o cartão ou use “Mover para…” no lead). Vermelho = sem próximo passo ou
        atrasado.
      </p>
      {leads === null ? (
        <ListSkeleton />
      ) : (
        <CrmQuadro
          funil={f}
          leads={doFunil(f)}
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

  return (
    <div className="space-y-4">
      <PageHeader
        icon={KanbanSquare}
        title="CRM"
        description="Funil de Venda (compradores) e Funil de Captação (proprietários). Todo lead em andamento precisa de um próximo contato."
        actions={
          gestor ? (
            <Button onClick={() => setNovo(true)}>
              <Plus className="mr-1 h-4 w-4" /> Novo lead
            </Button>
          ) : undefined
        }
      />

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="venda">Funil de Venda ({doFunil("venda").length})</TabsTrigger>
          <TabsTrigger value="captacao">
            Funil de Captação ({doFunil("captacao").length})
          </TabsTrigger>
          <TabsTrigger value="fila">Minha fila do dia ({fila.length})</TabsTrigger>
        </TabsList>

        {quadro("venda")}
        {quadro("captacao")}

        <TabsContent value="fila" className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Seus leads para hoje: primeiro os que aguardam aceite, depois os atrasados, os sem
            próximo passo e os marcados para hoje.
          </p>
          {leads === null ? (
            <ListSkeleton />
          ) : fila.length === 0 ? (
            <EmptyState icon={Trophy}>Nada pendente para hoje.</EmptyState>
          ) : (
            <div className="grid gap-2">
              {fila.map(({ lead: l, motivo }) => (
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
                        {FUNIL[funilDe(l)].nome} · {nomeEtapa(funilDe(l), l.etapa as Etapa)} ·{" "}
                        {ORIGEM_LABEL[l.origem]}
                        {l.proximo_contato_em
                          ? ` · ${diaMes(l.proximo_contato_em)} — ${l.proximo_contato_motivo ?? ""}`
                          : ""}
                      </div>
                    </div>
                    <Pill tom={FILA_TXT[motivo].tom}>{FILA_TXT[motivo].t}</Pill>
                  </CardContent>
                </Card>
              ))}
            </div>
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
      {leads !== null && leads.length === 0 && (
        <EmptyState icon={Users}>Nenhum lead ainda.</EmptyState>
      )}
    </div>
  );
}
