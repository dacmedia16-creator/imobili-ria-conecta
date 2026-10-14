// Imports relativos: este módulo também é carregado pela task do Nitro (server/tasks).
import {
  LIMITE_DIARIO_ALERTAS,
  VALIDADE_DIAS,
  alertMessage,
  captureCandidate,
  captureMatches,
  pairKey,
  type CaptureCandidate,
  type OpportunityPost,
} from "./oportunidades";
import type { OrgAdminClient } from "./org-scope";
import { normalizePhone, whatsappText } from "./room-reservation-reminders";

export type AlertRow = { post_id: string; capture_id: string; recipient_id: string | null; status: string; created_at: string };
export type PlannedAlert = { post: OpportunityPost; capture: CaptureCandidate };

const diaSP = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * Decide quais alertas saem agora (lógica pura, testável):
 * - só procura × captação aprovada que encaixa e não foi marcada "não encaixa";
 * - no máximo 1 alerta por procura + captação (já registrado = não repete);
 * - no máximo LIMITE_DIARIO_ALERTAS por captador por dia (o resto fica só no mural).
 */
export function planAlerts(
  posts: OpportunityPost[],
  captures: CaptureCandidate[],
  hidden: Set<string>,
  existing: AlertRow[],
  now: Date = new Date(),
): PlannedAlert[] {
  const feitos = new Set(
    existing.filter((a) => a.status === "sent" || a.status === "dry_run").map((a) => pairKey(a.post_id, a.capture_id)),
  );
  const hoje = diaSP(now);
  const noDia = new Map<string, number>();
  for (const a of existing)
    if (a.recipient_id && (a.status === "sent" || a.status === "dry_run") && diaSP(new Date(a.created_at)) === hoje)
      noDia.set(a.recipient_id, (noDia.get(a.recipient_id) ?? 0) + 1);

  const out: PlannedAlert[] = [];
  // Mais recentes primeiro: se estourar o limite, os pedidos novos têm prioridade.
  const ordenados = [...posts].sort((a, b) => b.posted_at.localeCompare(a.posted_at));
  for (const m of captureMatches(ordenados, captures, hidden, now)) {
    const k = pairKey(m.post.id, m.capture.id);
    if (feitos.has(k)) continue;
    const n = noDia.get(m.capture.captor_id) ?? 0;
    if (n >= LIMITE_DIARIO_ALERTAS) continue;
    noDia.set(m.capture.captor_id, n + 1);
    feitos.add(k);
    out.push(m);
  }
  return out;
}

export type AlertSender = (phone: string, message: string) => Promise<boolean>;
export type AlertOptions = {
  /** Só envia de verdade com OPORTUNIDADES_ALERTAS=on E destino piloto definido. */
  send: AlertSender | null;
  /** Piloto: todo alerta vai para este número (Denis), não para o captador. */
  pilotPhone: string | null;
  appUrl: string;
  now?: Date;
};

type CaptureRow = {
  id: string;
  captor_id: string;
  broker_name: string | null;
  tipo_imovel: string | null;
  bairro: string | null;
  municipio: string | null;
  valor_imovel: string | null;
};

/**
 * Alertas de Oportunidades (service_role, uma imobiliária por vez, só com o módulo ligado).
 * Sem envio liberado tudo é registrado como 'dry_run' em opportunity_alerts (nada sai pelo WhatsApp).
 */
export async function runOpportunityAlerts(
  admin: OrgAdminClient,
  opts: AlertOptions,
): Promise<{ planned: number; sent: number; failed: number; dryRun: number }> {
  const now = opts.now ?? new Date();
  const phone = normalizePhone(opts.pilotPhone);
  const live = Boolean(opts.send && phone);
  const total = { planned: 0, sent: 0, failed: 0, dryRun: 0 };

  const { data: mods, error: modErr } = await admin
    .from("organization_modules")
    .select("organization_id")
    .eq("module", "oportunidades")
    .eq("enabled", true);
  if (modErr) return total;
  const { data: orgs } = await admin.from("organizations").select("id").eq("status", "ativa");
  const active = new Set(((orgs ?? []) as { id: string }[]).map((o) => o.id));
  const desde = new Date(now.getTime() - (VALIDADE_DIAS + 1) * 86_400_000).toISOString();

  for (const { organization_id: orgId } of (mods ?? []) as { organization_id: string }[]) {
    if (!active.has(orgId)) continue;
    const [posts, caps, hid, prev] = await Promise.all([
      admin
        .from("opportunity_posts")
        .select("id,kind,tipo,finalidade,bairro,valor_min,valor_max,valor,corretor,texto,posted_at")
        .eq("organization_id", orgId)
        .eq("kind", "procura")
        .gte("posted_at", desde),
      // Só os campos do encaixe: nada de endereço, proprietário ou documentos.
      admin
        .from("exclusive_captures")
        .select(
          "id,captor_id,broker_name,tipo_imovel:form_data->imovel->>tipo_imovel,bairro:form_data->imovel->>bairro,municipio:form_data->imovel->>municipio,valor_imovel:form_data->imovel->>valor_imovel",
        )
        .eq("organization_id", orgId)
        .eq("status", "aprovada")
        .is("archived_at", null)
        .is("discarded_at", null),
      admin.from("opportunity_hidden_pairs").select("post_id,target_id").eq("organization_id", orgId),
      admin
        .from("opportunity_alerts")
        .select("post_id,capture_id,recipient_id,status,created_at")
        .eq("organization_id", orgId)
        .gte("created_at", desde),
    ]);
    if (posts.error || caps.error || hid.error || prev.error) continue;

    const capRows = (caps.data ?? []) as CaptureRow[];
    const ids = [...new Set(capRows.map((c) => c.captor_id))];
    const { data: profs } = ids.length
      ? await admin.from("profiles").select("id,nome").eq("organization_id", orgId).in("id", ids)
      : { data: [] };
    const nomes = new Map(((profs ?? []) as { id: string; nome: string | null }[]).map((p) => [p.id, p.nome]));
    const captures = capRows.map((c) =>
      captureCandidate({ ...c, captor_nome: c.broker_name?.trim() || nomes.get(c.captor_id) || null }),
    );
    const plan = planAlerts(
      ((posts.data ?? []) as OpportunityPost[]).map((p) => ({
        ...p,
        valor_min: p.valor_min == null ? null : Number(p.valor_min),
        valor_max: p.valor_max == null ? null : Number(p.valor_max),
        valor: p.valor == null ? null : Number(p.valor),
      })),
      captures,
      new Set(((hid.data ?? []) as { post_id: string; target_id: string }[]).map((h) => pairKey(h.post_id, h.target_id))),
      (prev.data ?? []) as AlertRow[],
      now,
    );
    total.planned += plan.length;

    for (const { post, capture } of plan) {
      let status = "dry_run";
      if (live && opts.send && phone) {
        try {
          status = (await opts.send(phone, whatsappText(alertMessage(post, capture, opts.appUrl)))) ? "sent" : "failed";
        } catch {
          status = "failed";
        }
      }
      if (status === "sent") total.sent++;
      else if (status === "failed") total.failed++;
      else total.dryRun++;
      await admin.from("opportunity_alerts").insert({
        organization_id: orgId,
        post_id: post.id,
        capture_id: capture.id,
        recipient_id: capture.captor_id,
        status,
      });
    }
  }
  return total;
}
