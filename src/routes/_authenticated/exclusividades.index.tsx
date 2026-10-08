import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  archiveCapture,
  createCapture,
  createManualCapture,
  listCaptures,
  listUnits,
  situacaoVendaLista,
  type SituacaoVendaLista,
} from "@/lib/exclusive-captures-db";
import { diasEntre, haQuantosDias, seloSituacaoCaptacao } from "@/lib/captacao-venda";
import { guardExclusiveRoute } from "@/lib/exclusive-captures-guard";
import {
  captureNextAction,
  captureUnitLabel,
  captureValidity,
  MANUAL_COLOR,
  VALIDITY_STYLE,
  validityText,
  type Capture,
  type ExclusiveUnit,
} from "@/lib/exclusive-captures";
import {
  EMPTY_FILTERS,
  filtersActive,
  matchFilters,
  type Filters,
} from "@/lib/exclusive-captures-dashboard";
import { CapturesFilters } from "@/components/exclusividades/CapturesFilters";
import { CaptureSummaryDialog } from "@/components/exclusividades/CaptureSummaryDialog";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Archive,
  ArrowRight,
  CalendarClock,
  FileSignature,
  House,
  MapPinned,
  Trash2,
} from "lucide-react";

/** "Rua X, 268 — Apto 12 · Bairro · Sorocaba/SP" (só o que estiver preenchido). */
function fullAddress(i: Capture["form_data"]["imovel"] | undefined): string {
  const t = (x?: string) => x?.trim() ?? "";
  const rua = [t(i?.endereco), t(i?.complemento)].filter(Boolean).join(" — ");
  const cidade = [t(i?.municipio), t(i?.estado)].filter(Boolean).join("/");
  return [rua, t(i?.bairro), cidade].filter(Boolean).join(" · ");
}

export const Route = createFileRoute("/_authenticated/exclusividades/")({
  head: () => ({ meta: [{ title: "Captações exclusivas" }] }),
  beforeLoad: guardExclusiveRoute,
  component: ExclusiveList,
});

function ExclusiveList() {
  const { user, hasAny } = useAuth();
  const navigate = useNavigate();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<ExclusiveUnit[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const today = hojeSaoPaulo();
  const archivedCount = captures.filter((c) => c.archived_at).length;
  // "Vencendo": exclusividade assinada que vence em até 30 dias ou já venceu (renovar).
  const expiring = (c: Capture) => {
    const v = captureValidity(c, today);
    return !!v && v.daysLeft <= 30;
  };
  const expiringCount = captures.filter((c) => !c.archived_at && expiring(c)).length;
  const visible = captures
    .filter((c) => !!c.archived_at === showArchived)
    .filter((c) => showArchived || !onlyExpiring || expiring(c))
    .filter((c) => matchFilters(c, filters, today, units))
    .sort((a, b) =>
      onlyExpiring
        ? (captureValidity(a, today)?.daysLeft ?? 0) - (captureValidity(b, today)?.daysLeft ?? 0)
        : 0,
    );
  const [removing, setRemoving] = useState<string | null>(null);
  const [summary, setSummary] = useState<Capture | null>(null);
  // "Virou venda": selo Em negociação / Vendida por captação (o banco só devolve as que a pessoa vê).
  const [vendas, setVendas] = useState<Map<string, SituacaoVendaLista>>(new Map());
  // Só rascunho; se ele já gerou contrato o banco recusa e orienta a arquivar.
  const removeDraft = async (c: Capture) => {
    if (!window.confirm("Excluir este rascunho? Ele deixará de aparecer na lista.")) return;
    setRemoving(c.id);
    try {
      await archiveCapture(c.id, "excluir");
      setCaptures((list) => list.filter((x) => x.id !== c.id));
      toast.success("Rascunho excluído");
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Não foi possível excluir"));
    } finally {
      setRemoving(null);
    }
  };
  useEffect(() => {
    Promise.all([listCaptures(), listUnits(), situacaoVendaLista()])
      .then(([list, unitList, vendaMap]) => {
        setCaptures(list);
        setUnits(unitList);
        setVendas(vendaMap);
      })
      .catch((e) => toast.error(errorMessage(e, "Falha ao carregar captações")))
      .finally(() => setLoading(false));
  }, []);
  const activeUnits = units.filter((u) => u.ativo);
  const [manualUnit, setManualUnit] = useState("");
  // Cadastro manual: contrato de exclusividade já assinado no papel (captador = usuário logado).
  const create = async (unitId: string, manual = false) => {
    setCreating(manual ? `manual:${unitId}` : unitId);
    try {
      const id = manual ? await createManualCapture(unitId) : await createCapture(unitId);
      navigate({ to: "/exclusividades/$id", params: { id } });
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Falha ao criar captação"));
    } finally {
      setCreating(null);
    }
  };
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Captações exclusivas</h1>
        <p className="text-sm text-muted-foreground">
          Módulo independente de vendas, relatórios e comissões.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nova captação</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {activeUnits.map((u) => (
            <Button key={u.id} disabled={!!creating} onClick={() => create(u.id)}>
              {creating === u.id ? "Criando…" : u.nome}
            </Button>
          ))}
          {activeUnits.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t pt-3">
              {activeUnits.length > 1 && (
                <select
                  aria-label="Unidade do contrato já assinado"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={manualUnit}
                  onChange={(e) => setManualUnit(e.target.value)}
                >
                  <option value="">Unidade…</option>
                  {activeUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </select>
              )}
              <Button
                variant="outline"
                className="border-violet-300 text-violet-800 hover:bg-violet-50"
                disabled={!!creating || (activeUnits.length > 1 && !manualUnit)}
                onClick={() =>
                  create(activeUnits.length > 1 ? manualUnit : activeUnits[0].id, true)
                }
              >
                <FileSignature className="mr-1 h-4 w-4" />
                {creating?.startsWith("manual:")
                  ? "Criando…"
                  : "Cadastrar exclusividade já assinada"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Contrato assinado no papel: envie o PDF ou a foto, confira e o gestor aprova.
              </span>
            </div>
          )}
          {!loading && activeUnits.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma unidade cadastrada.{" "}
              {hasAny(["admin", "super_admin"]) ? (
                <Link to="/admin/unidades-captacao" className="text-primary underline">
                  Cadastre a primeira unidade
                </Link>
              ) : (
                "Peça ao administrador da imobiliária para cadastrar as unidades."
              )}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>{showArchived ? "Captações arquivadas" : "Captações acessíveis"}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/exclusividades/painel">
                <MapPinned className="mr-1 h-4 w-4" /> Painel e mapa
              </Link>
            </Button>
            {!showArchived && (
              <Button
                variant={onlyExpiring ? "default" : "outline"}
                size="sm"
                onClick={() => setOnlyExpiring((v) => !v)}
              >
                <CalendarClock className="mr-1 h-4 w-4" />
                {onlyExpiring ? "Ver todas" : `Vencendo (${expiringCount})`}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)}>
              <Archive className="mr-1 h-4 w-4" />
              {showArchived ? "Voltar para ativas" : `Arquivadas (${archivedCount})`}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 border-b pb-4">
          <CapturesFilters
            captures={captures.filter((c) => !!c.archived_at === showArchived)}
            value={filters}
            onChange={setFilters}
            showSearch
            units={units}
          />
          {!loading && (
            <p className="text-xs text-muted-foreground">
              {visible.length} captação(ões)
              {filtersActive(filters) ? " com os filtros aplicados" : ""}
            </p>
          )}
        </CardContent>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-2">
          {loading ? (
            <p>Carregando…</p>
          ) : visible.length === 0 ? (
            <p>
              {showArchived
                ? "Nenhuma captação arquivada."
                : onlyExpiring
                  ? "Nenhuma exclusividade vencendo nos próximos 30 dias."
                  : filtersActive(filters)
                    ? "Nenhuma captação com esses filtros."
                    : "Nenhuma captação disponível."}
            </p>
          ) : (
            visible.map((c) => {
              const manager = hasAny(["gestor", "team_leader", "admin", "super_admin"]);
              const property = c.form_data.imovel;
              const validity = captureValidity(c, today);
              return (
                <Link
                  key={c.id}
                  to="/exclusividades/$id"
                  params={{ id: c.id }}
                  className="group rounded-md border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={(e) => {
                    // Aprovada: abre o resumo da gestão; Ctrl/Cmd+clique continua abrindo a captação.
                    if (c.status !== "aprovada" || e.metaKey || e.ctrlKey || e.shiftKey) return;
                    e.preventDefault();
                    setSummary(c);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <House className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">
                          {property.endereco || property.tipo_imovel || "Imóvel a identificar"}
                        </span>
                      </div>
                      {fullAddress(property) && (
                        <p className="mt-1 text-sm" title={fullAddress(property)}>
                          {fullAddress(property)}
                        </p>
                      )}
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {c.form_data.proprietario_1?.nome_completo || "Proprietário a preencher"}
                        {c.form_data.proprietario_2?.nome_completo
                          ? ` · ${c.form_data.proprietario_2.nome_completo}`
                          : ""}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border px-2 py-0.5">
                      {captureUnitLabel(c, units)}
                    </span>
                    {c.manual && (
                      <span
                        className="rounded-full px-2 py-0.5 font-medium text-white"
                        style={{ background: MANUAL_COLOR }}
                      >
                        Cadastro manual
                      </span>
                    )}
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      {
                        {
                          rascunho: "Rascunho",
                          devolvida: "Devolvida",
                          enviada: "Enviada",
                          em_assinatura: "Em assinatura",
                          aprovada: "Aprovada",
                        }[c.status]
                      }
                    </span>
                    {validity && (
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${VALIDITY_STYLE[validity.level]}`}
                      >
                        {validityText(validity)}
                      </span>
                    )}
                    {(() => {
                      const v = vendas.get(c.id);
                      const selo = seloSituacaoCaptacao(v?.situacao);
                      if (!v || !selo) return null;
                      const dias =
                        v.situacao === "em_negociacao"
                          ? haQuantosDias(diasEntre(v.negociacao_desde, today))
                          : "";
                      return (
                        <span className={`rounded-full px-2 py-0.5 font-medium ${selo.classe}`}>
                          {selo.texto}
                          {dias ? ` · ${dias}` : ""}
                        </span>
                      );
                    })()}
                    <span className="text-muted-foreground">
                      Criada por {c.broker_name || "—"}
                      {c.captor_id === user?.id ? " (você)" : ""} · {c.created_on_sp}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
                    <p className="text-sm">
                      <span className="text-muted-foreground">Próxima ação: </span>
                      {captureNextAction(c.status, manager, c.manual)}
                    </p>
                    {c.status === "rascunho" && !c.archived_at && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={removing === c.id}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void removeDraft(c);
                        }}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Excluir
                      </Button>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>
      <CaptureSummaryDialog
        capture={summary}
        today={today}
        onClose={() => setSummary(null)}
        units={units}
      />
    </div>
  );
}
