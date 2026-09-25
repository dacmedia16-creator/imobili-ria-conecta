import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { createCapture, listCaptures } from "@/lib/exclusive-captures-db";
import { guardExclusiveRoute } from "@/lib/exclusive-captures-guard";
import { TEMPLATES, type Capture, type Template } from "@/lib/exclusive-captures";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/exclusividades/")({
  head: () => ({ meta: [{ title: "Captações exclusivas" }] }),
  beforeLoad: guardExclusiveRoute,
  component: ExclusiveList,
});

function ExclusiveList() {
  const { user } = useAuth();
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
        <CardContent className="space-y-2">
          {loading ? (
            <p>Carregando...</p>
          ) : captures.length === 0 ? (
            <p>Nenhuma captação disponível.</p>
          ) : (
            captures.map((c) => (
              <Link
                key={c.id}
                to="/exclusividades/$id"
                params={{ id: c.id }}
                className="block rounded border p-3 hover:bg-muted/50"
              >
                <b>{c.form_data.proprietario_1?.nome_completo || "Proprietário a preencher"}</b>
                <span className="ml-2 text-sm text-muted-foreground">
                  {TEMPLATES[c.template]} · {c.status} · {c.created_on_sp}
                  {c.captor_id === user?.id ? " · sua" : " · equipe"}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
