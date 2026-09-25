import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { createCapture, listCaptures } from "@/lib/exclusive-captures-db";
import { guardExclusiveRoute } from "@/lib/exclusive-captures-guard";
import {
  captureNextAction,
  TEMPLATES,
  type Capture,
  type Template,
} from "@/lib/exclusive-captures";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowRight, House } from "lucide-react";

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
              {creating === key ? "Criando..." : label}
            </Button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Captações acessíveis</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {loading ? (
            <p>Carregando...</p>
          ) : captures.length === 0 ? (
            <p>Nenhuma captação disponível.</p>
          ) : (
            captures.map((c) => {
              const manager = hasAny(["gestor", "team_leader", "admin", "super_admin"]);
              const property = c.form_data.imovel;
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
                    <span className="text-muted-foreground">
                      {c.captor_id === user?.id ? "Sua" : "Equipe"} · {c.created_on_sp}
                    </span>
                  </div>
                  <p className="mt-3 border-t pt-2 text-sm">
                    <span className="text-muted-foreground">Próxima ação: </span>
                    {captureNextAction(c.status, manager)}
                  </p>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
