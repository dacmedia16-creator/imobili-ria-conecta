// Canais dos avisos de exclusividade (cartão t_c337fc12): sino, web push e WhatsApp (ZionTalk do ADM MAX).
// Imports relativos: também carregado pela task do Nitro (server/tasks).
//
// Segredos (nunca no código): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (push) e ZIONTALK_API_KEY
// (o mesmo canal dos avisos de vendas/captação/salas; NÃO é o do Visita Prova nem o da Nicole/leads).
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import type { OrgAdminClient } from "./org-scope";
import type { Canais, Envio, Inscricao } from "./avisos-exclusividade.server";

export const ZIONTALK_URL = "https://app.ziontalk.com/api/send_message/";
const TIMEOUT_MS = 10_000;

export type VapidEnv = { publicKey?: string; privateKey?: string; subject?: string };

export function vapidConfigurado(v: VapidEnv): v is Required<VapidEnv> {
  return !!(v.publicKey && v.privateKey && v.subject);
}

/** Um push para um aparelho. Devolve o status HTTP do serviço de push (201 = entregue ao serviço). */
export async function enviarPush(
  sub: Pick<Inscricao, "endpoint" | "p256dh" | "auth">,
  dados: { titulo: string; mensagem: string; url: string; tag?: string },
  vapid: Required<VapidEnv>,
): Promise<number> {
  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    expirationTime: null,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  const payload = await buildPushPayload(
    {
      data: { title: dados.titulo, body: dados.mensagem, url: dados.url, tag: dados.tag ?? null },
      options: { ttl: 12 * 3600, urgency: "normal" },
    },
    subscription,
    vapid,
  );
  const r = await fetch(sub.endpoint, { ...payload, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return r.status;
}

export async function enviarWhatsappZiontalk(
  apiKey: string,
  telefone: string,
  texto: string,
): Promise<boolean> {
  const r = await fetch(ZIONTALK_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ msg: texto, mobile_phone: telefone }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return r.status === 201;
}

/** Canais reais. Push/WhatsApp sem segredo configurado ficam null (registrados como "sem_destino"). */
export function canaisReais(
  admin: OrgAdminClient,
  env: { vapid: VapidEnv; ziontalkKey?: string },
): Canais {
  const vapid = vapidConfigurado(env.vapid) ? env.vapid : null;
  return {
    async sino(e: Envio) {
      const { error } = await admin.from("notifications").insert({
        organization_id: e.orgId,
        user_id: e.recipientId,
        exclusive_capture_id: e.captureId,
        tipo: `aviso_${e.tipo}`,
        titulo: e.titulo,
        mensagem: e.mensagem,
      });
      if (error) throw new Error(error.message);
    },
    push: vapid
      ? async (e, subs) => {
          let ok = 0;
          let falhas = 0;
          for (const s of subs) {
            try {
              const st = await enviarPush(
                s,
                { titulo: e.titulo, mensagem: e.mensagem, url: e.url, tag: `${e.tipo}:${e.captureId ?? ""}` },
                vapid,
              );
              if (st >= 200 && st < 300) {
                ok++;
                await admin
                  .from("push_subscriptions")
                  .update({ ultimo_ok_em: new Date().toISOString(), falhas: 0 })
                  .eq("id", s.id);
              } else {
                falhas++;
                // 404/410 = aparelho saiu ou desinstalou: apaga a inscrição.
                if (st === 404 || st === 410)
                  await admin.from("push_subscriptions").delete().eq("id", s.id);
              }
            } catch {
              falhas++;
            }
          }
          return { ok, falhas };
        }
      : null,
    whatsapp: env.ziontalkKey
      ? (telefone, texto) => enviarWhatsappZiontalk(env.ziontalkKey as string, telefone, texto)
      : null,
  };
}
