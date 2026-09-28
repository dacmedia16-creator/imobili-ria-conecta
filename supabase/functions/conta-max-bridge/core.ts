// Regras multiempresa da ponte Conta MAX sem dependências do Deno (testável localmente).
// A ponte só emite sessão para usuário com vínculo ativo em agência ativa. Se o ticket trouxer
// `organization_id`, ele precisa coincidir com a agência do usuário (nunca troca de agência).

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type OrgGate = { ok: true; organizationId: string } | { ok: false; error: string };

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
  if (error || !member?.organization_id) return { ok: false, error: "organization_inactive" };
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
