import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL, type AppRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({ meta: [{ title: "Usuários" }] }),
  component: AdminUsers,
});

const ROLES: AppRole[] = ["corretor", "coordenador", "gestor", "juridico", "financeiro", "admin"];

function AdminUsers() {
  const { hasRole, user } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [rolesByUser, setRolesByUser] = useState<Record<string, AppRole[]>>({});
  const [teamLeads, setTeamLeads] = useState<Record<string, string[]>>({});

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

  if (!hasRole("admin")) return <p className="text-sm text-muted-foreground">Apenas administradores acessam esta página.</p>;

  const toggleRole = async (userId: string, role: AppRole, has: boolean) => {
    if (userId === user?.id) { toast.error("Você não pode alterar o próprio perfil"); return; }
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

  const leads = users.filter(u => (rolesByUser[u.id] ?? []).some(r => r === "gestor" || r === "coordenador"));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Usuários e perfis</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Lista de usuários</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {users.map((u) => {
            const userRoles = rolesByUser[u.id] ?? [];
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
                  </div>
                  <Button
                    size="sm"
                    variant={u.ativo === false ? "default" : "outline"}
                    onClick={() => toggleAtivo(u.id, u.ativo !== false)}
                    disabled={u.id === user?.id}
                  >
                    {u.ativo === false ? "Ativar" : "Desativar"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((r) => {
                    const has = userRoles.includes(r);
                    return (
                      <Button key={r} size="sm" variant={has ? "default" : "outline"} onClick={() => toggleRole(u.id, r, has)}>
                        {ROLE_LABEL[r]}
                      </Button>
                    );
                  })}
                </div>
                <div className="mt-3 space-y-1">
                  <div className="text-xs text-muted-foreground">Líderes deste usuário (gestor/coordenador):</div>
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
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
