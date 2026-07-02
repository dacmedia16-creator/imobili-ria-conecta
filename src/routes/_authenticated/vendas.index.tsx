import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { STATUS_LABEL, type SaleStatus } from "@/lib/status";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/vendas/")({
  head: () => ({ meta: [{ title: "Vendas" }] }),
  component: SalesList,
});

function SalesList() {
  const { hasAny } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("todas");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let query = supabase.from("sales").select("id, status, valor_negociado, imovel_id, codigo_interno, updated_at, corretor_id").order("updated_at", { ascending: false });
      if (statusFilter !== "todas") query = query.eq("status", statusFilter as any);
      const { data } = await query;
      const filtered = (data ?? []).filter((s: any) => {
        if (!q) return true;
        const hay = `${s.imovel_id ?? ""} ${s.codigo_interno ?? ""} ${s.id}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      });
      setSales(filtered);
      setLoading(false);
    })();
  }, [statusFilter, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Vendas</h1>
        {hasAny(["corretor"]) && (
          <Button asChild><Link to="/vendas/nova"><Plus className="mr-2 h-4 w-4" />Nova Venda</Link></Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input placeholder="Buscar por código ou ID do imóvel" value={q} onChange={(e) => setQ(e.target.value)} className="md:max-w-xs" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="md:w-64"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos os status</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>}
          {!loading && sales.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {hasAny(["corretor"]) && !hasAny(["gestor","juridico","financeiro","admin","super_admin"]) && (
                <>Você ainda não criou nenhuma venda. Clique em <b>Nova Venda</b> para começar.</>
              )}
              {hasAny(["gestor"]) && !hasAny(["financeiro","admin","super_admin"]) && (
                <>Nenhuma venda visível. Peça ao administrador para vincular corretores à sua equipe.</>
              )}
              {hasAny(["juridico"]) && !hasAny(["financeiro","admin","super_admin"]) && (
                <>Nenhuma venda aprovada pelo gestor ainda. Você só enxerga vendas a partir dessa etapa.</>
              )}
              {hasAny(["financeiro","admin","super_admin"]) && (<>Nenhuma venda encontrada com o filtro atual.</>)}
            </div>
          )}
          {sales.map((s) => (
            <Link key={s.id} to="/vendas/$id" params={{ id: s.id }} className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50">
              <div>
                <div className="text-sm font-medium">{s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`}</div>
                <div className="text-xs text-muted-foreground">
                  {s.valor_negociado ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}` : "Valor pendente"} ·
                  {" "}atualizado em {new Date(s.updated_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
              <StatusBadge status={s.status as SaleStatus} />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
