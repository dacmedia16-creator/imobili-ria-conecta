// Imports relativos: este módulo também é carregado pela task do Nitro (server/tasks).
import { captureValidity, formatDateBR, type Capture, type Validity } from "./exclusive-captures";
import type { OrgAdminClient } from "./org-scope";
import { normalizePhone, whatsappText } from "./room-reservation-reminders";
import { leaderIdsForCorretor, roleUserIds } from "./sale-notifications.server";

/** Entra no alerta: vence em até 30 dias ou venceu há no máximo 30 dias (depois disso para de avisar). */
export const ALERT_AHEAD = 30;
export const ALERT_BEHIND = 30;
export type ExpiryItem = { c: Capture; v: Validity };

export function expiringItems(list: Capture[], today: string): ExpiryItem[] {
  const out: ExpiryItem[] = [];
  for (const c of list) {
    if (c.status !== "aprovada" || c.archived_at) continue;
    const v = captureValidity(c, today);
    if (v && v.daysLeft <= ALERT_AHEAD && v.daysLeft >= -ALERT_BEHIND) out.push({ c, v });
  }
  return out.sort((a, b) => a.v.daysLeft - b.v.daysLeft);
}

/** Segunda-feira da semana (São Paulo) — chave para não repetir o alerta na mesma semana. */
export function weekStart(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = segunda
  return new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
}

const MAX_LINES = 15;
/** Mensagem só com dados do imóvel e do captador (nunca do proprietário). */
export function expiryMessage(items: ExpiryItem[], appUrl = "https://unicaescolha.com.br"): string {
  const line = ({ c, v }: ExpiryItem) => {
    const i = c.form_data.imovel;
    const imovel = [i?.endereco?.trim() || i?.tipo_imovel?.trim() || "Imovel", i?.bairro?.trim()]
      .filter(Boolean)
      .join(" - ");
    const quando =
      v.daysLeft < 0
        ? `venceu em ${formatDateBR(v.end)}`
        : v.daysLeft === 0
          ? "vence hoje"
          : `vence em ${formatDateBR(v.end)} (${v.daysLeft} dia${v.daysLeft === 1 ? "" : "s"})`;
    return `- ${imovel} | captador: ${c.broker_name || "-"} | ${quando}`;
  };
  const vencidas = items.filter((x) => x.v.daysLeft < 0);
  const vencendo = items.filter((x) => x.v.daysLeft >= 0);
  const parts = ["*Exclusividades: vencimentos da semana*"];
  let used = 0;
  const block = (title: string, xs: ExpiryItem[]) => {
    if (!xs.length) return;
    const shown = xs.slice(0, Math.max(0, MAX_LINES - used));
    used += shown.length;
    parts.push(`\n${title}:\n${shown.map(line).join("\n")}`);
    if (xs.length > shown.length) parts.push(`... e mais ${xs.length - shown.length}`);
  };
  block("Ja vencidas", vencidas);
  block("Vencem em ate 30 dias", vencendo);
  parts.push(
    `\nConverse com o proprietario sobre a renovacao.\nPainel: ${appUrl}/exclusividades/painel`,
  );
  return whatsappText(parts.join("\n"));
}

type ProfileRow = { id: string; telefone: string | null; ativo: boolean | null };
type RoleRow = { user_id: string; notificar_whatsapp: boolean | null };
export type ExpirySender = (phone: string, message: string) => Promise<boolean>;

/**
 * Alerta semanal de vencimento das exclusividades, por WhatsApp (service_role, uma agência por vez).
 * Cada pessoa recebe só o que já pode ver no sistema: o captador as dele, o líder/gestor as da
 * equipe e o administrador todas da agência. Respeita "notificar por WhatsApp" desligado e não
 * repete na mesma semana (tabela de entregas).
 */
export async function runExclusiveExpiryAlerts(
  admin: OrgAdminClient,
  send: ExpirySender,
  appUrl: string,
  now: Date = new Date(),
): Promise<{ sent: number; failed: number }> {
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const week = weekStart(today);
  const { data: mods, error: modErr } = await admin
    .from("organization_modules")
    .select("organization_id")
    .eq("module", "captacao_exclusiva")
    .eq("enabled", true);
  if (modErr) return { sent: 0, failed: 0 };
  const { data: orgs } = await admin.from("organizations").select("id").eq("status", "ativa");
  const active = new Set(((orgs ?? []) as { id: string }[]).map((o) => o.id));
  let sent = 0;
  let failed = 0;

  for (const { organization_id: orgId } of (mods ?? []) as { organization_id: string }[]) {
    if (!active.has(orgId)) continue;
    const { data: caps, error } = await admin
      .from("exclusive_captures")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "aprovada")
      .is("archived_at", null)
      .is("discarded_at", null)
      .not("signed_on", "is", null);
    if (error) continue;
    const items = expiringItems((caps ?? []) as Capture[], today);
    if (!items.length) continue;

    // Quem recebe o quê.
    const admins = [
      ...(await roleUserIds(admin, orgId, "admin")),
      ...(await roleUserIds(admin, orgId, "super_admin")),
    ];
    const byUser = new Map<string, ExpiryItem[]>();
    const give = (uid: string, it: ExpiryItem) => {
      const xs = byUser.get(uid) ?? [];
      if (!xs.includes(it)) xs.push(it);
      byUser.set(uid, xs);
    };
    const leadersCache = new Map<string, string[]>();
    for (const it of items) {
      give(it.c.captor_id, it);
      let leaders = leadersCache.get(it.c.captor_id);
      if (!leaders) {
        leaders = await leaderIdsForCorretor(admin, orgId, it.c.captor_id);
        leadersCache.set(it.c.captor_id, leaders);
      }
      leaders.forEach((l) => give(l, it));
      admins.forEach((a) => give(a, it));
    }

    const ids = [...byUser.keys()];
    const [{ data: profiles }, { data: roles }, { data: done }] = await Promise.all([
      admin
        .from("profiles")
        .select("id, telefone, ativo")
        .eq("organization_id", orgId)
        .in("id", ids),
      admin
        .from("user_roles")
        .select("user_id, notificar_whatsapp")
        .eq("organization_id", orgId)
        .in("user_id", ids),
      admin
        .from("exclusive_expiry_alert_deliveries")
        .select("recipient_id")
        .eq("organization_id", orgId)
        .eq("week_start", week)
        .not("sent_at", "is", null),
    ]);
    const prof = new Map(((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p]));
    const wants = new Map<string, boolean>();
    for (const r of (roles ?? []) as RoleRow[])
      wants.set(r.user_id, (wants.get(r.user_id) ?? false) || r.notificar_whatsapp !== false);
    const already = new Set(
      ((done ?? []) as { recipient_id: string }[]).map((d) => d.recipient_id),
    );
    const phonesUsed = new Set<string>();

    for (const [uid, its] of byUser) {
      const p = prof.get(uid); // só gente da mesma agência
      if (!p || p.ativo === false || !wants.get(uid) || already.has(uid)) continue;
      const phone = normalizePhone(p.telefone);
      if (!phone || phonesUsed.has(phone)) continue;
      phonesUsed.add(phone);
      let lastError: string | null = null;
      try {
        if (!(await send(phone, expiryMessage(its, appUrl)))) lastError = "ziontalk_send_failed";
      } catch {
        lastError = "ziontalk_request_failed";
      }
      if (lastError) failed++;
      else sent++;
      await admin.from("exclusive_expiry_alert_deliveries").upsert(
        {
          organization_id: orgId,
          week_start: week,
          recipient_id: uid,
          items: its.length,
          updated_at: new Date().toISOString(),
          ...(lastError
            ? { last_error: lastError }
            : { sent_at: new Date().toISOString(), last_error: null }),
        },
        { onConflict: "week_start,recipient_id" },
      );
    }
  }
  return { sent, failed };
}
