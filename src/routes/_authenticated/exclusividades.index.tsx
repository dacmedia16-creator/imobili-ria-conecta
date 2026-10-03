import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { archiveCapture, createCapture, listCaptures } from "@/lib/exclusive-captures-db";
import { guardExclusiveRoute } from "@/lib/exclusive-captures-guard";
import {
  captureNextAction,
  captureValidity,
  VALIDITY_STYLE,
  validityText,
  TEMPLATES,
  type Capture,
  type Template,
} from "@/lib/exclusive-captures";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Archive, ArrowRight, CalendarClock, House, MapPinned, Trash2 } from "lucide-react";

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
  const [creating, setCreating] = useState<Template | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [onlyExpiring, setOnlyExpiring] = useState(false);
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
    .sort((a, b) =>
      onlyExpiring
        ? (captureValidity(a, today)?.daysLeft ?? 0) - (captureValidity(b, today)?.daysLeft ?? 0)
        : 0,
    );
  const [removing, setRemoving] = useState<string | null>(null);
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
    listCaptures()
      .then(setCaptures)
      .catch((e) => toast.error(errorMessage(e, "Falha ao carregar captações")))
      .finally(() => setLoading(false));
  }, []);
  const create = async (template: Template) => {
    setCreating(template);
    try {
      const id = await createCapture(template);
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
          {(Object.entries(TEMPLATES) as [Template, string][]).map(([key, label]) => (
            <Button key={key} disabled={!!creating} onClick={() => create(key)}>
              {creating === key ? "Criando…" : label}
            </Button>
          ))}
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
        <CardContent className="grid gap-3 md:grid-cols-2">
          {loading ? (
            <p>Carregando…</p>
          ) : visible.length === 0 ? (
            <p>
              {showArchived
                ? "Nenhuma captação arquivada."
                : onlyExpiring
                  ? "Nenhuma exclusividade vencendo nos próximos 30 dias."
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
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <House className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">
                          {property.endereco || property.tipo_imovel || "Imóvel a identificar"}
                        </span>
                      </div>
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
                    <span className="rounded-full border px-2 py-0.5">{TEMPLATES[c.template]}</span>
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
                    <span className="text-muted-foreground">
                      Criada por {c.broker_name || "—"}
                      {c.captor_id === user?.id ? " (você)" : ""} · {c.created_on_sp}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
                    <p className="text-sm">
                      <span className="text-muted-foreground">Próxima ação: </span>
                      {captureNextAction(c.status, manager)}
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
    </div>
  );
}
