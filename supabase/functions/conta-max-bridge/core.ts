// Regras multiempresa da ponte Conta MAX sem dependências do Deno (testável localmente).
// A ponte só emite sessão para usuário com vínculo ativo em agência ativa. Se o ticket trouxer
// `organization_id`, ele precisa coincidir com a agência do usuário (nunca troca de agência).

// deno-lint-ignore no-explicit-any
type AdminClient = any;

// Exceção: administrador da plataforma (platform_admins) sem vínculo de agência recebe sessão
// sem agência — ele cai no Painel da Plataforma e só acessa agências via platform_enter_org.
export type OrgGate =
  | { ok: true; organizationId: string | null }
  | { ok: false; error: string };

async function isPlatformAdmin(admin: AdminClient, admUserId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", admUserId)
    .maybeSingle();
  return !error && Boolean(data?.user_id);
}

// O ticket só vale se a Conta MAX afirmar que o e-mail foi verificado no WorkOS.
// ATENÇÃO na publicação: só publique esta exigência DEPOIS que a Conta MAX já estiver
// emitindo tickets com `email_verified: true`; antes disso, todo login seria recusado.
export function ticketEmailVerified(payload: { email_verified?: unknown }): boolean {
  return payload?.email_verified === true;
}

// Vínculo Conta MAX (workos_user_id) ↔ usuário do ADM.
// Regra de segurança: o e-mail do ticket só serve para criar o PRIMEIRO vínculo de um usuário do ADM.
// - vínculo ativo do mesmo sub → entra;
// - usuário do ADM já ligado (ativo OU revogado) a outro sub → 403 identity_conflict, sem sobrescrever;
// - vínculo revogado do mesmo sub → 403 identity_revoked (reativação só por admin, fora da ponte);
// - sub já ligado a outro usuário do ADM → 403 identity_conflict;
// - nenhum vínculo para o sub nem para o usuário → insert (primeiro vínculo legítimo).
export type LinkResult =
  | { ok: true; admUserId: string; created: boolean }
  | { ok: false; status: number; error: string };

export async function resolveBridgeLink(
  admin: AdminClient,
  sub: string,
  email: string,
): Promise<LinkResult> {
  const links = () => admin.from("conta_max_identity_links");
  const { data: bySub, error: subError } = await links()
    .select("adm_user_id, active")
    .eq("workos_user_id", sub)
    .maybeSingle();
  if (subError) return { ok: false, status: 500, error: "identity_lookup_failed" };
  if (bySub?.active === true) return { ok: true, admUserId: bySub.adm_user_id, created: false };

  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersError) return { ok: false, status: 500, error: "identity_lookup_failed" };
  const matches = (usersPage?.users ?? []).filter(
    (user: { email?: string | null }) =>
      String(user.email ?? "")
        .trim()
        .toLowerCase() === email,
  );
  if (matches.length !== 1)
    return {
      ok: false,
      status: 403,
      error: matches.length === 0 ? "account_email_not_found" : "account_email_ambiguous",
    };
  const admUserId = matches[0].id as string;

  if (bySub) {
    // Vínculo deste sub existe mas está revogado.
    return {
      ok: false,
      status: 403,
      error: bySub.adm_user_id === admUserId ? "identity_revoked" : "identity_conflict",
    };
  }

  const { data: byAdm, error: admError } = await links()
    .select("id, workos_user_id, active")
    .eq("adm_user_id", admUserId)
    .maybeSingle();
  if (admError) return { ok: false, status: 500, error: "identity_lookup_failed" };
  if (byAdm) return { ok: false, status: 403, error: "identity_conflict" };

  const { error: insertError } = await links().insert({
    workos_user_id: sub,
    adm_user_id: admUserId,
    active: true,
  });
  // Corrida com outro login: as colunas são UNIQUE; nunca cai em update.
  if (insertError) return { ok: false, status: 403, error: "identity_conflict" };
  return { ok: true, admUserId, created: true };
}

export async function bridgeOrgGate(
  admin: AdminClient,
  admUserId: string,
  ticketOrganizationId?: unknown,
): Promise<OrgGate> {
  const { data: member, error } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", admUserId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) return { ok: false, error: "organization_inactive" };
  if (!member?.organization_id) {
    if (await isPlatformAdmin(admin, admUserId)) return { ok: true, organizationId: null };
    return { ok: false, error: "organization_inactive" };
  }
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("id", member.organization_id)
    .eq("status", "ativa")
    .maybeSingle();
  if (orgError || !org) return { ok: false, error: "organization_inactive" };
  if (
    ticketOrganizationId !== undefined &&
    ticketOrganizationId !== null &&
    String(ticketOrganizationId) !== member.organization_id
  ) {
    return { ok: false, error: "organization_mismatch" };
  }
  return { ok: true, organizationId: member.organization_id as string };
}
