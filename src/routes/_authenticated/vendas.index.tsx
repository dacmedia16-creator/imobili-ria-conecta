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
import {
  STATUS_LABEL, VEZ_DE_AGIR_LABEL, proximoResponsavelRoles, statusDaVezDeAgir,
  vezDeAgir, type SaleStatus, type VezDeAgir,
} from "@/lib/status";
import { canDeleteSale, deleteSaleCascade } from "@/lib/permissions";
import { fetchLedMemberIds } from "@/lib/team";
import { Plus, Trash2, SlidersHorizontal, ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { idsDeContratosAssinadosNoPeriodo, resumirVendas } from "@/lib/vendas-resumo";
import { fetchVendasComerciaisValidas } from "@/lib/vendas-comerciais-query";
import { periodoMesAnterior, periodoMesAtual } from "@/lib/vendas-periodo";

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
  const [vezFilter, setVezFilter] = useState<string>("todas");
  const [diasFilter, setDiasFilter] = useState<number | null>(null);
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profileName, setProfileName] = useState<Record<string, string>>({});
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [totalValor, setTotalValor] = useState(0);
  const [contratosAssinadosCount, setContratosAssinadosCount] = useState(0);
  const [contratosAssinadosValor, setContratosAssinadosValor] = useState(0);
  const [soMinhaVez, setSoMinhaVez] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [teamOptions, setTeamOptions] = useState<{ id: string; label: string }[]>([]);
  const [memberIdsByTeam, setMemberIdsByTeam] = useState<Record<string, string[]>>({});
  const [equipeFilter, setEquipeFilter] = useState<string>("todas");
  const [liderIdByCorretor, setLiderIdByCorretor] = useState<Record<string, string>>({});

  const aplicarPeriodo = (periodo: { de: string; ate: string }) => {
    setDiasFilter(null);
    setDataDe(periodo.de);
    setDataAte(periodo.ate);
  };

  useEffect(() => {
    if (!user) return;
    if (!hasAny(["gestor", "team_leader"])) return;
    fetchLedMemberIds(user.id).then(setTeamIds);
  }, [user, hasAny]);

  // Jurídico/financeiro/admin/super admin enxergam vendas de todas as equipes por definição —
  // esse filtro deixa restringir a visão a uma equipe específica. Gestor/team_leader já enxerga
  // só a própria equipe (via RLS), então não precisam desse seletor.
  useEffect(() => {
    if (!hasAny(["juridico", "admin", "super_admin", "financeiro"])) return;
    (async () => {
      const [{ data: teams }, { data: members }, { data: coLeaders }] = await Promise.all([
        supabase.from("teams").select("id, nome, parent_team_id, lider_id"),
        supabase.from("team_members").select("membro_id, team_id"),
        supabase.from("team_co_leaders").select("user_id, team_id"),
      ]);
      const byId: Record<string, { nome: string; parent_team_id: string | null; lider_id: string | null }> = {};
      (teams ?? []).forEach((t: any) => { byId[t.id] = t; });
      const byTeam: Record<string, string[]> = {};
      // Líder e líder(es) auxiliar(es) também entram no filtro por equipe, não só quem está em
      // team_members — sem isso, uma venda cujo dono é o próprio líder (ex: papel Lançamento
      // acumulado com Gestor, que sobe a venda em nome próprio, não como membro de ninguém) sumia
      // do filtro por não estar em team_members.
      (teams ?? []).forEach((t: any) => { if (t.lider_id) (byTeam[t.id] ??= []).push(t.lider_id); });
      (coLeaders ?? []).forEach((c: any) => { (byTeam[c.team_id] ??= []).push(c.user_id); });
      (members ?? []).forEach((m: any) => { (byTeam[m.team_id] ??= []).push(m.membro_id); });
      const topTeams = [...(teams ?? [])].filter((t: any) => !t.parent_team_id).sort((a: any, b: any) => a.nome.localeCompare(b.nome));
      const options: { id: string; label: string }[] = [];
      for (const top of topTeams) {
        const subs = (teams ?? []).filter((t: any) => t.parent_team_id === top.id).sort((a: any, b: any) => a.nome.localeCompare(b.nome));
        for (const t of [top, ...subs]) {
          options.push({ id: t.id, label: t.parent_team_id ? `${byId[t.parent_team_id]?.nome ?? ""} → ${t.nome}` : t.nome });
        }
      }
      setTeamOptions(options);
      setMemberIdsByTeam(byTeam);

      // Corretor → líder da equipe (mesma resolução membro/líder/líder-auxiliar de cima, mas
      // invertida: de quem é membro para quem lidera) — pra mostrar de qual gestor/team_leader
      // cada corretor é na coluna "Gestor/Líder", já que quem vê vendas de várias equipes ao mesmo
      // tempo (jurídico/financeiro/admin) não tem como saber isso de cabeça.
      const teamIdByCorretor: Record<string, string> = {};
      (members ?? []).forEach((m: any) => { if (!teamIdByCorretor[m.membro_id]) teamIdByCorretor[m.membro_id] = m.team_id; });
      (teams ?? []).forEach((t: any) => { if (t.lider_id && !teamIdByCorretor[t.lider_id]) teamIdByCorretor[t.lider_id] = t.id; });
      (coLeaders ?? []).forEach((c: any) => { if (!teamIdByCorretor[c.user_id]) teamIdByCorretor[c.user_id] = c.team_id; });
      const liderByCorretor: Record<string, string> = {};
      for (const [corretorId, teamId] of Object.entries(teamIdByCorretor)) {
        const liderId = byId[teamId]?.lider_id;
        if (liderId) liderByCorretor[corretorId] = liderId;
      }
      setLiderIdByCorretor(liderByCorretor);
    })();
  }, [hasAny]);

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
  // somado aos campos de texto que já existem na própria linha da venda. Extraído de fetchPage
  // pra ser reaproveitado pelo resumo (contador + valor total), que precisa dos mesmos filtros
  // mas sem a paginação.
  const buildFilters = useCallback(async (): Promise<{ status?: string; statuses?: SaleStatus[]; orParts?: string[]; desde?: string; ate?: string; corretorIds?: string[] }> => {
    const filters: { status?: string; statuses?: SaleStatus[]; orParts?: string[]; desde?: string; ate?: string; corretorIds?: string[] } = {};
    if (statusFilter !== "todas") filters.status = statusFilter;
    if (statusFilter === "todas" && vezFilter !== "todas") filters.statuses = statusDaVezDeAgir(vezFilter as VezDeAgir);
    // Sem membro nenhum na equipe escolhida (equipe recém-criada, sem corretor vinculado): usa um
    // uuid que nunca bate em vez de deixar o .in() vazio, que o PostgREST trataria como "sem filtro".
    if (equipeFilter !== "todas") filters.corretorIds = memberIdsByTeam[equipeFilter]?.length ? memberIdsByTeam[equipeFilter] : ["00000000-0000-0000-0000-000000000000"];
    // Chip de dias e período customizado (De/Até) são mutualmente exclusivos — os handlers do
    // chip e dos inputs de data já zeram um ao escolher o outro, então só um dos dois se aplica aqui.
    if (diasFilter) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - diasFilter);
      filters.desde = cutoff.toISOString();
    } else {
      if (dataDe) filters.desde = new Date(`${dataDe}T00:00:00`).toISOString();
      if (dataAte) filters.ate = new Date(`${dataAte}T23:59:59.999`).toISOString();
    }
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
      filters.orParts = orParts;
    }
    return filters;
  }, [statusFilter, vezFilter, diasFilter, dataDe, dataAte, q, equipeFilter, memberIdsByTeam]);

  const applyFilters = (query: any, filters: { status?: string; statuses?: SaleStatus[]; orParts?: string[]; desde?: string; ate?: string; corretorIds?: string[] }, incluirPeriodo = true) => {
    let out = query;
    if (filters.status) out = out.eq("status", filters.status);
    if (filters.statuses) out = out.in("status", filters.statuses);
    // Filtra por "atualizado em" (mesma coluna exibida na tabela e usada pra ordenar a lista),
    // não pela data de criação — assim o filtro reflete o mesmo recorte que a pessoa já enxerga.
    if (incluirPeriodo && filters.desde) out = out.gte("updated_at", filters.desde);
    if (incluirPeriodo && filters.ate) out = out.lte("updated_at", filters.ate);
    if (filters.orParts) out = out.or(filters.orParts.join(","));
    if (filters.corretorIds) out = out.in("corretor_id", filters.corretorIds);
    return out;
  };

  const fetchPage = useCallback(async (from: number) => {
    const filters = await buildFilters();
    const query = applyFilters(supabase.from("sales").select(SALE_COLUMNS).order("updated_at", { ascending: false }), filters);
    const { data } = await query.range(from, from + PAGE_SIZE - 1);
    return data ?? [];
  }, [buildFilters]);

  // Contador + soma do valor negociado de TODAS as vendas que batem no filtro atual (não só a
  // página carregada) — só a coluna valor_negociado, então a soma sai barata mesmo pra bases maiores.
  const fetchSummary = useCallback(async () => {
    const filters = await buildFilters();
    const countQuery = applyFilters(supabase.from("sales").select("id", { count: "exact", head: true }), filters);
    const sumQuery = applyFilters(
      supabase.from("sales").select("status, modalidade, valor_negociado").limit(5000),
      filters,
    );
    const vendasComerciais = await fetchVendasComerciaisValidas();
    const idsAssinadosNoPeriodo = idsDeContratosAssinadosNoPeriodo(vendasComerciais, filters);
    const contratosQuery = idsAssinadosNoPeriodo.length
      ? applyFilters(
          supabase
            .from("sales")
            .select("status, modalidade, valor_negociado")
            .in("id", idsAssinadosNoPeriodo)
            .limit(5000),
          filters,
          false,
        )
      : Promise.resolve({ data: [], error: null });
    const [{ count }, { data: valores }, { data: contratos, error: contratosError }] =
      await Promise.all([countQuery, sumQuery, contratosQuery]);
    if (contratosError) throw contratosError;
    const resumo = resumirVendas(valores ?? []);
    const resumoContratos = resumirVendas(contratos ?? []);
    setTotalCount(count ?? 0);
    setTotalValor(resumo.valorTotal);
    setContratosAssinadosCount(resumoContratos.quantidadeComContratoAssinado);
    setContratosAssinadosValor(resumoContratos.valorComContratoAssinado);
  }, [buildFilters]);

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
    const [rows] = await Promise.all([fetchPage(0), fetchSummary()]);
    if (requestIdRef.current !== myRequestId) return;
    setSales(rows);
    setStageSince({});
    setHasMore(rows.length === PAGE_SIZE);
    await mergeStageSince(rows.map((s: any) => s.id));
    if (requestIdRef.current !== myRequestId) return;
    setLoading(false);
  }, [fetchPage, fetchSummary]);

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

  // admin/super_admin enxerga tudo por definição — "Sua vez" é pra quem tem uma fila operacional
  // de verdade, não pra quem só está supervisionando o sistema.
  const isOverseer = hasAny(["admin", "super_admin"]);
  const podeTerFila = !isOverseer && hasAny(["corretor", "gestor", "team_leader", "juridico", "financeiro"]);
  const saleIsMinhaVez = useCallback((s: any) => {
    if (isOverseer) return false;
    return proximoResponsavelRoles(s.status as SaleStatus).some((papel) =>
      papel === "corretor" ? s.corretor_id === user?.id
      // gestor/team_leader só é "a vez dele" se ele lidera o corretor da venda — sem esse filtro,
      // quem também é jurídico/financeiro (e por isso enxerga vendas de times que não lidera) via
      // o badge acender pra toda venda parada numa etapa do gestor, mesmo fora da própria equipe.
      : papel === "gestor" ? hasAny(["gestor", "team_leader"]) && teamIds.has(s.corretor_id)
      : hasAny([papel])
    );
  }, [isOverseer, user?.id, hasAny, teamIds]);
  const displayedSales = soMinhaVez ? sales.filter(saleIsMinhaVez) : sales;

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
        <CardHeader className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Input placeholder="Buscar por código, imóvel ou pessoa envolvida" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 md:max-w-sm" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 md:hidden"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <SlidersHorizontal className="mr-1 h-4 w-4" />
              Filtros
              <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </Button>
          </div>
          <div className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-3 md:flex md:flex-row md:flex-wrap md:items-center`}>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="md:w-64"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos os status</SelectItem>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={vezFilter} onValueChange={setVezFilter}>
              <SelectTrigger className="md:w-56"><SelectValue placeholder="Aguardando ação de" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Aguardando ação de...</SelectItem>
                {Object.entries(VEZ_DE_AGIR_LABEL).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            {hasAny(["juridico", "admin", "super_admin", "financeiro"]) && teamOptions.length > 0 && (
              <Select value={equipeFilter} onValueChange={setEquipeFilter}>
                <SelectTrigger className="md:w-56"><SelectValue placeholder="Equipe" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as equipes</SelectItem>
                  {teamOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={dataDe}
                onChange={(e) => { setDataDe(e.target.value); setDiasFilter(null); }}
                className="w-[9.5rem]"
                aria-label="Atualizado de"
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="date"
                value={dataAte}
                onChange={(e) => { setDataAte(e.target.value); setDiasFilter(null); }}
                className="w-[9.5rem]"
                aria-label="Atualizado até"
              />
              {(dataDe || dataAte) && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setDataDe(""); setDataAte(""); }}>
                  Limpar
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => aplicarPeriodo(periodoMesAtual())}>
                Mês atual
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => aplicarPeriodo(periodoMesAnterior())}>
                Mês anterior
              </Button>
            </div>
            {podeTerFila && (
              <Button
                type="button"
                variant={soMinhaVez ? "default" : "outline"}
                size="sm"
                onClick={() => setSoMinhaVez((v) => !v)}
                className={soMinhaVez ? "bg-destructive hover:bg-destructive/90" : ""}
              >
                Só minha vez
              </Button>
            )}
          </div>
          {!loading && totalCount !== null && (
            <p className="text-sm text-muted-foreground">
              {totalCount} {totalCount === 1 ? "venda encontrada" : "vendas encontradas"}
              {totalValor > 0 && ` · R$ ${totalValor.toLocaleString("pt-BR")} no total`}
              <br />
              {contratosAssinadosCount} {contratosAssinadosCount === 1 ? "contrato assinado no período" : "contratos assinados no período"}
              {` · R$ ${contratosAssinadosValor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em vendas assinadas`}
            </p>
          )}
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
          {!loading && sales.length > 0 && displayedSales.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma venda esperando sua ação na página carregada. {hasMore && "Carregue mais vendas ou desative o filtro pra ver o restante."}
            </p>
          )}
          {!loading && displayedSales.length > 0 && (
            <>
              {/* Mobile: cards empilhados — a tabela força colunas largas demais e corta o texto
                  do status numa tela estreita. A partir de md, volta pra tabela (mais densa, melhor
                  pra comparar várias vendas de uma vez, o que faz sentido numa tela maior). */}
              <div className="space-y-2 md:hidden">
                {displayedSales.map((s) => {
                  const canDelete = canDeleteSale(user?.id, hasAny, s, teamIds);
                  const minhaVez = saleIsMinhaVez(s);
                  return (
                    <div
                      key={s.id}
                      className={`cursor-pointer rounded-md border p-3 ${minhaVez ? "border-l-2 border-l-destructive" : ""}`}
                      onClick={() => router.navigate({ to: "/vendas/$id", params: { id: s.id } })}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`}</div>
                          <div className="truncate text-sm text-muted-foreground">
                            {profileName[s.corretor_id] ?? "—"}
                            {hasAny(["juridico", "admin", "super_admin", "financeiro"]) && liderIdByCorretor[s.corretor_id] && (
                              <> · {profileName[liderIdByCorretor[s.corretor_id]] ?? "—"}</>
                            )}
                          </div>
                        </div>
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-mr-2 -mt-1 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setToDelete(s); }}
                            aria-label="Excluir venda"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={s.status as SaleStatus} />
                        <VezDeAgirBadge status={s.status as SaleStatus} />
                        {minhaVez && (
                          <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                            Sua vez
                          </span>
                        )}
                        <AgingBadge since={stageSince[s.id] ?? s.created_at} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {s.valor_negociado ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}` : "Valor pendente"}
                        </span>
                        <span className="text-xs text-muted-foreground">{new Date(s.updated_at).toLocaleDateString("pt-BR")}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Imóvel / código</TableHead>
                      <TableHead>Corretor</TableHead>
                      {hasAny(["juridico", "admin", "super_admin", "financeiro"]) && <TableHead>Gestor/Líder</TableHead>}
                      <TableHead>Valor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Vez de agir</TableHead>
                      <TableHead>Nesta etapa</TableHead>
                      <TableHead>Atualizado em</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedSales.map((s) => {
                      const canDelete = canDeleteSale(user?.id, hasAny, s, teamIds);
                      const minhaVez = saleIsMinhaVez(s);
                      return (
                        <TableRow key={s.id} className={`cursor-pointer ${minhaVez ? "border-l-2 border-l-destructive" : ""}`} onClick={() => router.navigate({ to: "/vendas/$id", params: { id: s.id } })}>
                          <TableCell className="font-medium">{s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`}</TableCell>
                          <TableCell className="text-muted-foreground">{profileName[s.corretor_id] ?? "—"}</TableCell>
                          {hasAny(["juridico", "admin", "super_admin", "financeiro"]) && (
                            <TableCell className="text-muted-foreground">{profileName[liderIdByCorretor[s.corretor_id]] ?? "—"}</TableCell>
                          )}
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
                          <TableCell><VezDeAgirBadge status={s.status as SaleStatus} /></TableCell>
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
              </div>
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

const VEZ_DE_AGIR_TONE: Record<VezDeAgir, string> = {
  corretor: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  gestor: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  financeiro: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  juridico: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  concluido: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
};

function VezDeAgirBadge({ status }: { status: SaleStatus }) {
  const responsavel = vezDeAgir(status);
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${VEZ_DE_AGIR_TONE[responsavel]}`}>
      {VEZ_DE_AGIR_LABEL[responsavel]}
    </span>
  );
}
