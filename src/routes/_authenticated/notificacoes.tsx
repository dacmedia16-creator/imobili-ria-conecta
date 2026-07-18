import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, CheckCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/notificacoes")({
  head: () => ({ meta: [{ title: "Notificações" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"nao_lidas" | "lidas">("nao_lidas");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .eq("lida", tab === "lidas")
      .order("created_at", { ascending: false })
      .limit(100);
    setItems(data ?? []);
    setLoading(false);
  }, [user, tab]);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ lida: true }).eq("id", id);
    load();
  };
  const markAllRead = async () => {
    if (!user) return;
    const { error } = await supabase.from("notifications").update({ lida: true }).eq("user_id", user.id).eq("lida", false);
    if (error) toast.error(error.message);
    else { toast.success("Todas marcadas como lidas"); load(); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
        {tab === "nao_lidas" && items.length > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="mr-2 h-4 w-4" />Marcar todas como lidas
          </Button>
        )}
      </div>

      <div className="flex gap-2 border-b">
        {(["nao_lidas", "lidas"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm ${tab === t ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
          >
            {t === "nao_lidas" ? "Não lidas" : "Lidas"}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{tab === "nao_lidas" ? "Não lidas" : "Lidas"}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!loading && items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma notificação.</p>
          )}
          {items.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{n.titulo}</div>
                {n.mensagem && <p className="mt-0.5 text-sm text-muted-foreground">{n.mensagem}</p>}
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(n.created_at).toLocaleString("pt-BR")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {n.sale_id && (
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/vendas/$id" params={{ id: n.sale_id }} onClick={() => !n.lida && markRead(n.id)}>
                      <ExternalLink className="mr-1 h-4 w-4" />Abrir
                    </Link>
                  </Button>
                )}
                {!n.lida && (
                  <Button size="sm" variant="ghost" onClick={() => markRead(n.id)} aria-label="Marcar como lida">
                    <Check className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
