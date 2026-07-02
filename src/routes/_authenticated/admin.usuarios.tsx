import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL, type AppRole } from "@/lib/auth";
import { createUser } from "@/lib/admin-users.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { UserPlus, Copy, RefreshCcw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({ meta: [{ title: "Usuários" }] }),
  component: AdminUsers,
});

const ROLES: AppRole[] = ["corretor", "gestor", "juridico", "financeiro", "admin", "super_admin"];

function allowedRolesFor(roles: AppRole[]): AppRole[] {
  if (roles.includes("super_admin")) return [...ROLES];
  if (roles.includes("admin")) return ["corretor", "gestor", "juridico", "financeiro"];
  if (roles.includes("gestor")) return ["corretor"];
  return [];
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
  const [open, setOpen] = useState(false);
  const createUserFn = useServerFn(createUser);

  const load = async () => {
    const { data: profs } = await supabase.from("profiles").select("id, nome, email, ativo");
    const { data: r } = await supabase.from("user_roles").select("user_id, role");
    const { data: t } = await supabase.from("team_members").select("membro_id, lider_id");
    setUsers(profs ?? []);
    const map: Record<string, AppRole[]> = {};
    (r ?? []).forEach((x: any) => { (map[x.user_id] ??= []).push(x.role); });
    setRolesByUser(map);
    const tmap: Record<string, string[]> = {};
    (t ?? []).forEach((x: any) => { (tmap[x.membro_id] ??= []).push(x.lider_id); });
    setTeamLeads(tmap);
  };
  useEffect(() => { load(); }, []);

  const canManage = hasAny(["admin", "super_admin", "gestor"]);
  const isAdminLike = hasAny(["admin", "super_admin"]);
  const isSuper = hasRole("super_admin");
  const allowedRoles = useMemo(() => allowedRolesFor(myRoles), [myRoles]);

  if (!canManage) return <p className="text-sm text-muted-foreground">Você não tem permissão para acessar esta página.</p>;

  const toggleRole = async (userId: string, role: AppRole, has: boolean) => {
    if (userId === user?.id) { toast.error("Você não pode alterar o próprio perfil"); return; }
    if ((role === "admin" || role === "super_admin") && !isSuper) { toast.error("Apenas super admin pode conceder este papel"); return; }
    if (has) {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
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

  const setLead = async (membroId: string, liderId: string) => {
    if (!liderId) return;
    const { error } = await supabase.from("team_members").insert({ membro_id: membroId, lider_id: liderId });
    if (error) toast.error(error.message); else load();
  };

  const removeLead = async (membroId: string, liderId: string) => {
    await supabase.from("team_members").delete().eq("membro_id", membroId).eq("lider_id", liderId);
    load();
  };

  const leads = users.filter(u => (rolesByUser[u.id] ?? []).some(r => r === "gestor"));

  // Filtra usuários visíveis: gestor sem admin vê só a própria equipe + a si mesmo.
  const visibleUsers = isAdminLike
    ? users
    : users.filter(u => u.id === user?.id || (teamLeads[u.id] ?? []).includes(user?.id ?? ""));

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
        <CardHeader><CardTitle className="text-base">Lista de usuários</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {visibleUsers.length === 0 && <p className="text-sm text-muted-foreground">Nenhum usuário para exibir.</p>}
          {visibleUsers.map((u) => {
            const userRoles = rolesByUser[u.id] ?? [];
            const canEditThis = isAdminLike && u.id !== user?.id;
            return (
              <div key={u.id} className={`rounded-md border p-3 ${u.ativo === false ? "opacity-60" : ""}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">
                      {u.nome || u.email}
                      {u.id === user?.id && <span className="ml-2 text-xs text-muted-foreground">(você)</span>}
                      {u.ativo === false && <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">Inativo</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                    {!isAdminLike && (
                      <div className="mt-1 text-xs text-muted-foreground">Papéis: {userRoles.map(r => ROLE_LABEL[r]).join(", ") || "—"}</div>
                    )}
                  </div>
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
                {isAdminLike && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {ROLES.map((r) => {
                        const has = userRoles.includes(r);
                        const restrict = (r === "admin" || r === "super_admin") && !isSuper;
                        return (
                          <Button
                            key={r}
                            size="sm"
                            variant={has ? "default" : "outline"}
                            onClick={() => toggleRole(u.id, r, has)}
                            disabled={!canEditThis || restrict}
                            title={restrict ? "Apenas super admin" : ""}
                          >
                            {ROLE_LABEL[r]}
                          </Button>
                        );
                      })}
                    </div>
                    <div className="mt-3 space-y-1">
                      <div className="text-xs text-muted-foreground">Líderes deste usuário (gestor):</div>
                      <div className="flex flex-wrap items-center gap-2">
                        {(teamLeads[u.id] ?? []).map((lid) => {
                          const lu = users.find(x => x.id === lid);
                          return (
                            <span key={lid} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                              {lu?.nome || lu?.email || lid}
                              <button onClick={() => removeLead(u.id, lid)} className="ml-1 text-muted-foreground hover:text-foreground">×</button>
                            </span>
                          );
                        })}
                        <Select onValueChange={(v) => setLead(u.id, v)}>
                          <SelectTrigger className="h-7 w-56 text-xs"><SelectValue placeholder="Adicionar líder..." /></SelectTrigger>
                          <SelectContent>
                            {leads.filter(l => l.id !== u.id && !(teamLeads[u.id] ?? []).includes(l.id)).map((l) => (
                              <SelectItem key={l.id} value={l.id}>{l.nome || l.email}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function NewUserDialog({
  allowedRoles, onDone, createUserFn,
}: {
  allowedRoles: AppRole[];
  onDone: () => void;
  createUserFn: (args: { data: { nome: string; email: string; password: string; role: AppRole } }) => Promise<any>;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => genPassword());
  const [role, setRole] = useState<AppRole>(allowedRoles[0]);
  const [loading, setLoading] = useState(false);

  const copyCreds = async () => {
    await navigator.clipboard.writeText(`E-mail: ${email}\nSenha: ${password}`);
    toast.success("Credenciais copiadas");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createUserFn({ data: { nome, email, password, role } });
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
          <Label htmlFor="nu-nome">Nome</Label>
          <Input id="nu-nome" value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} />
        </div>
        <div>
          <Label htmlFor="nu-email">E-mail</Label>
          <Input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          <p className="mt-1 text-xs text-muted-foreground">Anote e envie ao usuário. Ele poderá trocar depois.</p>
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
