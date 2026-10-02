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
