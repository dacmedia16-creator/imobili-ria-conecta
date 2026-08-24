import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL, type AppRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ShieldCheck, MessageCircle, KeyRound } from "lucide-react";
import { toast } from "sonner";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

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
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [savingTelefone, setSavingTelefone] = useState(false);
  const [notifPorPapel, setNotifPorPapel] = useState<Partial<Record<AppRole, boolean>>>({});
  const [notifAtualizacaoPorPapel, setNotifAtualizacaoPorPapel] = useState<Partial<Record<AppRole, boolean>>>({});
  const [savingNotif, setSavingNotif] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [trocandoSenha, setTrocandoSenha] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("nome, telefone, avatar_url").eq("id", user.id).maybeSingle();
      setNome(data?.nome ?? "");
      setTelefone(data?.telefone ?? "");
      setAvatarUrl(data?.avatar_url ?? null);
    })();
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, notificar_whatsapp, notificar_toda_atualizacao")
        .eq("user_id", user.id);
      const map: Partial<Record<AppRole, boolean>> = {};
      const mapAtualizacao: Partial<Record<AppRole, boolean>> = {};
      for (const r of data ?? []) {
        map[r.role as AppRole] = r.notificar_whatsapp ?? true;
        mapAtualizacao[r.role as AppRole] = r.notificar_toda_atualizacao ?? (r.role === "corretor" || r.role === "gestor" || r.role === "team_leader");
      }
      setNotifPorPapel(map);
      setNotifAtualizacaoPorPapel(mapAtualizacao);
    })();
  }, [user]);

  const alternarNotifCampo = async (
    r: AppRole,
    campo: "notificar_whatsapp" | "notificar_toda_atualizacao",
    valor: boolean,
  ) => {
    if (!user) return;
    setSavingNotif(`${r}:${campo}`);
    try {
      const patch: { notificar_whatsapp?: boolean; notificar_toda_atualizacao?: boolean } = { [campo]: valor };
      const { error } = await supabase
        .from("user_roles")
        .update(patch)
        .eq("user_id", user.id)
        .eq("role", r);
      if (error) { toast.error(error.message); return; }
      if (campo === "notificar_whatsapp") setNotifPorPapel((m) => ({ ...m, [r]: valor }));
      else setNotifAtualizacaoPorPapel((m) => ({ ...m, [r]: valor }));
    } finally {
      setSavingNotif(null);
    }
  };

  const salvarTelefone = async () => {
    if (!user) return;
    setSavingTelefone(true);
    try {
      const { error } = await supabase.from("profiles").update({ telefone: telefone.trim() || null }).eq("id", user.id);
      if (error) toast.error(error.message);
      else toast.success("Telefone salvo");
    } finally {
      setSavingTelefone(false);
    }
  };

  const trocarSenha = async () => {
    if (novaSenha.length < 8) { toast.error("A senha precisa ter pelo menos 8 caracteres"); return; }
    if (novaSenha !== confirmarSenha) { toast.error("As senhas não coincidem"); return; }
    setTrocandoSenha(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) { toast.error(error.message); return; }
      setNovaSenha("");
      setConfirmarSenha("");
      toast.success("Senha alterada");
    } finally {
      setTrocandoSenha(false);
    }
  };

  const selecionarAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Selecione um arquivo de imagem"); return; }
    if (file.size > AVATAR_MAX_BYTES) { toast.error("Imagem muito grande (máx. 5MB)"); return; }
    setAvatarPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    setAvatarFile(file);
  };

  const salvarAvatar = async () => {
    if (!user || !avatarFile) return;
    setSavingAvatar(true);
    try {
      const path = `${user.id}/avatar`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
      if (upErr) { toast.error(upErr.message); return; }
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      const { error: dbErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
      if (dbErr) { toast.error(dbErr.message); return; }
      setAvatarUrl(url);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
      setAvatarFile(null);
      toast.success("Foto de perfil atualizada");
    } finally {
      setSavingAvatar(false);
    }
  };

  useEffect(() => {
    return () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); };
  }, [avatarPreview]);

  const loadTeam = useCallback(async () => {
    if (!user) return;
    const { data: tm } = await supabase.from("team_members").select("team_id").eq("membro_id", user.id).maybeSingle();
    if (!tm) { setMyTeam(null); return; }
    const { data: team } = await supabase.from("teams").select("nome, lider_id, parent_team_id").eq("id", tm.team_id).maybeSingle();
    if (!team) { setMyTeam(null); return; }

    const liderIds = [team.lider_id];
    let parentNome: string | null = null;
    const teamIdsForCoLideres = [tm.team_id];
    if (team.parent_team_id) {
      const { data: parent } = await supabase.from("teams").select("nome, lider_id").eq("id", team.parent_team_id).maybeSingle();
      if (parent) {
        parentNome = parent.nome;
        liderIds.push(parent.lider_id);
        teamIdsForCoLideres.push(team.parent_team_id);
      }
    }
    // Líder auxiliar ("braço direito") aparece aqui igual ao líder principal.
    const { data: coLideres } = await supabase.from("team_co_leaders").select("user_id").in("team_id", teamIdsForCoLideres);
    (coLideres ?? []).forEach((c: any) => liderIds.push(c.user_id));
    const uniqueIds = Array.from(new Set(liderIds));
    const { data: profs } = await supabase.from("profiles").select("id, nome, email").in("id", uniqueIds);
    setMyTeam({ nome: team.nome, parentNome, lideres: profs ?? [] });
  }, [user]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  const explain = (r: AppRole): string => {
    switch (r) {
      case "corretor": return "Você vê apenas as vendas onde você é o corretor responsável, e só edita rascunhos ou vendas devolvidas para ajuste.";
      case "gestor": return "Você vê as vendas dos corretores vinculados à sua equipe e pode aprovar, devolver ou editar antes de enviar ao jurídico.";
      case "team_leader": return "Mesmas permissões do gestor: você vê as vendas dos corretores vinculados à sua equipe e pode aprovar, devolver ou editar antes de enviar ao jurídico.";
      case "juridico": return "Você vê todas as vendas a partir de \"aprovada pelo gestor\" e conduz elaboração, assinatura e envio para o financeiro.";
      case "financeiro": return "Você vê todas as vendas e é quem trava/libera a edição via ocorrência.";
      case "admin": return "Você vê e edita tudo. Não pode conceder o papel Admin ou Super Admin — só o Super Admin pode.";
      case "super_admin": return "Acesso total, incluindo conceder ou revogar os papéis Admin e Super Admin.";
      default: return "Permissões definidas conforme o papel atribuído ao usuário.";
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
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center gap-4 border-b pb-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={avatarPreview ?? avatarUrl ?? undefined} alt={nome || user?.email || "Foto de perfil"} />
              <AvatarFallback className="text-lg">{(nome || user?.email || "?")[0].toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="space-y-1.5">
              {nome && <div className="font-medium">{nome}</div>}
              <Label className="block text-xs text-muted-foreground">Foto de perfil</Label>
              <div className="flex items-center gap-2">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={selecionarAvatar}
                />
                <Button size="sm" variant="outline" onClick={() => avatarInputRef.current?.click()}>
                  Escolher foto
                </Button>
                {avatarFile && (
                  <Button size="sm" onClick={salvarAvatar} disabled={savingAvatar}>
                    {savingAvatar ? "Salvando..." : "Salvar foto"}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="mb-1"><span className="text-muted-foreground">Email:</span> <b>{user?.email}</b></div>
          <div><span className="text-muted-foreground">Papéis:</span> <b>{roles.map(r => ROLE_LABEL[r]).join(", ") || "Sem papel"}</b></div>
          <div className="max-w-sm">
            <Label className="mb-1.5 block text-xs text-muted-foreground">Telefone (WhatsApp)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="(11) 91234-5678"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
              />
              <Button size="sm" onClick={salvarTelefone} disabled={savingTelefone}>
                {savingTelefone ? "Salvando..." : "Salvar"}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Usado pra avisar por WhatsApp quando uma venda estiver aguardando sua ação.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Segurança
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid max-w-sm gap-3">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Nova senha</Label>
              <Input
                type="password"
                minLength={8}
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                placeholder="Mínimo de 8 caracteres"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Confirmar nova senha</Label>
              <Input
                type="password"
                minLength={8}
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
              />
            </div>
            <Button size="sm" className="w-fit" onClick={trocarSenha} disabled={trocandoSenha || !novaSenha || !confirmarSenha}>
              {trocandoSenha ? "Salvando..." : "Alterar senha"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {roles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4" /> Notificações
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="mb-2 text-xs text-muted-foreground">
              Escolha por qual papel você quer receber aviso. Vale só pra você — não afeta os outros usuários com o mesmo papel.
            </p>
            {roles.map((r) => {
              const todaAtualizacaoLabel =
                r === "corretor" ? "A cada atualização das suas vendas" :
                r === "gestor" ? "A cada atualização das vendas da sua equipe" :
                r === "team_leader" ? "A cada atualização das vendas da sua equipe" :
                r === "juridico" ? "A cada atualização das vendas que já chegaram até você" :
                r === "financeiro" ? "A cada atualização de todas as vendas" :
                null;
              return (
                <div key={r} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{ROLE_LABEL[r]}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Quando for sua vez de agir (WhatsApp)</span>
                      <Switch
                        checked={notifPorPapel[r] ?? true}
                        disabled={savingNotif === `${r}:notificar_whatsapp`}
                        onCheckedChange={(v) => alternarNotifCampo(r, "notificar_whatsapp", v)}
                      />
                    </div>
                  </div>
                  {todaAtualizacaoLabel && (
                    <div className="mt-2 flex items-center justify-between border-t pt-2">
                      <span className="text-xs text-muted-foreground">{todaAtualizacaoLabel} (sino e WhatsApp)</span>
                      <Switch
                        checked={notifAtualizacaoPorPapel[r] ?? (r === "corretor" || r === "gestor" || r === "team_leader")}
                        disabled={savingNotif === `${r}:notificar_toda_atualizacao`}
                        onCheckedChange={(v) => alternarNotifCampo(r, "notificar_toda_atualizacao", v)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

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

      {hasAny(["corretor", "gestor", "team_leader"]) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Minha equipe</CardTitle>
            {hasAny(["gestor", "team_leader", "admin", "super_admin"]) && (
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
