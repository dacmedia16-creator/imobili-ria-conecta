import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL, type AppRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/perfil")({
  head: () => ({ meta: [{ title: "Meu acesso" }] }),
  component: MeuAcesso,
});

type TeamInfo = {
  nome: string;
  parentNome: string | null;
  lideres: { id: string; nome: string; email: string | null }[];
};

function MeuAcesso() {
  const { user, roles, hasAny } = useAuth();
  const [myTeam, setMyTeam] = useState<TeamInfo | null>(null);

  const loadTeam = useCallback(async () => {
    if (!user) return;
    const { data: tm } = await supabase.from("team_members").select("team_id").eq("membro_id", user.id).maybeSingle();
    if (!tm) { setMyTeam(null); return; }
    const { data: team } = await supabase.from("teams").select("nome, lider_id, parent_team_id").eq("id", tm.team_id).maybeSingle();
    if (!team) { setMyTeam(null); return; }

    const liderIds = [team.lider_id];
    let parentNome: string | null = null;
    if (team.parent_team_id) {
      const { data: parent } = await supabase.from("teams").select("nome, lider_id").eq("id", team.parent_team_id).maybeSingle();
      if (parent) {
        parentNome = parent.nome;
        liderIds.push(parent.lider_id);
      }
    }
    const uniqueIds = Array.from(new Set(liderIds));
    const { data: profs } = await supabase.from("profiles").select("id, nome, email").in("id", uniqueIds);
    setMyTeam({ nome: team.nome, parentNome, lideres: profs ?? [] });
  }, [user]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

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

      {hasAny(["corretor", "gestor"]) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Minha equipe</CardTitle>
            {hasAny(["gestor", "admin", "super_admin"]) && (
              <Link to="/equipe" className="text-xs text-primary hover:underline">Gerenciar equipes →</Link>
            )}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!myTeam ? (
              <p className="text-muted-foreground">Você ainda não está vinculado a nenhuma equipe.</p>
            ) : (
              <>
                <div>
                  Equipe: <b>{myTeam.nome}</b>
                  {myTeam.parentNome && <span className="text-muted-foreground"> (sub-equipe de {myTeam.parentNome})</span>}
                </div>
                <div className="mb-1 mt-2 text-xs uppercase tracking-wide text-muted-foreground">Líder(es) — gestores que enxergam suas vendas</div>
                {myTeam.lideres.map((l) => (
                  <div key={l.id} className="rounded border p-2">{l.nome || l.email}</div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
