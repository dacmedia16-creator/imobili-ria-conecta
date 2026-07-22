import { createFileRoute } from "@tanstack/react-router";
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

export const Route = createFileRoute("/_authenticated/equipe")({
  head: () => ({ meta: [{ title: "Equipes" }] }),
  component: EquipesPage,
});

const TEAM_COLORS = ["#22c55e", "#06b6d4", "#6366f1", "#3b82f6", "#f59e0b", "#ef4444", "#ec4899", "#f97316"];
const FECHADAS = ["contrato_assinado", "ocorrencia_concluida"];
const money = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

type Team = { id: string; nome: string; cor: string; lider_id: string; parent_team_id: string | null };
type Profile = { id: string; nome: string; email: string | null };

function EquipesPage() {
  const { user, hasAny } = useAuth();
  const allowed = hasAny(["gestor", "admin", "super_admin"]);
  const isAdminLike = hasAny(["admin", "super_admin"]);
  const listGestoresFn = useServerFn(listGestores);

  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<{ team_id: string; membro_id: string }[]>([]);
  const [allSales, setAllSales] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [gestores, setGestores] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [formState, setFormState] = useState<{ mode: "create" | "create-sub" | "edit"; parent?: Team; initial?: Team } | null>(null);
  const [membrosTeam, setMembrosTeam] = useState<Team | null>(null);
  const [desempenhoTeam, setDesempenhoTeam] = useState<Team | null>(null);
  const [deleteTeam, setDeleteTeam] = useState<Team | null>(null);

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return; }
    setLoading(true);
    const [{ data: t }, { data: tm }, salesRes] = await Promise.all([
      supabase.from("teams").select("id, nome, cor, lider_id, parent_team_id").order("created_at", { ascending: true }),
      supabase.from("team_members").select("team_id, membro_id"),
      isAdminLike
        ? supabase.from("sales").select("id, corretor_id, status, valor_negociado, valor_total_comissao")
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setTeams(t ?? []);
    setMembers(tm ?? []);
    setAllSales(salesRes.data ?? []);

    const ids = new Set<string>();
    (t ?? []).forEach((x: any) => ids.add(x.lider_id));
    (tm ?? []).forEach((x: any) => ids.add(x.membro_id));
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

  const childrenByParent = useMemo(() => {
    const map: Record<string, Team[]> = {};
    teams.forEach((t) => { if (t.parent_team_id) (map[t.parent_team_id] ??= []).push(t); });
    return map;
  }, [teams]);

  const topLevel = useMemo(() => teams.filter((t) => !t.parent_team_id), [teams]);

  // Gestor só gerencia a própria equipe (e sub-equipes dela); admin/super_admin gerenciam tudo.
  // Espelha exatamente a regra da RLS (teams_write), então nunca mostra um botão que a API recusaria.
  const canManageTeam = useCallback((team: Team) => {
    if (isAdminLike) return true;
    if (team.lider_id === user?.id) return true;
    const parent = team.parent_team_id ? teams.find((t) => t.id === team.parent_team_id) : null;
    return parent?.lider_id === user?.id;
  }, [isAdminLike, user?.id, teams]);

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
          Esta área é restrita a gestores e administradores.
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
        <Button className="gap-2" onClick={() => setFormState({ mode: "create" })}>
          <Plus className="h-4 w-4" />Nova Equipe
        </Button>
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
              subTeams={childrenByParent[team.id] ?? []}
              canManageTeam={canManageTeam}
              onMembros={setMembrosTeam}
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
          negociado: vendas.reduce((s, v) => s + Number(v.valor_negociado ?? 0), 0),
          comissao: vendas.reduce((s, v) => s + Number(v.valor_total_comissao ?? 0), 0),
        };
      })
      .sort((a, b) => b.negociado - a.negociado);
  }, [members, allSales, profiles, teamNameByMembro]);

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
          <div><p className="text-xs text-muted-foreground">Valor negociado</p><p className="text-xl font-semibold">{money(totais.negociado)}</p></div>
          <div><p className="text-xs text-muted-foreground">Comissão total</p><p className="text-xl font-semibold">{money(totais.comissao)}</p></div>
        </div>
        {ranking.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Corretor</TableHead>
                <TableHead>Equipe</TableHead>
                <TableHead>Vendas</TableHead>
                <TableHead>Fechadas</TableHead>
                <TableHead>Valor negociado</TableHead>
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
  team, profiles, membersByTeam, subTeams, canManageTeam, onMembros, onDesempenho, onCreateSub, onEdit, onDelete,
}: {
  team: Team;
  profiles: Record<string, Profile>;
  membersByTeam: Record<string, string[]>;
  subTeams: Team[];
  canManageTeam: (t: Team) => boolean;
  onMembros: (t: Team) => void;
  onDesempenho: (t: Team) => void;
  onCreateSub: (t: Team) => void;
  onEdit: (t: Team) => void;
  onDelete: (t: Team) => void;
}) {
  const manageable = canManageTeam(team);
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <TeamRow team={team} profiles={profiles} memberCount={(membersByTeam[team.id] ?? []).length} />
        {manageable ? (
          <div className="flex flex-wrap gap-1.5 border-t pt-3">
            <Button size="icon" variant="outline" title="Ver equipe" onClick={() => onMembros(team)}>
              <Users className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => onMembros(team)}>
              <UserPlus className="h-3.5 w-3.5" />Membros
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
          <p className="border-t pt-3 text-xs text-muted-foreground">Equipe-mãe — gerenciada por {profiles[team.lider_id]?.nome || "outro gestor"}.</p>
        )}

        {subTeams.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sub-equipes</div>
            {subTeams.map((sub) => (
              <div key={sub.id} className="space-y-2 rounded-md border p-3">
                <TeamRow team={sub} profiles={profiles} memberCount={(membersByTeam[sub.id] ?? []).length} compact />
                {canManageTeam(sub) ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="icon" variant="outline" title="Ver equipe" onClick={() => onMembros(sub)}>
                      <Users className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => onMembros(sub)}>
                      <UserPlus className="h-3.5 w-3.5" />Membros
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
                  <p className="text-xs text-muted-foreground">Gerenciada por {profiles[sub.lider_id]?.nome || "outro gestor"}.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeamRow({ team, profiles, memberCount, compact }: { team: Team; profiles: Record<string, Profile>; memberCount: number; compact?: boolean }) {
  const leader = profiles[team.lider_id];
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
            {gestores.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Nenhum usuário com papel gestor cadastrado ainda.</p>}
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

function DesempenhoDialog({
  team, membroIds, profiles, onOpenChange,
}: {
  team: Team;
  membroIds: string[];
  profiles: Record<string, Profile>;
  onOpenChange: (open: boolean) => void;
}) {
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = membroIds.length
        ? await supabase.from("sales").select("id, corretor_id, status, valor_negociado, valor_total_comissao").in("corretor_id", membroIds)
        : { data: [] as any[] };
      setSales(data ?? []);
      setLoading(false);
    })();
  }, [membroIds]);

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
          comissao: vendas.reduce((sum, s) => sum + Number(s.valor_total_comissao ?? 0), 0),
        };
      })
      .sort((a, b) => b.negociado - a.negociado);
  }, [membroIds, sales, profiles]);

  const totais = useMemo(() => ({
    vendas: ranking.reduce((s, r) => s + r.total, 0),
    negociado: ranking.reduce((s, r) => s + r.negociado, 0),
    comissao: ranking.reduce((s, r) => s + r.comissao, 0),
  }), [ranking]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Desempenho — {team.nome}</DialogTitle></DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Membros</p><p className="text-xl font-semibold">{membroIds.length}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Vendas</p><p className="text-xl font-semibold">{totais.vendas}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Valor negociado</p><p className="text-xl font-semibold">{money(totais.negociado)}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Comissão total</p><p className="text-xl font-semibold">{money(totais.comissao)}</p></CardContent></Card>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Corretor</TableHead>
                  <TableHead>Vendas</TableHead>
                  <TableHead>Fechadas</TableHead>
                  <TableHead>Valor negociado</TableHead>
                  <TableHead>Comissão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranking.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum corretor nesta equipe ainda.
                    </TableCell>
                  </TableRow>
                )}
                {ranking.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.nome}</TableCell>
                    <TableCell>{r.total}</TableCell>
                    <TableCell>{r.fechadas}</TableCell>
                    <TableCell>{money(r.negociado)}</TableCell>
                    <TableCell>{money(r.comissao)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
