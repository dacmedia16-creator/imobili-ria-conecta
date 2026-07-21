import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL, type AppRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { listCorretoresDisponiveis, addCorretorToTeam, removeCorretorFromTeam } from "@/lib/team.functions";

export const Route = createFileRoute("/_authenticated/perfil")({
  head: () => ({ meta: [{ title: "Meu acesso" }] }),
  component: MeuAcesso,
});

function MeuAcesso() {
  const { user, roles, hasAny } = useAuth();
  const [leaders, setLeaders] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [candidatos, setCandidatos] = useState<{ id: string; nome: string; email: string }[]>([]);
  const [selecionado, setSelecionado] = useState("");
  const [loadingCandidatos, setLoadingCandidatos] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    if (!user) return;
    // team_members não tem FK declarada pro profiles no schema, então o embed
    // "profiles:lider_id(...)" do PostgREST falha silenciosamente (retorna null) —
    // por isso "Minha equipe" sempre aparecia vazia mesmo com vínculo cadastrado.
    // Busca em duas etapas e junta no cliente, igual já é feito em admin.usuarios.tsx.
    const [l, m] = await Promise.all([
      supabase.from("team_members").select("lider_id").eq("membro_id", user.id),
      supabase.from("team_members").select("membro_id").eq("lider_id", user.id),
    ]);
    const liderIds = Array.from(new Set((l.data ?? []).map((r: any) => r.lider_id)));
    const membroIds = Array.from(new Set((m.data ?? []).map((r: any) => r.membro_id)));
    const allIds = Array.from(new Set([...liderIds, ...membroIds]));
    const { data: profs } = allIds.length
      ? await supabase.from("profiles").select("id, nome, email").in("id", allIds)
      : { data: [] as any[] };
    const profMap: Record<string, any> = {};
    for (const p of profs ?? []) profMap[p.id] = p;
    setLeaders(liderIds.map((id) => ({ lider_id: id, profiles: profMap[id] })));
    setMembers(membroIds.map((id) => ({ membro_id: id, profiles: profMap[id] })));
  }, [user]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  const openAddDialog = async () => {
    setSelecionado("");
    setAddOpen(true);
    setLoadingCandidatos(true);
    try {
      const data = await listCorretoresDisponiveis();
      setCandidatos(data as any[]);
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao listar corretores");
    } finally {
      setLoadingCandidatos(false);
    }
  };

  const confirmAdd = async () => {
    if (!selecionado) return;
    setAdding(true);
    try {
      await addCorretorToTeam({ data: { corretorId: selecionado } });
      toast.success("Corretor adicionado à equipe");
      setAddOpen(false);
      await loadTeam();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao adicionar corretor");
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (corretorId: string) => {
    setRemovingId(corretorId);
    try {
      await removeCorretorFromTeam({ data: { corretorId } });
      toast.success("Corretor removido da equipe");
      await loadTeam();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao remover corretor");
    } finally {
      setRemovingId(null);
    }
  };

  const explain = (r: AppRole): string => {
    switch (r) {
      case "corretor": return "Você vê apenas as vendas onde você é o corretor responsável, e só edita rascunhos ou vendas devolvidas para ajuste.";
      case "gestor": return "Você vê as vendas dos corretores vinculados à sua equipe e pode aprovar, devolver ou editar antes de enviar ao jurídico.";
      case "juridico": return "Você vê todas as vendas a partir de \"aprovada pelo gestor\" e conduz elaboração, assinatura e envio para o financeiro.";
      case "financeiro": return "Você vê todas as vendas e é quem trava/libera a edição via ocorrência.";
      case "admin": return "Você vê e edita tudo. Não pode conceder o papel Admin ou Super Admin — só o Super Admin pode.";
      case "super_admin": return "Acesso total, incluindo conceder ou revogar os papéis Admin e Super Admin.";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Meu acesso</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Conta</CardTitle></CardHeader>
        <CardContent className="text-sm">
          <div className="mb-1"><span className="text-muted-foreground">Email:</span> <b>{user?.email}</b></div>
          <div><span className="text-muted-foreground">Papéis:</span> <b>{roles.map(r => ROLE_LABEL[r]).join(", ") || "Sem papel"}</b></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">O que você pode ver e fazer</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {roles.length === 0 && <p className="text-muted-foreground">Nenhum papel atribuído. Solicite acesso ao administrador.</p>}
          {roles.map((r) => (
            <div key={r} className="rounded-md border p-3">
              <div className="mb-1 font-medium">{ROLE_LABEL[r]}</div>
              <div className="text-muted-foreground">{explain(r)}</div>
            </div>
          ))}
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            🔒 Regra geral: quando o financeiro aceita a ocorrência, a venda fica travada para edição de corretor, gestor e jurídico até que o financeiro (ou admin/super admin) libere.
          </div>
        </CardContent>
      </Card>

      {hasAny(["corretor","gestor"]) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Minha equipe</CardTitle>
            {hasAny(["gestor"]) && (
              <Button size="sm" variant="outline" onClick={openAddDialog}><Plus className="mr-1 h-4 w-4" />Adicionar corretor</Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Meus líderes (gestores que enxergam minhas vendas)</div>
              {leaders.length === 0 && <p className="text-muted-foreground">Nenhum líder vinculado.</p>}
              {leaders.map((l: any) => (
                <div key={l.lider_id} className="rounded border p-2">{l.profiles?.nome || l.profiles?.email || l.lider_id}</div>
              ))}
            </div>
            {hasAny(["gestor"]) && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Corretores da minha equipe (cujas vendas eu enxergo)</div>
                {members.length === 0 && <p className="text-muted-foreground">Nenhum corretor vinculado ainda — use "Adicionar corretor" acima.</p>}
                {members.map((m: any) => (
                  <div key={m.membro_id} className="flex items-center justify-between rounded border p-2">
                    <span>{m.profiles?.nome || m.profiles?.email || m.membro_id}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Remover da equipe"
                      disabled={removingId === m.membro_id}
                      onClick={() => removeMember(m.membro_id)}
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar corretor à equipe</DialogTitle>
            <DialogDescription>Só corretores que ainda não estão na sua equipe aparecem na lista.</DialogDescription>
          </DialogHeader>
          {loadingCandidatos ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : candidatos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum corretor disponível para adicionar — todos já estão na sua equipe, ou não existe nenhum corretor cadastrado ainda.</p>
          ) : (
            <Select value={selecionado} onValueChange={setSelecionado}>
              <SelectTrigger><SelectValue placeholder="Selecione um corretor" /></SelectTrigger>
              <SelectContent>
                {candidatos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome || c.email}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={confirmAdd} disabled={!selecionado || adding}>{adding ? "Adicionando..." : "Adicionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
