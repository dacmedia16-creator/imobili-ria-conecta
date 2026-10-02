/**
 * Usuários da plataforma — gestão global pelo super-admin (aprovado por Denis, 02/10/2026).
 *
 * Diferente de "Entrar como administrador": aqui o super-admin vê os usuários de TODAS as
 * imobiliárias numa lista só e age direto, sem trocar de contexto.
 *
 * Regras:
 * - toda função começa por `assertPlatformAdmin` (lê `platform_admins` pelo servidor, falha fechada);
 * - a imobiliária do alvo vem SEMPRE do banco (profiles.organization_id), nunca do navegador;
 * - toda alteração exige motivo (mín. 5 caracteres) e grava em `activity_logs` da imobiliária
 *   do usuário, com `via: "plataforma_global"`;
 * - as regras de papel/usuário continuam as mesmas de `user-management-policy` (ator = super admin
 *   da imobiliária do alvo); ninguém altera a própria conta por aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPlatformAdmin } from "./platform-organizations.server";
import type { Actor, ManagedRole } from "./user-management-policy";

export type PlatformUserRow = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  ativo: boolean;
  organizationId: string;
  organizationNome: string;
  roles: ManagedRole[];
  lastSignInAt: string | null;
};

export const PLATFORM_REASON_REQUIRED =
  "Informe o motivo da alteração (mínimo 5 caracteres). Ele fica na auditoria da imobiliária.";

export function assertReason(motivo: string | null | undefined): string {
  const m = (motivo ?? "").trim();
  if (m.length < 5) throw new Error(PLATFORM_REASON_REQUIRED);
  return m;
}

type Admin = SupabaseClient;

export async function listPlatformUsers(
  admin: Admin,
  callerId: string,
): Promise<PlatformUserRow[]> {
  await assertPlatformAdmin(admin, callerId);
  const [orgs, profiles, roles] = await Promise.all([
    admin.from("organizations").select("id, nome"),
    admin.from("profiles").select("id, nome, email, telefone, ativo, organization_id"),
    admin.from("user_roles").select("user_id, organization_id, role"),
  ]);
  if (orgs.error) throw new Error(orgs.error.message);
  if (profiles.error) throw new Error(profiles.error.message);
  if (roles.error) throw new Error(roles.error.message);

  const orgRows = (orgs.data ?? []) as { id: string; nome: string }[];
  const orgName = new Map(orgRows.map((o) => [o.id, o.nome]));

  // Último acesso: a RPC já existente devolve por imobiliária (auth.users não é exposto por RLS).
  const lastSignIn = new Map<string, string | null>();
  await Promise.all(
    orgRows.map(async (o) => {
      const { data, error } = await admin.rpc("mt_2b_org_auth_users", { _org: o.id });
      if (error) return; // sem último acesso não impede a lista
      for (const r of (data ?? []) as { user_id: string; last_sign_in_at: string | null }[]) {
        lastSignIn.set(`${o.id}:${r.user_id}`, r.last_sign_in_at ?? null);
      }
    }),
  );

  const rolesBy = new Map<string, ManagedRole[]>();
  for (const r of (roles.data ?? []) as {
    user_id: string;
    organization_id: string;
    role: ManagedRole;
  }[]) {
    const k = `${r.organization_id}:${r.user_id}`;
    rolesBy.set(k, [...(rolesBy.get(k) ?? []), r.role]);
  }

  type P = {
    id: string;
    nome: string | null;
    email: string | null;
    telefone: string | null;
    ativo: boolean | null;
    organization_id: string | null;
  };
  return ((profiles.data ?? []) as P[])
    .filter((p) => p.organization_id && orgName.has(p.organization_id))
    .map((p) => {
      const k = `${p.organization_id}:${p.id}`;
      return {
        id: p.id,
        nome: p.nome ?? "(sem nome)",
        email: p.email,
        telefone: p.telefone,
        ativo: p.ativo !== false,
        organizationId: p.organization_id as string,
        organizationNome: orgName.get(p.organization_id as string) as string,
        roles: rolesBy.get(k) ?? [],
        lastSignInAt: lastSignIn.get(k) ?? null,
      };
    })
    .sort(
      (a, b) =>
        a.organizationNome.localeCompare(b.organizationNome) || a.nome.localeCompare(b.nome),
    );
}

/** Monta o ator "super admin da imobiliária do alvo", com a imobiliária lida do banco. */
export async function platformActorFor(
  admin: Admin,
  callerId: string,
  targetUserId: string,
): Promise<Actor> {
  await assertPlatformAdmin(admin, callerId);
  if (targetUserId === callerId) {
    throw new Error('Use a tela "Meu acesso" para alterar a sua própria conta.');
  }
  const { data, error } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", targetUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const orgId = (data as { organization_id: string | null } | null)?.organization_id;
  if (!orgId) throw new Error("Usuário não encontrado ou sem imobiliária.");
  return { userId: callerId, orgId, roles: ["super_admin", "admin"], isPlatformAdmin: true };
}

export async function logPlatformUserAction(
  admin: Admin,
  actor: Actor,
  acao: string,
  payload: Record<string, unknown>,
  motivo: string,
) {
  const { error } = await admin.from("activity_logs").insert({
    organization_id: actor.orgId,
    autor_id: actor.userId,
    sale_id: null,
    acao: `${acao}_platform`,
    payload: { ...payload, motivo, via: "plataforma_global" },
  });
  if (error) throw new Error(`Alteração feita, mas a auditoria falhou: ${error.message}`);
}
