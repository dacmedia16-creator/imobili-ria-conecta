import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { AgingBadge } from "@/components/AgingBadge";
import { STATUS_LABEL, proximoResponsavelRoles, type SaleStatus } from "@/lib/status";
import { canDeleteSale, deleteSaleCascade } from "@/lib/permissions";
import { fetchLedMemberIds } from "@/lib/team";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vendas/")({
  head: () => ({ meta: [{ title: "Vendas" }] }),
  component: SalesList,
});

const PAGE_SIZE = 30;
const SALE_COLUMNS = "id, status, valor_negociado, imovel_id, codigo_interno, corretor_captador, corretor_vendedor, updated_at, created_at, corretor_id";

function SalesList() {
  const { user, hasAny } = useAuth();
  const router = useRouter();
  const [sales, setSales] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stageSince, setStageSince] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<string>("todas");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profileName, setProfileName] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    if (!hasAny(["gestor", "team_leader"])) return;
    fetchLedMemberIds(user.id).then(setTeamIds);
  }, [user, hasAny]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, nome");
      const names: Record<string, string> = {};
      for (const p of data ?? []) names[p.id] = p.nome ?? p.id;
      setProfileName(names);
    })();
  }, []);

  // Busca por nome de comprador/vendedor (sale_parties) precisa de uma consulta à parte pra achar
  // quais vendas batem, já que esse dado não mora em "sales" — o resultado vira um id.in.(...)
  // somado aos campos de texto que já existem na própria linha da venda.
  const fetchPage = useCallback(async (from: number) => {
    let query = supabase.from("sales").select(SALE_COLUMNS).order("updated_at", { ascending: false });
    if (statusFilter !== "todas") query = query.eq("status", statusFilter as any);
    // "," e "()" têm significado especial na sintaxe de filtro do PostgREST (separador de
    // condições e escopo de valor) — removidos aqui pra um termo de busca com esses caracteres
    // não quebrar a query. O ilike em si (comparação por método, não string crua) não precisa disso.
    const qSafe = q.replace(/[,()]/g, "").trim();
    if (qSafe) {
      const { data: matchingParties } = await supabase.from("sale_parties").select("sale_id").ilike("nome", `%${qSafe}%`);
      const partySaleIds = Array.from(new Set((matchingParties ?? []).map((p: any) => p.sale_id)));
      const orParts = [
        `imovel_id.ilike.%${qSafe}%`,
        `codigo_interno.ilike.%${qSafe}%`,
        `corretor_captador.ilike.%${qSafe}%`,
        `corretor_vendedor.ilike.%${qSafe}%`,
      ];
      if (partySaleIds.length) orParts.push(`id.in.(${partySaleIds.join(",")})`);
      query = query.or(orParts.join(","));
    }
    const { data } = await query.range(from, from + PAGE_SIZE - 1);
    return data ?? [];
  }, [statusFilter, q]);

  // "Nesta etapa há X dias": timestamp da última troca de status (fallback: criação da venda, se nunca mudou)
  const mergeStageSince = async (ids: string[]) => {
    if (!ids.length) return;
    const { data: hist } = await supabase
      .from("sale_status_history")
      .select("sale_id, created_at")
      .in("sale_id", ids)
      .order("created_at", { ascending: false });
    setStageSince((prev) => {
      const next = { ...prev };
      for (const h of hist ?? []) {
        if (!next[h.sale_id]) next[h.sale_id] = h.created_at;
      }
      return next;
    });
  };

  // Cada tecla digitada na busca dispara uma nova query, sem cancelar a anterior — sem essa
  // trava, uma resposta de uma busca mais antiga (com termo menor, resultado mais amplo) podia
  // chegar depois da mais recente e sobrescrever a lista com um resultado errado/desatualizado.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    const rows = await fetchPage(0);
    if (requestIdRef.current !== myRequestId) return;
    setSales(rows);
    setStageSince({});
    setHasMore(rows.length === PAGE_SIZE);
    await mergeStageSince(rows.map((s: any) => s.id));
    if (requestIdRef.current !== myRequestId) return;
    setLoading(false);
  }, [fetchPage]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const loadMore = async () => {
    const myRequestId = ++requestIdRef.current;
    setLoadingMore(true);
    const rows = await fetchPage(sales.length);
    if (requestIdRef.current !== myRequestId) return;
    setSales((prev) => [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    await mergeStageSince(rows.map((s: any) => s.id));
    if (requestIdRef.current !== myRequestId) return;
    setLoadingMore(false);
  };

  const onConfirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const { orphanedFiles } = await deleteSaleCascade(toDelete.id);
      if (orphanedFiles.length > 0) {
        toast.warning(`Venda excluída, mas ${orphanedFiles.length} arquivo(s) não puderam ser removidos do armazenamento.`);
      } else {
        toast.success("Venda excluída");
      }
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
        <div className="flex gap-2">
          {hasAny(["corretor", "gestor", "team_leader"]) && (
            <Button asChild><Link to="/vendas/nova"><Plus className="mr-2 h-4 w-4" />Nova Venda</Link></Button>
          )}
          {hasAny(["lancamento"]) && (
            <Button asChild variant={hasAny(["corretor", "gestor", "team_leader"]) ? "outline" : "default"}>
              <Link to="/vendas/lancamento/nova"><Plus className="mr-2 h-4 w-4" />Novo Lançamento</Link>
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input placeholder="Buscar por código, imóvel ou pessoa envolvida" value={q} onChange={(e) => setQ(e.target.value)} className="md:max-w-sm" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="md:w-64"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos os status</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {loading && <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>}
          {!loading && sales.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {hasAny(["corretor"]) && !hasAny(["gestor","team_leader","juridico","financeiro","admin","super_admin"]) && (
                <>Você ainda não criou nenhuma venda. Clique em <b>Nova Venda</b> para começar.</>
              )}
              {hasAny(["lancamento"]) && !hasAny(["corretor","gestor","team_leader","juridico","financeiro","admin","super_admin"]) && (
                <>Você ainda não criou nenhum lançamento. Clique em <b>Novo Lançamento</b> para começar.</>
              )}
              {hasAny(["gestor","team_leader"]) && !hasAny(["financeiro","admin","super_admin"]) && (
                <>Nenhuma venda visível. Peça ao administrador para vincular corretores à sua equipe.</>
              )}
              {hasAny(["juridico"]) && !hasAny(["financeiro","admin","super_admin"]) && (
                <>Nenhuma venda aprovada pelo gestor ainda. Você só enxerga vendas a partir dessa etapa.</>
              )}
              {hasAny(["financeiro","admin","super_admin"]) && (<>Nenhuma venda encontrada com o filtro atual.</>)}
            </div>
          )}
          {!loading && sales.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Imóvel / código</TableHead>
                    <TableHead>Corretor</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Nesta etapa</TableHead>
                    <TableHead>Atualizado em</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((s) => {
                    const canDelete = canDeleteSale(user?.id, hasAny, s, teamIds);
                    const minhaVez = proximoResponsavelRoles(s.status as SaleStatus).some((papel) =>
                      papel === "corretor" ? s.corretor_id === user?.id
                      : papel === "financeiro" ? hasAny(["financeiro", "admin", "super_admin"])
                      : papel === "gestor" ? hasAny(["gestor", "team_leader"])
                      : hasAny([papel])
                    );
                    return (
                      <TableRow key={s.id} className={`cursor-pointer ${minhaVez ? "border-l-2 border-l-destructive" : ""}`} onClick={() => router.navigate({ to: "/vendas/$id", params: { id: s.id } })}>
                        <TableCell className="font-medium">{s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`}</TableCell>
                        <TableCell className="text-muted-foreground">{profileName[s.corretor_id] ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {s.valor_negociado ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}` : "Pendente"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={s.status as SaleStatus} />
                            {minhaVez && (
                              <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                                Sua vez
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell><AgingBadge since={stageSince[s.id] ?? s.created_at} /></TableCell>
                        <TableCell className="text-muted-foreground">{new Date(s.updated_at).toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setToDelete(s); }}
                              aria-label="Excluir venda"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {hasMore && (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? "Carregando..." : "Carregar mais"}
                  </Button>
                </div>
              )}
            </>
          )}
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
