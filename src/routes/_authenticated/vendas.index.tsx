import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { STATUS_LABEL, type SaleStatus } from "@/lib/status";
import { canDeleteSale, deleteSaleCascade } from "@/lib/permissions";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vendas/")({
  head: () => ({ meta: [{ title: "Vendas" }] }),
  component: SalesList,
});

function SalesList() {
  const { user, hasAny } = useAuth();
  const router = useRouter();
  const [sales, setSales] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("todas");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    if (!hasAny(["gestor"])) return;
    (async () => {
      const { data } = await supabase
        .from("team_members")
        .select("membro_id")
        .eq("lider_id", user.id);
      setTeamIds(new Set((data ?? []).map((r: any) => r.membro_id)));
    })();
  }, [user, hasAny]);

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
  }, [statusFilter, q, refreshKey]);

  const onConfirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteSaleCascade(toDelete.id);
      toast.success("Venda excluída");
      setToDelete(null);
      setRefreshKey((k) => k + 1);
      router.invalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao excluir venda");
    } finally {
      setDeleting(false);
    }
  };

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
          {sales.map((s) => {
            const canDelete = canDeleteSale(user?.id, hasAny, s, teamIds);
            return (
              <div key={s.id} className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50">
                <Link to="/vendas/$id" params={{ id: s.id }} className="flex-1">
                  <div className="text-sm font-medium">{s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.valor_negociado ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}` : "Valor pendente"} ·
                    {" "}atualizado em {new Date(s.updated_at).toLocaleDateString("pt-BR")}
                  </div>
                </Link>
                <div className="flex items-center gap-2">
                  <StatusBadge status={s.status as SaleStatus} />
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setToDelete(s); }}
                      aria-label="Excluir venda"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta venda?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && (
                <>
                  <b>{toDelete.imovel_id || toDelete.codigo_interno || `Venda #${toDelete.id.slice(0, 8)}`}</b>
                  {" "}será excluída permanentemente. Todos os documentos, partes, pagamentos, comentários e ocorrências relacionados serão removidos. Essa ação não pode ser desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={onConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo..." : "Excluir venda"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
