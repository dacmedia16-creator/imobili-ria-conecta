import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ROLES = ["corretor", "gestor", "juridico", "financeiro", "admin", "super_admin"] as const;
type Role = (typeof ROLES)[number];

const schema = z.object({
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
  role: z.enum(ROLES),
});

function allowedRolesFor(callerRoles: Role[]): Role[] {
  if (callerRoles.includes("super_admin")) return [...ROLES];
  if (callerRoles.includes("admin")) return ["corretor", "gestor", "juridico", "financeiro"];
  if (callerRoles.includes("gestor")) return ["corretor"];
  return [];
}

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: myRoles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesErr) throw new Error(rolesErr.message);
    const callerRoles = (myRoles ?? []).map((r: any) => r.role as Role);

    const allowed = allowedRolesFor(callerRoles);
    if (allowed.length === 0) throw new Error("Você não tem permissão para criar usuários.");
    if (!allowed.includes(data.role)) {
      throw new Error(`Seu perfil não pode criar usuários do tipo "${data.role}".`);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { nome: data.nome, must_change_password: true },
    });
    if (createErr || !created?.user) {
      const msg = createErr?.message ?? "Falha ao criar usuário";
      if (/already|registered|exists/i.test(msg)) throw new Error("Já existe um usuário com esse e-mail.");
      throw new Error(msg);
    }
    const newId = created.user.id;

    // Trigger handle_new_user já criou profile + role 'corretor'.
    if (data.role !== "corretor") {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", newId).eq("role", "corretor");
      const { error: insErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: newId, role: data.role });
      if (insErr) throw new Error(insErr.message);
    }

    // Gestor criando corretor: vincula automaticamente à equipe principal dele
    // (a de nível 1 que ele já lidera; cria uma se ainda não existir nenhuma).
    if (callerRoles.includes("gestor") && !callerRoles.includes("admin") && !callerRoles.includes("super_admin") && data.role === "corretor") {
      const { data: existingTeam } = await supabaseAdmin
        .from("teams")
        .select("id")
        .eq("lider_id", userId)
        .is("parent_team_id", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      let teamId = existingTeam?.id as string | undefined;
      if (!teamId) {
        const { data: callerProfile } = await supabaseAdmin.from("profiles").select("nome").eq("id", userId).maybeSingle();
        const { data: newTeam, error: teamErr } = await supabaseAdmin
          .from("teams")
          .insert({ lider_id: userId, nome: `Equipe de ${callerProfile?.nome ?? "gestor"}` })
          .select("id")
          .single();
        if (teamErr) throw new Error(teamErr.message);
        teamId = newTeam.id;
      }
      await supabaseAdmin.from("team_members").insert({ team_id: teamId, membro_id: newId });
    }

    // Garante nome atualizado no profile
    await supabaseAdmin.from("profiles").update({ nome: data.nome }).eq("id", newId);

    return { id: newId, email: data.email };
  });
