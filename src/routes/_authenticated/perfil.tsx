import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL, type AppRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/perfil")({
  head: () => ({ meta: [{ title: "Meu acesso" }] }),
  component: MeuAcesso,
});

function MeuAcesso() {
  const { user, roles, hasAny } = useAuth();
  const [leaders, setLeaders] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [l, m] = await Promise.all([
        supabase.from("team_members").select("lider_id, profiles:lider_id(nome, email)").eq("membro_id", user.id),
        supabase.from("team_members").select("membro_id, profiles:membro_id(nome, email)").eq("lider_id", user.id),
      ]);
      setLeaders((l.data ?? []) as any[]);
      setMembers((m.data ?? []) as any[]);
    })();
  }, [user]);

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
          <CardHeader><CardTitle className="text-base">Minha equipe</CardTitle></CardHeader>
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
                {members.length === 0 && <p className="text-muted-foreground">Nenhum corretor vinculado — peça ao administrador para vincular sua equipe, senão você não verá nenhuma venda.</p>}
                {members.map((m: any) => (
                  <div key={m.membro_id} className="rounded border p-2">{m.profiles?.nome || m.profiles?.email || m.membro_id}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
