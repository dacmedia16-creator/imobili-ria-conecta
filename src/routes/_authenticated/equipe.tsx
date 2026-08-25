import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { listCorretoresDisponiveis, listGestores } from "@/lib/team.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Search, Plus, Users, Crown, UserPlus, FolderPlus, Pencil, Trash2, X, TrendingUp } from "lucide-react";
import {
  fetchComissaoPorBeneficiario,
  type ComissaoBeneficiarioResumo,
} from "@/lib/comissao-por-beneficiario";
import { fetchMetricasSemParceria } from "@/lib/metricas-sem-parceria-query";

export const Route = createFileRoute("/_authenticated/equipe")({
  head: () => ({ meta: [{ title: "Equipes" }] }),
  component: EquipesPage,
});

const TEAM_COLORS = ["#22c55e", "#06b6d4", "#6366f1", "#3b82f6", "#f59e0b", "#ef4444", "#ec4899", "#f97316"];
const FECHADAS = ["contrato_assinado", "ocorrencia_concluida"];
const money = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
/** Sempre dia 1 do mês corrente — mesmo formato que a coluna metas.mes exige (CHECK trava isso no banco). */
const mesAtualISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const mesAtualLabel = () => new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
/** Estado inicial (e de "sem vendas") do resumo de comissão por beneficiário — mesmo formato em
 * VisaoGeralCard e DesempenhoDialog, extraído pra não divergir entre os dois. */
const RESUMO_VAZIO: ComissaoBeneficiarioResumo = {
  porBeneficiario: {},
  semVinculo: { quantidade: 0, valor: 0 },
  parceriaExterna: { quantidade: 0, valor: 0 },
};

type Team = { id: string; nome: string; cor: string; lider_id: string; parent_team_id: string | null };
type Profile = { id: string; nome: string; email: string | null };

function EquipesPage() {
  const { user, hasAny } = useAuth();
  const allowed = hasAny(["gestor", "team_leader", "admin", "super_admin"]);
  const isAdminLike = hasAny(["admin", "super_admin"]);
  const listGestoresFn = useServerFn(listGestores);

  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<{ team_id: string; membro_id: string }[]>([]);
  const [coLeaders, setCoLeaders] = useState<{ team_id: string; user_id: string }[]>([]);
  const [allSales, setAllSales] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [gestores, setGestores] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [formState, setFormState] = useState<{ mode: "create" | "create-sub" | "edit"; parent?: Team; initial?: Team } | null>(null);
  const [membrosTeam, setMembrosTeam] = useState<Team | null>(null);
  const [coLideresTeam, setCoLideresTeam] = useState<Team | null>(null);
  const [desempenhoTeam, setDesempenhoTeam] = useState<Team | null>(null);
  const [deleteTeam, setDeleteTeam] = useState<Team | null>(null);

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return; }
    setLoading(true);
    const [{ data: t }, { data: tm }, { data: cl }, salesRes] = await Promise.all([
      supabase.from("teams").select("id, nome, cor, lider_id, parent_team_id").order("created_at", { ascending: true }),
      supabase.from("team_members").select("team_id, membro_id"),
      supabase.from("team_co_leaders").select("team_id, user_id"),
      isAdminLike
        // Venda cancelada/arquivada não deve compor a Visão geral (vendas/valor negociado/comissão
        // do ranking) — ela some do ranking, mas continua acessível na própria tela da venda.
        ? supabase.from("sales").select("id, corretor_id, status, valor_negociado, valor_total_comissao").not("status", "in", "(cancelada,arquivada)")
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setTeams(t ?? []);
    setMembers(tm ?? []);
    setCoLeaders(cl ?? []);
    setAllSales(salesRes.data ?? []);

    const ids = new Set<string>();
    (t ?? []).forEach((x: any) => ids.add(x.lider_id));
    (tm ?? []).forEach((x: any) => ids.add(x.membro_id));
    (cl ?? []).forEach((x: any) => ids.add(x.user_id));
    (salesRes.data ?? []).forEach((s: any) => ids.add(s.corretor_id));
    const idList = Array.from(ids);
    const { data: profs } = idList.length
      ? await supabase.from("profiles").select("id, nome, email").in("id", idList)
      : { data: [] as Profile[] };
    const map: Record<string, Profile> = {};
    (profs ?? []).forEach((p: any) => { map[p.id] = p; });
    setProfiles(map);
    setLoading(false);
  }, [allowed, isAdminLike]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!allowed) return;
    listGestoresFn().then(setGestores).catch(() => {});
  }, [allowed, listGestoresFn]);

  const membersByTeam = useMemo(() => {
    const map: Record<string, string[]> = {};
    members.forEach((m) => { (map[m.team_id] ??= []).push(m.membro_id); });
    return map;
  }, [members]);

  const coLeadersByTeam = useMemo(() => {
    const map: Record<string, string[]> = {};
    coLeaders.forEach((c) => { (map[c.team_id] ??= []).push(c.user_id); });
    return map;
  }, [coLeaders]);

  const childrenByParent = useMemo(() => {
    const map: Record<string, Team[]> = {};
    teams.forEach((t) => { if (t.parent_team_id) (map[t.parent_team_id] ??= []).push(t); });
    return map;
  }, [teams]);

  const topLevel = useMemo(() => teams.filter((t) => !t.parent_team_id), [teams]);

  // Gestor (ou líder auxiliar — "braço direito") gerencia a própria equipe e sub-equipes dela;
  // admin/super_admin gerenciam tudo. Espelha exatamente a regra da RLS (leads_team_or_parent),
  // então nunca mostra um botão que a API recusaria.
  const canManageTeam = useCallback((team: Team) => {
    if (isAdminLike) return true;
    if (!user?.id) return false;
    if (team.lider_id === user.id) return true;
    if ((coLeadersByTeam[team.id] ?? []).includes(user.id)) return true;
    const parent = team.parent_team_id ? teams.find((t) => t.id === team.parent_team_id) : null;
    if (!parent) return false;
    return parent.lider_id === user.id || (coLeadersByTeam[parent.id] ?? []).includes(user.id);
  }, [isAdminLike, user?.id, teams, coLeadersByTeam]);

  // Pro seletor de "Team Leader": admin escolhe qualquer gestor; gestor só pode se nomear a si mesmo.
  const liderOptions = useMemo(() => (isAdminLike ? gestores : gestores.filter((g) => g.id === user?.id)), [isAdminLike, gestores, user?.id]);

  const filteredTop = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return topLevel;
    return topLevel.filter((t) =>
      t.nome.toLowerCase().includes(q) || (childrenByParent[t.id] ?? []).some((c) => c.nome.toLowerCase().includes(q)),
    );
  }, [topLevel, search, childrenByParent]);

  const excluirEquipe = async () => {
    if (!deleteTeam) return;
    const { error } = await supabase.from("teams").delete().eq("id", deleteTeam.id);
    if (error) toast.error(error.message);
    else { toast.success("Equipe excluída"); load(); }
    setDeleteTeam(null);
  };

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a gestores, team leaders e administradores.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Equipes</h1>
          <p className="text-sm text-muted-foreground">Organize seus corretores em equipes e sub-equipes.</p>
        </div>
        {isAdminLike ? (
          <Button className="gap-2" onClick={() => setFormState({ mode: "create" })}>
            <Plus className="h-4 w-4" />Nova Equipe
          </Button>
        ) : (
          // Gestor não cria equipe nova por aqui -- equipe própria já é criada sozinha (ou já existe)
          // quando ele cria o primeiro corretor em Usuários (ver admin-users.functions.ts). Deixar
          // "Nova Equipe" solto pra gestor permitia criar equipes duplicadas/soltas sem membro nenhum.
          <Button className="gap-2" asChild>
            <Link to="/admin/usuarios"><UserPlus className="h-4 w-4" />Criar usuário</Link>
          </Button>
        )}
      </div>

      {isAdminLike && !loading && (
        <VisaoGeralCard teams={teams} members={members} allSales={allSales} profiles={profiles} />
      )}

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar equipe..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : filteredTop.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma equipe encontrada.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTop.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              profiles={profiles}
              membersByTeam={membersByTeam}
              coLeadersByTeam={coLeadersByTeam}
              subTeams={childrenByParent[team.id] ?? []}
              canManageTeam={canManageTeam}
              onMembros={setMembrosTeam}
              onCoLideres={setCoLideresTeam}
              onDesempenho={setDesempenhoTeam}
              onCreateSub={(t) => setFormState({ mode: "create-sub", parent: t })}
              onEdit={(t) => setFormState({ mode: "edit", initial: t })}
              onDelete={setDeleteTeam}
            />
          ))}
        </div>
      )}

      {desempenhoTeam && (
        <DesempenhoDialog
          team={desempenhoTeam}
          membroIds={membersByTeam[desempenhoTeam.id] ?? []}
          profiles={profiles}
          canManage={canManageTeam(desempenhoTeam)}
          onOpenChange={(open) => { if (!open) setDesempenhoTeam(null); }}
        />
      )}

      {formState && (
        <TeamFormDialog
          state={formState}
          gestores={liderOptions}
          onOpenChange={(open) => { if (!open) setFormState(null); }}
          onSaved={() => { setFormState(null); load(); }}
        />
      )}

      {membrosTeam && (
        <MembrosDialog
          team={membrosTeam}
          membroIds={membersByTeam[membrosTeam.id] ?? []}
          profiles={profiles}
          onOpenChange={(open) => { if (!open) setMembrosTeam(null); }}
          onChanged={load}
        />
      )}

      {coLideresTeam && (
        <CoLideresDialog
          team={coLideresTeam}
          coLiderIds={coLeadersByTeam[coLideresTeam.id] ?? []}
          gestores={gestores}
          profiles={profiles}
          onOpenChange={(open) => { if (!open) setCoLideresTeam(null); }}
          onChanged={load}
        />
      )}

      <AlertDialog open={!!deleteTeam} onOpenChange={(open) => { if (!open) setDeleteTeam(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{deleteTeam?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso remove a equipe, todas as suas sub-equipes e os vínculos de membro associados.
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={excluirEquipe}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function VisaoGeralCard({
  teams, members, allSales, profiles,
}: {
  teams: Team[];
  members: { team_id: string; membro_id: string }[];
  allSales: any[];
  profiles: Record<string, Profile>;
}) {
  const teamNameByMembro = useMemo(() => {
    const teamById: Record<string, Team> = {};
    teams.forEach((t) => { teamById[t.id] = t; });
    const map: Record<string, string> = {};
    members.forEach((m) => { map[m.membro_id] = teamById[m.team_id]?.nome ?? "—"; });
    return map;
  }, [teams, members]);

  // "Comissão" já foi soma de sales.valor_total_comissao por sales.corretor_id — atribuía a comissão
  // INTEIRA da venda a quem cadastrou, não a quem recebe (ver auditoria "comissão por corretor").
  // Agora soma occurrence_commissions por beneficiário real, mesma fonte de metas_progresso().
  const [comissaoResumo, setComissaoResumo] = useState<ComissaoBeneficiarioResumo>(RESUMO_VAZIO);
  const [vgvProprio, setVgvProprio] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const saleIds = allSales.map((s) => s.id);
    if (saleIds.length === 0) {
      setComissaoResumo(RESUMO_VAZIO);
      return;
    }
    let cancelado = false;
    Promise.all([fetchComissaoPorBeneficiario(saleIds), fetchMetricasSemParceria()])
      .then(([r, metricas]) => {
        if (!cancelado) {
          setComissaoResumo(r);
          setVgvProprio(new Map([...metricas].map(([id, m]) => [id, m.vgvProprio])));
        }
      })
      .catch((e: unknown) => console.error("fetchComissaoPorBeneficiario (Visão geral):", e));
    return () => {
      cancelado = true;
    };
  }, [allSales]);

  const ranking = useMemo(() => {
    const ids = new Set<string>([...members.map((m) => m.membro_id), ...allSales.map((s) => s.corretor_id)]);
    return Array.from(ids)
      .map((id) => {
        const vendas = allSales.filter((s) => s.corretor_id === id);
        const fechadas = vendas.filter((s) => FECHADAS.includes(s.status));
        return {
          id,
          nome: profiles[id]?.nome || profiles[id]?.email || id,
          equipe: teamNameByMembro[id] ?? "Sem equipe",
          total: vendas.length,
          fechadas: fechadas.length,
          negociado: vendas.reduce((s, v) => s + (vgvProprio.get(v.id) ?? 0), 0),
          comissao: comissaoResumo.porBeneficiario[id] ?? 0,
        };
      })
      .sort((a, b) => b.negociado - a.negociado);
  }, [members, allSales, profiles, teamNameByMembro, comissaoResumo, vgvProprio]);

  const totais = useMemo(() => ({
    equipes: teams.filter((t) => !t.parent_team_id).length,
    corretores: ranking.length,
    vendas: ranking.reduce((s, r) => s + r.total, 0),
    negociado: ranking.reduce((s, r) => s + r.negociado, 0),
    comissao: ranking.reduce((s, r) => s + r.comissao, 0),
  }), [teams, ranking]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Visão geral</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-5">
          <div><p className="text-xs text-muted-foreground">Equipes</p><p className="text-xl font-semibold">{totais.equipes}</p></div>
          <div><p className="text-xs text-muted-foreground">Corretores</p><p className="text-xl font-semibold">{totais.corretores}</p></div>
          <div><p className="text-xs text-muted-foreground">Vendas</p><p className="text-xl font-semibold">{totais.vendas}</p></div>
          <div><p className="text-xs text-muted-foreground">VGV REMAX (sem parceria)</p><p className="text-xl font-semibold">{money(totais.negociado)}</p></div>
          <div><p className="text-xs text-muted-foreground">Comissão interna (sem parceria)</p><p className="text-xl font-semibold">{money(totais.comissao)}</p></div>
        </div>
        {comissaoResumo.semVinculo.quantidade > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {comissaoResumo.semVinculo.quantidade} parcela(s) de comissão (
            {money(comissaoResumo.semVinculo.valor)}) sem vínculo de perfil confirmado — pendente de
            correção, não aparecem no total de nenhum corretor acima.
          </p>
        )}
        {comissaoResumo.parceriaExterna.quantidade > 0 && (
          <p className="text-xs text-muted-foreground">
            {comissaoResumo.parceriaExterna.quantidade} parcela(s) de comissão (
            {money(comissaoResumo.parceriaExterna.valor)}) de parceiro(s) externo(s) confirmado(s)
            (sem cadastro no sistema) — não entram no ranking por corretor, mas continuam
            contabilizadas nos totais financeiros e nos relatórios de parceria externa.
          </p>
        )}
        {ranking.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Corretor</TableHead>
                <TableHead>Equipe</TableHead>
                <TableHead>Vendas</TableHead>
                <TableHead>Fechadas</TableHead>
                <TableHead>VGV REMAX</TableHead>
                <TableHead>Comissão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranking.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{r.equipe}</TableCell>
                  <TableCell>{r.total}</TableCell>
                  <TableCell>{r.fechadas}</TableCell>
                  <TableCell>{money(r.negociado)}</TableCell>
                  <TableCell>{money(r.comissao)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TeamCard({
  team, profiles, membersByTeam, coLeadersByTeam, subTeams, canManageTeam, onMembros, onCoLideres, onDesempenho, onCreateSub, onEdit, onDelete,
}: {
  team: Team;
  profiles: Record<string, Profile>;
  membersByTeam: Record<string, string[]>;
  coLeadersByTeam: Record<string, string[]>;
  subTeams: Team[];
  canManageTeam: (t: Team) => boolean;
  onMembros: (t: Team) => void;
  onCoLideres: (t: Team) => void;
  onDesempenho: (t: Team) => void;
  onCreateSub: (t: Team) => void;
  onEdit: (t: Team) => void;
  onDelete: (t: Team) => void;
}) {
  const manageable = canManageTeam(team);
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <TeamRow team={team} profiles={profiles} memberCount={(membersByTeam[team.id] ?? []).length} coLiderIds={coLeadersByTeam[team.id] ?? []} />
        {manageable ? (
          <div className="flex flex-wrap gap-1.5 border-t pt-3">
            <Button size="icon" variant="outline" title="Ver equipe" onClick={() => onMembros(team)}>
              <Users className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => onMembros(team)}>
              <UserPlus className="h-3.5 w-3.5" />Membros
            </Button>
            <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => onCoLideres(team)}>
              <Crown className="h-3.5 w-3.5" />Líder auxiliar
            </Button>
            <Button size="icon" variant="outline" title="Desempenho" onClick={() => onDesempenho(team)}>
              <TrendingUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" title="Criar sub-equipe" onClick={() => onCreateSub(team)}>
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" title="Editar" onClick={() => onEdit(team)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" title="Excluir" onClick={() => onDelete(team)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ) : (
          <p className="border-t pt-3 text-xs text-muted-foreground">Equipe-mãe — gerenciada por {profiles[team.lider_id]?.nome || "outro líder"}.</p>
        )}

        {subTeams.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sub-equipes</div>
            {subTeams.map((sub) => (
              <div key={sub.id} className="space-y-2 rounded-md border p-3">
                <TeamRow team={sub} profiles={profiles} memberCount={(membersByTeam[sub.id] ?? []).length} coLiderIds={coLeadersByTeam[sub.id] ?? []} compact />
                {canManageTeam(sub) ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="icon" variant="outline" title="Ver equipe" onClick={() => onMembros(sub)}>
                      <Users className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => onMembros(sub)}>
                      <UserPlus className="h-3.5 w-3.5" />Membros
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => onCoLideres(sub)}>
                      <Crown className="h-3.5 w-3.5" />Líder auxiliar
                    </Button>
                    <Button size="icon" variant="outline" title="Desempenho" onClick={() => onDesempenho(sub)}>
                      <TrendingUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="outline" title="Editar" onClick={() => onEdit(sub)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="outline" title="Excluir" onClick={() => onDelete(sub)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Gerenciada por {profiles[sub.lider_id]?.nome || "outro líder"}.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeamRow({ team, profiles, memberCount, coLiderIds, compact }: { team: Team; profiles: Record<string, Profile>; memberCount: number; coLiderIds?: string[]; compact?: boolean }) {
  const leader = profiles[team.lider_id];
  const coLideres = (coLiderIds ?? []).map((id) => profiles[id]?.nome || profiles[id]?.email || id).filter(Boolean);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: team.cor }} />
        <span className={compact ? "text-sm font-medium" : "font-semibold"}>{team.nome}</span>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Crown className="h-3.5 w-3.5" />
        <span>Team Leader: {leader?.nome || leader?.email || "—"}</span>
      </div>
      {coLideres.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Crown className="h-3.5 w-3.5" />
          <span>Líder(es) auxiliar(es): {coLideres.join(", ")}</span>
        </div>
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>{memberCount} membros</span>
      </div>
    </div>
  );
}

function TeamFormDialog({
  state, gestores, onOpenChange, onSaved,
}: {
  state: { mode: "create" | "create-sub" | "edit"; parent?: Team; initial?: Team };
  gestores: Profile[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState(state.initial?.nome ?? "");
  const [cor, setCor] = useState(state.initial?.cor ?? TEAM_COLORS[0]);
  const [liderId, setLiderId] = useState(state.initial?.lider_id ?? (gestores.length === 1 ? gestores[0].id : ""));
  const [saving, setSaving] = useState(false);

  const title = state.mode === "edit" ? "Editar equipe" : state.mode === "create-sub" ? `Nova sub-equipe de "${state.parent?.nome}"` : "Nova equipe";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || !liderId) return;
    setSaving(true);
    try {
      if (state.mode === "edit" && state.initial) {
        const { error } = await supabase.from("teams").update({ nome: nome.trim(), cor, lider_id: liderId }).eq("id", state.initial.id);
        if (error) throw error;
        toast.success("Equipe atualizada");
      } else {
        const { error } = await supabase.from("teams").insert({
          nome: nome.trim(),
          cor,
          lider_id: liderId,
          parent_team_id: state.mode === "create-sub" ? state.parent?.id : null,
        });
        if (error) throw error;
        toast.success("Equipe criada");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao salvar equipe");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="eq-nome">Nome</Label>
            <Input id="eq-nome" value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Ex.: Equipe Norte" />
          </div>
          <div>
            <Label>Cor</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {TEAM_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  className={`h-7 w-7 rounded-full ${cor === c ? "ring-2 ring-offset-2 ring-primary" : ""}`}
                  style={{ background: c }}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
          </div>
          <div>
            <Label>Team Leader</Label>
            <Select value={liderId} onValueChange={setLiderId}>
              <SelectTrigger><SelectValue placeholder="Selecione um gestor" /></SelectTrigger>
              <SelectContent>
                {gestores.map((g) => <SelectItem key={g.id} value={g.id}>{g.nome || g.email}</SelectItem>)}
              </SelectContent>
            </Select>
            {gestores.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Nenhum usuário com papel gestor ou team leader cadastrado ainda.</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || !nome.trim() || !liderId}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MembrosDialog({
  team, membroIds, profiles, onOpenChange, onChanged,
}: {
  team: Team;
  membroIds: string[];
  profiles: Record<string, Profile>;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const listCorretoresFn = useServerFn(listCorretoresDisponiveis);
  const [candidatos, setCandidatos] = useState<Profile[]>([]);
  const [selecionado, setSelecionado] = useState("");
  const [loadingCandidatos, setLoadingCandidatos] = useState(true);
  const [busy, setBusy] = useState(false);

  const carregarCandidatos = useCallback(async () => {
    setLoadingCandidatos(true);
    try {
      const data = await listCorretoresFn();
      setCandidatos(data as Profile[]);
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao listar corretores");
    } finally {
      setLoadingCandidatos(false);
    }
  }, [listCorretoresFn]);

  useEffect(() => { carregarCandidatos(); }, [carregarCandidatos]);

  const adicionar = async () => {
    if (!selecionado) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("team_members").insert({ team_id: team.id, membro_id: selecionado });
      if (error) throw error;
      toast.success("Corretor adicionado");
      setSelecionado("");
      await carregarCandidatos();
      onChanged();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao adicionar corretor");
    } finally {
      setBusy(false);
    }
  };

  const remover = async (membroId: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("team_members").delete().eq("membro_id", membroId);
      if (error) throw error;
      toast.success("Corretor removido");
      await carregarCandidatos();
      onChanged();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao remover corretor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Membros — {team.nome}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            {membroIds.length === 0 && <p className="text-sm text-muted-foreground">Nenhum corretor nesta equipe ainda.</p>}
            {membroIds.map((id) => (
              <div key={id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span>{profiles[id]?.nome || profiles[id]?.email || id}</span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => remover(id)} title="Remover da equipe">
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2 border-t pt-3">
            <div className="flex-1">
              <Label>Adicionar corretor</Label>
              {loadingCandidatos ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : candidatos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum corretor disponível — todos já estão em alguma equipe.</p>
              ) : (
                <Select value={selecionado} onValueChange={setSelecionado}>
                  <SelectTrigger><SelectValue placeholder="Selecione um corretor" /></SelectTrigger>
                  <SelectContent>
                    {candidatos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome || c.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button onClick={adicionar} disabled={!selecionado || busy}>Adicionar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Líder auxiliar ("braço direito"): mesmas capacidades do líder principal, só que escopadas a
// essa equipe (via team_co_leaders + leads_team_or_parent/is_lead_of no banco). Candidato precisa
// já ter papel gestor/team_leader — mesma exigência do líder principal.
function CoLideresDialog({
  team, coLiderIds, gestores, profiles, onOpenChange, onChanged,
}: {
  team: Team;
  coLiderIds: string[];
  gestores: Profile[];
  profiles: Record<string, Profile>;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [selecionado, setSelecionado] = useState("");
  const [busy, setBusy] = useState(false);

  const candidatos = useMemo(
    () => gestores.filter((g) => g.id !== team.lider_id && !coLiderIds.includes(g.id)),
    [gestores, team.lider_id, coLiderIds],
  );

  const adicionar = async () => {
    if (!selecionado) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("team_co_leaders").insert({ team_id: team.id, user_id: selecionado });
      if (error) throw error;
      toast.success("Líder auxiliar adicionado");
      setSelecionado("");
      onChanged();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao adicionar líder auxiliar");
    } finally {
      setBusy(false);
    }
  };

  const remover = async (userId: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("team_co_leaders").delete().eq("team_id", team.id).eq("user_id", userId);
      if (error) throw error;
      toast.success("Líder auxiliar removido");
      onChanged();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao remover líder auxiliar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Líderes auxiliares — {team.nome}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          O líder auxiliar tem as mesmas permissões do líder principal (cadastrar corretor, aprovar/devolver venda,
          mandar pro jurídico etc.), mas só dentro desta equipe.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            {coLiderIds.length === 0 && <p className="text-sm text-muted-foreground">Nenhum líder auxiliar nesta equipe ainda.</p>}
            {coLiderIds.map((id) => (
              <div key={id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span>{profiles[id]?.nome || profiles[id]?.email || id}</span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => remover(id)} title="Remover como líder auxiliar">
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2 border-t pt-3">
            <div className="flex-1">
              <Label>Adicionar líder auxiliar</Label>
              {candidatos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum gestor/team leader disponível para adicionar.</p>
              ) : (
                <Select value={selecionado} onValueChange={setSelecionado}>
                  <SelectTrigger><SelectValue placeholder="Selecione um gestor/team leader" /></SelectTrigger>
                  <SelectContent>
                    {candidatos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome || c.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button onClick={adicionar} disabled={!selecionado || busy}>Adicionar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type MetaProgressoRow = { corretor_id?: string; team_id?: string; meta_comissao: number; comissao_realizada: number };
type MetaProgresso = { corretor: MetaProgressoRow[]; equipe: MetaProgressoRow[] };

/** Barra de progresso "comissão do mês / meta" — mesma cor da barra em oklch(verde) quando bate
 * a meta, âmbar quando ainda não. */
function MetaProgressBar({ realizado, meta }: { realizado: number; meta: number }) {
  const pct = meta > 0 ? Math.round((realizado / meta) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className={`text-xs font-medium ${pct >= 100 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{pct}%</span>
    </div>
  );
}

/** Campo de meta editável — mostra só o valor quando não pode gerenciar; vira input+salvar quando pode. */
function MetaEditField({ valor, onSave, saving, placeholder }: { valor: number | null; onSave: (v: number) => void; saving: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(valor != null ? String(valor) : "");
  useEffect(() => { setDraft(valor != null ? String(valor) : ""); }, [valor]);
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number" step="0.01" className="h-7 w-28 text-xs" placeholder={placeholder ?? "Definir meta"}
        value={draft} onChange={(e) => setDraft(e.target.value)} disabled={saving}
      />
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={saving || !draft}
        onClick={() => onSave(Number(draft))}
      >
        {saving ? "..." : "Salvar"}
      </Button>
    </div>
  );
}

function DesempenhoDialog({
  team, membroIds, profiles, canManage, onOpenChange,
}: {
  team: Team;
  membroIds: string[];
  profiles: Record<string, Profile>;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [metas, setMetas] = useState<MetaProgresso>({ corretor: [], equipe: [] });
  const [savingMetaKey, setSavingMetaKey] = useState<string | null>(null);
  // Mesma correção da Visão geral: comissão por occurrence_commissions.user_id, não mais somando
  // sales.valor_total_comissao por corretor_id (atribuía a comissão inteira a quem cadastrou).
  const [comissaoResumo, setComissaoResumo] = useState<ComissaoBeneficiarioResumo>(RESUMO_VAZIO);

  const carregarMetas = useCallback(async () => {
    const { data } = await supabase.rpc("metas_progresso", { _mes: mesAtualISO() });
    setMetas((data as any) ?? { corretor: [], equipe: [] });
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Mesma regra da Visão geral: cancelada/arquivada não compõe o desempenho do time nem do corretor.
      const { data } = membroIds.length
        ? await supabase.from("sales").select("id, corretor_id, status, valor_negociado, valor_total_comissao").in("corretor_id", membroIds).not("status", "in", "(cancelada,arquivada)")
        : { data: [] as any[] };
      const salesData = data ?? [];
      setSales(salesData);
      try {
        setComissaoResumo(await fetchComissaoPorBeneficiario(salesData.map((s) => s.id)));
      } catch (e: unknown) {
        console.error("fetchComissaoPorBeneficiario (Desempenho):", e);
      }
      await carregarMetas();
      setLoading(false);
    })();
  }, [membroIds, carregarMetas]);

  const ranking = useMemo(() => {
    return membroIds
      .map((id) => {
        const vendas = sales.filter((s) => s.corretor_id === id);
        const fechadas = vendas.filter((s) => FECHADAS.includes(s.status));
        return {
          id,
          nome: profiles[id]?.nome || profiles[id]?.email || id,
          total: vendas.length,
          fechadas: fechadas.length,
          negociado: vendas.reduce((sum, s) => sum + Number(s.valor_negociado ?? 0), 0),
          comissao: comissaoResumo.porBeneficiario[id] ?? 0,
        };
      })
      .sort((a, b) => b.negociado - a.negociado);
  }, [membroIds, sales, profiles, comissaoResumo]);

  const totais = useMemo(() => ({
    vendas: ranking.reduce((s, r) => s + r.total, 0),
    negociado: ranking.reduce((s, r) => s + r.negociado, 0),
    comissao: ranking.reduce((s, r) => s + r.comissao, 0),
  }), [ranking]);

  const metaEquipe = metas.equipe.find((e) => e.team_id === team.id) ?? null;
  const metaPorCorretor = useMemo(() => {
    const m: Record<string, MetaProgressoRow> = {};
    for (const c of metas.corretor) if (c.corretor_id) m[c.corretor_id] = c;
    return m;
  }, [metas]);

  const salvarMeta = async (args: { tipo: "corretor" | "equipe"; corretorId?: string; key: string; valor: number }) => {
    setSavingMetaKey(args.key);
    try {
      const mes = mesAtualISO();
      const filterCol = args.tipo === "corretor" ? "corretor_id" : "team_id";
      const filterVal = args.tipo === "corretor" ? args.corretorId! : team.id;
      const { data: existing } = await supabase.from("metas").select("id").eq("tipo", args.tipo).eq(filterCol, filterVal).eq("mes", mes).maybeSingle();
      const { error } = existing
        ? await supabase.from("metas").update({ meta_comissao: args.valor }).eq("id", existing.id)
        : await supabase.from("metas").insert({
            tipo: args.tipo, mes, meta_comissao: args.valor, created_by: user!.id,
            corretor_id: args.tipo === "corretor" ? args.corretorId : null,
            team_id: args.tipo === "equipe" ? team.id : null,
          });
      if (error) { toast.error(error.message); return; }
      toast.success("Meta salva");
      await carregarMetas();
    } finally {
      setSavingMetaKey(null);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>Desempenho — {team.nome}</DialogTitle></DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-5">
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Membros</p><p className="text-xl font-semibold">{membroIds.length}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Vendas</p><p className="text-xl font-semibold">{totais.vendas}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Comissão do mês</p><p className="text-xl font-semibold">{money(metaEquipe?.comissao_realizada ?? 0)}</p></CardContent></Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="mb-1.5 text-xs text-muted-foreground">Meta da equipe — {mesAtualLabel()}</p>
                  {canManage ? (
                    <MetaEditField
                      valor={metaEquipe?.meta_comissao ?? null}
                      saving={savingMetaKey === "equipe"}
                      onSave={(v) => salvarMeta({ tipo: "equipe", key: "equipe", valor: v })}
                    />
                  ) : (
                    <p className="text-sm font-semibold">{metaEquipe ? money(metaEquipe.meta_comissao) : "Sem meta"}</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col justify-center pt-6">
                  <p className="mb-1.5 text-xs text-muted-foreground">Progresso da equipe</p>
                  {metaEquipe ? <MetaProgressBar realizado={metaEquipe.comissao_realizada} meta={metaEquipe.meta_comissao} /> : <p className="text-sm text-muted-foreground">—</p>}
                </CardContent>
              </Card>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Corretor</TableHead>
                  <TableHead>Vendas</TableHead>
                  <TableHead>Fechadas</TableHead>
                  <TableHead>Comissão do mês</TableHead>
                  <TableHead>Meta do corretor</TableHead>
                  <TableHead>Progresso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranking.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum corretor nesta equipe ainda.
                    </TableCell>
                  </TableRow>
                )}
                {ranking.map((r) => {
                  const meta = metaPorCorretor[r.id] ?? null;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.nome}</TableCell>
                      <TableCell>{r.total}</TableCell>
                      <TableCell>{r.fechadas}</TableCell>
                      <TableCell>{money(meta?.comissao_realizada ?? 0)}</TableCell>
                      <TableCell>
                        {canManage ? (
                          <MetaEditField
                            valor={meta?.meta_comissao ?? null}
                            saving={savingMetaKey === r.id}
                            onSave={(v) => salvarMeta({ tipo: "corretor", corretorId: r.id, key: r.id, valor: v })}
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">{meta ? money(meta.meta_comissao) : "Sem meta"}</span>
                        )}
                      </TableCell>
                      <TableCell>{meta ? <MetaProgressBar realizado={meta.comissao_realizada} meta={meta.meta_comissao} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
