import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { STATUS_LABEL, type SaleStatus } from "@/lib/status";
import { Plus, FileText, ClipboardCheck, Gavel, DollarSign } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user, roles, hasAny } = useAuth();
  const [stats, setStats] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("sales")
        .select("id, status, valor_negociado, updated_at, imovel_id, codigo_interno")
        .order("updated_at", { ascending: false })
        .limit(8);
      setRecent(data ?? []);
      const counts: Record<string, number> = {};
      (data ?? []).forEach((s: any) => { counts[s.status] = (counts[s.status] ?? 0) + 1; });
      setStats(counts);
    })();
  }, [user]);

  const isCorretor = hasAny(["corretor"]);
  const isGestor = hasAny(["gestor", "coordenador"]);
  const isJuridico = hasAny(["juridico"]);
  const isFinanceiro = hasAny(["financeiro", "admin"]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {user?.email?.split("@")[0]}</h1>
          <p className="text-sm text-muted-foreground">Perfis: {roles.map(r => ROLE_LABEL[r]).join(", ") || "—"}</p>
        </div>
        {isCorretor && (
          <Button asChild>
            <Link to="/vendas/nova"><Plus className="mr-2 h-4 w-4" />Nova Venda</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FileText} label="Rascunhos" value={stats["rascunho"] ?? 0} />
        <StatCard icon={ClipboardCheck} label="Aguardando revisão" value={stats["enviada_revisao"] ?? 0} />
        <StatCard icon={Gavel} label="No jurídico" value={(stats["enviada_juridico"] ?? 0) + (stats["em_elaboracao_contrato"] ?? 0) + (stats["aguardando_assinatura"] ?? 0)} />
        <StatCard icon={DollarSign} label="Ocorrências pendentes" value={stats["ocorrencia_pendente"] ?? 0} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Vendas recentes</CardTitle>
          <Button asChild variant="ghost" size="sm"><Link to="/vendas">Ver todas</Link></Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {recent.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma venda ainda.</p>}
          {recent.map((s) => (
            <Link key={s.id} to="/vendas/$id" params={{ id: s.id }} className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50">
              <div>
                <div className="text-sm font-medium">{s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`}</div>
                <div className="text-xs text-muted-foreground">
                  {s.valor_negociado ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}` : "Valor pendente"}
                </div>
              </div>
              <StatusBadge status={s.status as SaleStatus} />
            </Link>
          ))}
        </CardContent>
      </Card>

      {(isGestor || isJuridico || isFinanceiro) && (
        <Card>
          <CardHeader><CardTitle>Atalhos do seu perfil</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {isGestor && <Button asChild variant="outline"><Link to="/vendas" search={{ status: "enviada_revisao" } as any}>Revisar vendas</Link></Button>}
            {isJuridico && <Button asChild variant="outline"><Link to="/vendas" search={{ status: "aprovada_gestor" } as any}>Vendas aprovadas</Link></Button>}
            {isFinanceiro && <Button asChild variant="outline"><Link to="/vendas" search={{ status: "contrato_assinado" } as any}>Contratos assinados</Link></Button>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <div className="text-2xl font-semibold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
