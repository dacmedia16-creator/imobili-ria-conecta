import type { OrgAdminClient } from "./org-scope";

/**
 * Acesso a dados com service_role para os avisos de venda, sempre restrito à agência da venda.
 * Cada consulta filtra organization_id; destinatários de outra agência nunca entram na lista.
 */

/** Agência da venda (lida pelo servidor, nunca informada pelo cliente). */
export async function saleOrg(admin: OrgAdminClient, saleId: string): Promise<string | null> {
  const { data } = await admin
    .from("sales")
    .select("organization_id")
    .eq("id", saleId)
    .maybeSingle();
  return (data?.organization_id as string | undefined) ?? null;
}

/** Líderes e co-líderes das equipes do corretor, dentro da agência. */
export async function leaderIdsForCorretor(
  admin: OrgAdminClient,
  orgId: string,
  corretorId: string | null,
): Promise<string[]> {
  if (!corretorId) return [];
  const { data: tm } = await admin
    .from("team_members")
    .select("team_id")
    .eq("organization_id", orgId)
    .eq("membro_id", corretorId);
  const teamIds = Array.from(new Set((tm ?? []).map((t: { team_id: string }) => t.team_id)));
  if (!teamIds.length) return [];
  const [{ data: teams }, { data: coLeaders }] = await Promise.all([
    admin.from("teams").select("lider_id").eq("organization_id", orgId).in("id", teamIds),
    admin
      .from("team_co_leaders")
      .select("user_id")
      .eq("organization_id", orgId)
      .in("team_id", teamIds),
  ]);
  return Array.from(
    new Set([
      ...(teams ?? [])
        .map((t: { lider_id: string | null }) => t.lider_id)
        .filter((id: string | null): id is string => !!id),
      ...(coLeaders ?? []).map((c: { user_id: string }) => c.user_id),
    ]),
  );
}

/** Usuários com o papel na agência (jurídico/financeiro etc.). */
export async function roleUserIds(
  admin: OrgAdminClient,
  orgId: string,
  role: string,
): Promise<string[]> {
  const { data } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", role);
  return (data ?? []).map((u: { user_id: string }) => u.user_id);
}

export async function profilesInOrg<T>(
  admin: OrgAdminClient,
  orgId: string,
  ids: string[],
  columns: string,
): Promise<T[]> {
  if (!ids.length) return [];
  const { data } = await admin
    .from("profiles")
    .select(columns)
    .eq("organization_id", orgId)
    .in("id", ids);
  return (data ?? []) as T[];
}

export async function roleRowsInOrg<T>(
  admin: OrgAdminClient,
  orgId: string,
  ids: string[],
): Promise<T[]> {
  if (!ids.length) return [];
  const { data } = await admin
    .from("user_roles")
    .select("user_id, role, notificar_whatsapp, notificar_toda_atualizacao")
    .eq("organization_id", orgId)
    .in("user_id", ids);
  return (data ?? []) as T[];
}

/** Remove IDs que não pertencem à agência (defesa extra antes de qualquer escrita/envio). */
export async function keepOrgMembers(
  admin: OrgAdminClient,
  orgId: string,
  ids: Iterable<string>,
): Promise<Set<string>> {
  const list = Array.from(new Set(ids));
  const rows = await profilesInOrg<{ id: string }>(admin, orgId, list, "id");
  return new Set(rows.map((r) => r.id));
}
