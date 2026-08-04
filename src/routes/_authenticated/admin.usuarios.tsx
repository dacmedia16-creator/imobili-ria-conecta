import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL, type AppRole } from "@/lib/auth";
import { createUser, listLastSignIns, resetUserPassword, updateUser } from "@/lib/admin-users.functions";
import { agingInfo } from "@/lib/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { UserPlus, Copy, RefreshCcw, KeyRound, Pencil, Search, Crown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({ meta: [{ title: "Usuários" }] }),
  component: AdminUsers,
});

const ROLES: AppRole[] = ["corretor", "gestor", "team_leader", "juridico", "financeiro", "admin", "super_admin"];

function allowedRolesFor(roles: AppRole[]): AppRole[] {
  if (roles.includes("super_admin")) return [...ROLES];
  if (roles.includes("admin")) return ["corretor", "gestor", "team_leader", "juridico", "financeiro"];
  if (roles.includes("gestor") || roles.includes("team_leader")) return ["corretor"];
  return [];
}

function initials(nameOrEmail: string) {
  const base = nameOrEmail.split("@")[0].trim();
  const parts = base.split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0][0], parts[parts.length - 1][0]] : [base.slice(0, 2)];
  return chars.join("").toUpperCase();
}

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  let out = "";
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) out += chars[arr[i] % chars.length];
  return out;
}

function AdminUsers() {
  const { hasRole, hasAny, user, roles: myRoles } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [rolesByUser, setRolesByUser] = useState<Record<string, AppRole[]>>({});
  const [teamLeads, setTeamLeads] = useState<Record<string, string[]>>({});
  const [teamsRaw, setTeamsRaw] = useState<{ id: string; nome: string; lider_id: string; parent_team_id: string | null }[]>([]);
  const [teamMembersRaw, setTeamMembersRaw] = useState<{ membro_id: string; team_id: string }[]>([]);
  const [coLeadersRaw, setCoLeadersRaw] = useState<{ team_id: string; user_id: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AppRole | "todos">("todos");
  const [editingRoles, setEditingRoles] = useState<Record<string, boolean>>({});
  const [lastSignIn, setLastSignIn] = useState<Record<string, string | null>>({});
  const [resetPasswordFor, setResetPasswordFor] = useState<{ id: string; email: string; nome: string } | null>(null);
  const [editingUserFor, setEditingUserFor] = useState<{ id: string; email: string; nome: string; telefone: string | null } | null>(null);
  const createUserFn = useServerFn(createUser);
  const listLastSignInsFn = useServerFn(listLastSignIns);
  const resetPasswordFn = useServerFn(resetUserPassword);
  const updateUserFn = useServerFn(updateUser);

  const load = async () => {
    const { data: profs } = await supabase.from("profiles").select("id, nome, email, ativo, avatar_url");
    const { data: r } = await supabase.from("user_roles").select("user_id, role");
    const { data: teams } = await supabase.from("teams").select("id, nome, lider_id, parent_team_id");
    const { data: t } = await supabase.from("team_members").select("membro_id, team_id");
    const { data: cl } = await supabase.from("team_co_leaders").select("team_id, user_id");
    setUsers(profs ?? []);
    setTeamsRaw(teams ?? []);
    setTeamMembersRaw(t ?? []);
    setCoLeadersRaw(cl ?? []);
    listLastSignInsFn().then(setLastSignIn).catch(() => {});
    const map: Record<string, AppRole[]> = {};
    (r ?? []).forEach((x: any) => { (map[x.user_id] ??= []).push(x.role); });
    setRolesByUser(map);

    // Líderes de cada membro = líder (+ líder auxiliar) da equipe/sub-equipe + líder (+ auxiliar)
    // da equipe-mãe (1 nível), igual à hierarquia usada em is_lead_of() — só pra filtrar quem o
    // gestor/team_leader pode ver aqui.
    const teamById: Record<string, any> = {};
    (teams ?? []).forEach((tm: any) => { teamById[tm.id] = tm; });
    const coLeadersByTeam: Record<string, string[]> = {};
    (cl ?? []).forEach((x: any) => { (coLeadersByTeam[x.team_id] ??= []).push(x.user_id); });
    const tmap: Record<string, string[]> = {};
    (t ?? []).forEach((x: any) => {
      const team = teamById[x.team_id];
      if (!team) return;
      const lideres = [team.lider_id, ...(coLeadersByTeam[team.id] ?? [])];
      const parent = team.parent_team_id ? teamById[team.parent_team_id] : null;
      if (parent?.lider_id) lideres.push(parent.lider_id);
      if (parent) lideres.push(...(coLeadersByTeam[parent.id] ?? []));
      (tmap[x.membro_id] ??= []).push(...lideres);
    });
    setTeamLeads(tmap);
  };
  useEffect(() => { load(); }, []);

  const canManage = hasAny(["admin", "super_admin", "gestor", "team_leader"]);
  const isAdminLike = hasAny(["admin", "super_admin"]);
  const isSuper = hasRole("super_admin");
  const allowedRoles = useMemo(() => allowedRolesFor(myRoles), [myRoles]);

  // Agrupa por equipe (líder + líder auxiliar primeiro, depois membros) — só pra visão de
  // admin/super admin, que vê todo mundo; gestor/team leader já enxerga só a própria equipe,
  // então uma seção só não ajuda muito. "Sem equipe" pega quem não é membro nem líder de nada
  // (jurídico, financeiro, corretor solto, etc.).
  const teamGroups = useMemo(() => {
    const teamById: Record<string, typeof teamsRaw[number]> = {};
    teamsRaw.forEach((t) => { teamById[t.id] = t; });
    const memberIdsByTeam: Record<string, string[]> = {};
    teamMembersRaw.forEach((m) => { (memberIdsByTeam[m.team_id] ??= []).push(m.membro_id); });
    const coLeaderIdsByTeam: Record<string, string[]> = {};
    coLeadersRaw.forEach((c) => { (coLeaderIdsByTeam[c.team_id] ??= []).push(c.user_id); });

    const assigned = new Set<string>();
    const topTeams = [...teamsRaw].filter((t) => !t.parent_team_id).sort((a, b) => a.nome.localeCompare(b.nome));
    const groups: { key: string; label: string; primaryLeaderId: string; coLeaderIds: string[]; memberIds: string[] }[] = [];
    for (const top of topTeams) {
      const subs = teamsRaw.filter((t) => t.parent_team_id === top.id).sort((a, b) => a.nome.localeCompare(b.nome));
      for (const t of [top, ...subs]) {
        const coLeaderIds = (coLeaderIdsByTeam[t.id] ?? []).filter((id) => id !== t.lider_id);
        const memberIds = memberIdsByTeam[t.id] ?? [];
        assigned.add(t.lider_id);
        coLeaderIds.forEach((id) => assigned.add(id));
        memberIds.forEach((id) => assigned.add(id));
        groups.push({ key: t.id, label: t.parent_team_id ? `${top.nome} → ${t.nome}` : t.nome, primaryLeaderId: t.lider_id, coLeaderIds, memberIds });
      }
    }
    const semEquipeIds = users.filter((u) => !assigned.has(u.id)).map((u) => u.id);
    return { groups, semEquipeIds };
  }, [teamsRaw, teamMembersRaw, coLeadersRaw, users]);

  if (!canManage) return <p className="text-sm text-muted-foreground">Você não tem permissão para acessar esta página.</p>;

  const toggleRole = async (userId: string, role: AppRole, has: boolean) => {
    if (userId === user?.id) { toast.error("Você não pode alterar o próprio perfil"); return; }
    if ((role === "admin" || role === "super_admin") && !isSuper) { toast.error("Apenas super admin pode conceder este papel"); return; }
    if (has) {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      if (error) toast.error(error.message);
    } else {
      // Jurídico/financeiro não têm "dono" de venda como corretor/gestor — "a cada atualização"
      // nasce desligado pra eles (ver mesmo comentário em admin-users.functions.ts).
      const { error } = await supabase.from("user_roles").insert({
        user_id: userId, role,
        ...((role === "juridico" || role === "financeiro") ? { notificar_toda_atualizacao: false } : {}),
      });
      if (error) toast.error(error.message);
    }
    load();
  };

  const toggleAtivo = async (userId: string, ativo: boolean) => {
    if (userId === user?.id) { toast.error("Você não pode desativar o próprio usuário"); return; }
    const { error } = await supabase.from("profiles").update({ ativo: !ativo }).eq("id", userId);
    if (error) toast.error(error.message);
    else { toast.success(ativo ? "Usuário desativado" : "Usuário ativado"); load(); }
  };

  // Filtra usuários visíveis: gestor sem admin vê só a própria equipe + a si mesmo.
  const visibleUsers = isAdminLike
    ? users
    : users.filter(u => u.id === user?.id || (teamLeads[u.id] ?? []).includes(user?.id ?? ""));

  // Ativos primeiro (por nome), inativos ficam colapsados por padrão pra não tomar conta da tela.
  const sortedUsers = [...visibleUsers].sort((a, b) => {
    if ((a.ativo === false) !== (b.ativo === false)) return a.ativo === false ? 1 : -1;
    return (a.nome || a.email || "").localeCompare(b.nome || b.email || "");
  });

  const searchQ = search.trim().toLowerCase();
  const passesFilter = (u: any) => {
    const matchesSearch = !searchQ || (u.nome ?? "").toLowerCase().includes(searchQ) || (u.email ?? "").toLowerCase().includes(searchQ);
    const matchesRole = roleFilter === "todos" || (rolesByUser[u.id] ?? []).includes(roleFilter);
    return matchesSearch && matchesRole;
  };

  const activeUsers = sortedUsers.filter((u) => u.ativo !== false && passesFilter(u));
  const inactiveUsers = sortedUsers.filter((u) => u.ativo === false && passesFilter(u));
  const usersById: Record<string, any> = {};
  users.forEach((u) => { usersById[u.id] = u; });

  const renderUserCard = (u: any, badge?: "Líder" | "Líder auxiliar") => {
    const userRoles = rolesByUser[u.id] ?? [];
    const canEditThis = isAdminLike && u.id !== user?.id;
    // Editar dados básicos (nome/e-mail/telefone) — além de admin/super admin, gestor e team leader
    // também podem corrigir cadastro errado, mas só de quem já está na própria equipe (a lista
    // `visibleUsers` já filtra isso pra quem não é admin-like).
    const canEditData = canManage && u.id !== user?.id;
    const isEditingRoles = editingRoles[u.id] === true;
    const ultimoAcesso = lastSignIn[u.id];
    return (
      <div key={u.id} className={`rounded-lg border p-4 transition-shadow hover:shadow-sm ${u.ativo === false ? "opacity-60" : ""}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src={u.avatar_url ?? undefined} alt={u.nome || u.email} />
              <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                {initials(u.nome || u.email)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm font-medium">
                {u.nome || u.email}
                {badge && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <Crown className="h-3 w-3" />{badge}
                  </span>
                )}
                {u.id === user?.id && <span className="ml-2 text-xs text-muted-foreground">(você)</span>}
                {u.ativo === false && <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">Inativo</span>}
              </div>
              <div className="text-xs text-muted-foreground">{u.email}</div>
              <div className="mt-1 text-xs text-muted-foreground">Papéis: {userRoles.map(r => ROLE_LABEL[r]).join(", ") || "—"}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Último acesso: {ultimoAcesso === undefined ? "…" : ultimoAcesso === null ? "nunca acessou" : agingInfo(ultimoAcesso).label}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEditData && (
              <Button size="sm" variant="ghost" onClick={() => setEditingUserFor({ id: u.id, email: u.email, nome: u.nome ?? "", telefone: u.telefone ?? null })}>
                <Pencil className="mr-1.5 h-4 w-4" />Editar dados
              </Button>
            )}
            {canEditThis && (
              <Button size="sm" variant="ghost" onClick={() => setEditingRoles((m) => ({ ...m, [u.id]: !m[u.id] }))}>
                {isEditingRoles ? "Fechar" : "Editar papéis"}
              </Button>
            )}
            {canEditThis && (
              <Button size="sm" variant="ghost" onClick={() => setResetPasswordFor({ id: u.id, email: u.email, nome: u.nome })}>
                <KeyRound className="mr-1.5 h-4 w-4" />Redefinir senha
              </Button>
            )}
            {isAdminLike && (
              <Button
                size="sm"
                variant={u.ativo === false ? "default" : "outline"}
                onClick={() => toggleAtivo(u.id, u.ativo !== false)}
                disabled={u.id === user?.id}
              >
                {u.ativo === false ? "Ativar" : "Desativar"}
              </Button>
            )}
          </div>
        </div>
        {isAdminLike && (
          <div className="text-xs text-muted-foreground">
            Líderes deste usuário:{" "}
            {(teamLeads[u.id] ?? []).length === 0
              ? "nenhum"
              : (teamLeads[u.id] ?? []).map((lid) => users.find(x => x.id === lid)?.nome || users.find(x => x.id === lid)?.email || lid).join(", ")}
            {" — "}
            <Link to="/equipe" className="text-primary hover:underline">gerenciar em Equipes →</Link>
          </div>
        )}
        {isEditingRoles && canEditThis && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
            {ROLES.map((r) => {
              const has = userRoles.includes(r);
              const restrict = (r === "admin" || r === "super_admin") && !isSuper;
              return (
                <Button
                  key={r}
                  size="sm"
                  variant={has ? "default" : "outline"}
                  onClick={() => toggleRole(u.id, r, has)}
                  disabled={restrict}
                  title={restrict ? "Apenas super admin" : ""}
                >
                  {ROLE_LABEL[r]}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Usuários e perfis</h1>
        {allowedRoles.length > 0 && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><UserPlus className="h-4 w-4" /> Novo usuário</Button>
            </DialogTrigger>
            <NewUserDialog
              allowedRoles={allowedRoles}
              onDone={() => { setOpen(false); load(); }}
              createUserFn={createUserFn}
            />
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Lista de usuários</CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Buscar por nome ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as AppRole | "todos")}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os papéis</SelectItem>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sortedUsers.length === 0 && <p className="text-sm text-muted-foreground">Nenhum usuário cadastrado.</p>}
          {sortedUsers.length > 0 && activeUsers.length === 0 && inactiveUsers.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum usuário encontrado com esse filtro.</p>
          )}
          {isAdminLike ? (
            (() => {
              const activeIdSet = new Set(activeUsers.map((u) => u.id));
              const visibleGroups = teamGroups.groups
                .map((g) => ({
                  ...g,
                  visiblePrimary: activeIdSet.has(g.primaryLeaderId) ? g.primaryLeaderId : null,
                  visibleCoLeaders: g.coLeaderIds.filter((id) => activeIdSet.has(id)),
                  visibleMembers: g.memberIds.filter((id) => activeIdSet.has(id)),
                }))
                .filter((g) => g.visiblePrimary || g.visibleCoLeaders.length > 0 || g.visibleMembers.length > 0);
              const visibleSemEquipe = teamGroups.semEquipeIds.filter((id) => activeIdSet.has(id));
              return (
                <>
                  {visibleGroups.map((g) => (
                    <div key={g.key} className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</div>
                      <div className="space-y-2">
                        {g.visiblePrimary && renderUserCard(usersById[g.visiblePrimary], "Líder")}
                        {g.visibleCoLeaders.map((id) => renderUserCard(usersById[id], "Líder auxiliar"))}
                        {g.visibleMembers.map((id) => renderUserCard(usersById[id]))}
                      </div>
                    </div>
                  ))}
                  {visibleSemEquipe.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sem equipe</div>
                      <div className="space-y-2">{visibleSemEquipe.map((id) => renderUserCard(usersById[id]))}</div>
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            <div className="space-y-3">{activeUsers.map((u) => renderUserCard(u))}</div>
          )}
          {inactiveUsers.length > 0 && (
            <div className="pt-1">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowInactive((v) => !v)}>
                {showInactive ? "Ocultar inativos" : `Mostrar ${inactiveUsers.length} inativo${inactiveUsers.length > 1 ? "s" : ""}`}
              </Button>
              {showInactive && <div className="mt-3 space-y-3">{inactiveUsers.map((u) => renderUserCard(u))}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resetPasswordFor} onOpenChange={(o) => !o && setResetPasswordFor(null)}>
        {resetPasswordFor && (
          <ResetPasswordDialog
            target={resetPasswordFor}
            onDone={() => setResetPasswordFor(null)}
            resetFn={resetPasswordFn}
          />
        )}
      </Dialog>

      <Dialog open={!!editingUserFor} onOpenChange={(o) => !o && setEditingUserFor(null)}>
        {editingUserFor && (
          <EditUserDialog
            target={editingUserFor}
            onDone={() => { setEditingUserFor(null); load(); }}
            updateFn={updateUserFn}
          />
        )}
      </Dialog>
    </div>
  );
}

function ResetPasswordDialog({
  target, onDone, resetFn,
}: {
  target: { id: string; email: string; nome: string };
  onDone: () => void;
  resetFn: (args: { data: { userId: string; password: string } }) => Promise<any>;
}) {
  const [password, setPassword] = useState(() => genPassword());
  const [loading, setLoading] = useState(false);

  const copyCreds = async () => {
    await navigator.clipboard.writeText(`E-mail: ${target.email}\nSenha: ${password}`);
    toast.success("Credenciais copiadas");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await resetFn({ data: { userId: target.id, password } });
      toast.success(`Senha de ${target.nome || target.email} redefinida. Copie e envie a nova senha.`, {
        action: { label: "Copiar", onClick: copyCreds },
        duration: 10000,
      });
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao redefinir senha");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Redefinir senha</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Nova senha pra <b>{target.nome || target.email}</b>. A senha antiga deixa de funcionar, e a pessoa
        será obrigada a trocar essa senha no próximo login.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="rp-pass">Nova senha</Label>
          <div className="flex gap-2">
            <Input id="rp-pass" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <Button type="button" variant="outline" size="icon" onClick={() => setPassword(genPassword())} title="Gerar senha">
              <RefreshCcw className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={copyCreds} title="Copiar credenciais">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading}>{loading ? "Salvando..." : "Redefinir senha"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EditUserDialog({
  target, onDone, updateFn,
}: {
  target: { id: string; email: string; nome: string; telefone: string | null };
  onDone: () => void;
  updateFn: (args: { data: { userId: string; nome: string; email: string; telefone: string } }) => Promise<any>;
}) {
  const [nome, setNome] = useState(target.nome);
  const [email, setEmail] = useState(target.email);
  const [telefone, setTelefone] = useState(target.telefone ?? "");
  const [loading, setLoading] = useState(false);

  const nomeCompletoInvalido = nome.trim().split(/\s+/).filter(Boolean).length < 2;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nomeCompletoInvalido) { toast.error("Digite o nome completo (nome e sobrenome)."); return; }
    setLoading(true);
    try {
      await updateFn({ data: { userId: target.id, nome, email, telefone } });
      toast.success("Dados do usuário atualizados.");
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao atualizar usuário");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Editar dados do usuário</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Corrige nome, e-mail ou telefone cadastrados errados. Mudar o e-mail também muda o login da pessoa.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="eu-nome">Nome completo</Label>
          <Input id="eu-nome" value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Nome e sobrenome" />
          {nome.trim().length > 0 && nomeCompletoInvalido && (
            <p className="mt-1 text-xs text-destructive">Digite o nome completo (nome e sobrenome).</p>
          )}
        </div>
        <div>
          <Label htmlFor="eu-email">E-mail</Label>
          <Input id="eu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="eu-telefone">Telefone (WhatsApp)</Label>
          <Input id="eu-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} required minLength={10} placeholder="(11) 91234-5678" />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading}>{loading ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function NewUserDialog({
  allowedRoles, onDone, createUserFn,
}: {
  allowedRoles: AppRole[];
  onDone: () => void;
  createUserFn: (args: { data: { nome: string; email: string; telefone: string; password: string; role: AppRole } }) => Promise<any>;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [password, setPassword] = useState(() => genPassword());
  const [role, setRole] = useState<AppRole>(allowedRoles[0]);
  const [loading, setLoading] = useState(false);

  const copyCreds = async () => {
    await navigator.clipboard.writeText(`E-mail: ${email}\nSenha: ${password}`);
    toast.success("Credenciais copiadas");
  };

  const nomeCompletoInvalido = nome.trim().split(/\s+/).filter(Boolean).length < 2;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nomeCompletoInvalido) { toast.error("Digite o nome completo (nome e sobrenome)."); return; }
    setLoading(true);
    try {
      await createUserFn({ data: { nome, email, telefone, password, role } });
      toast.success("Usuário criado. Copie e envie as credenciais.", {
        action: { label: "Copiar", onClick: copyCreds },
        duration: 10000,
      });
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao criar usuário");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Novo usuário</DialogTitle>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="nu-nome">Nome completo</Label>
          <Input id="nu-nome" value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Nome e sobrenome" />
          {nome.trim().length > 0 && nomeCompletoInvalido && (
            <p className="mt-1 text-xs text-destructive">Digite o nome completo (nome e sobrenome).</p>
          )}
        </div>
        <div>
          <Label htmlFor="nu-email">E-mail</Label>
          <Input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="nu-telefone">Telefone (WhatsApp)</Label>
          <Input id="nu-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} required minLength={10} placeholder="(11) 91234-5678" />
        </div>
        <div>
          <Label htmlFor="nu-pass">Senha inicial</Label>
          <div className="flex gap-2">
            <Input id="nu-pass" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <Button type="button" variant="outline" size="icon" onClick={() => setPassword(genPassword())} title="Gerar senha">
              <RefreshCcw className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={copyCreds} title="Copiar credenciais">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Anote e envie ao usuário. Ele será obrigado a trocar essa senha já no primeiro acesso.</p>
        </div>
        <div>
          <Label>Papel</Label>
          <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedRoles.map((r) => (
                <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading}>{loading ? "Criando..." : "Criar usuário"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
