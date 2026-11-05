import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { OrgAdminClient } from "@/lib/org-scope";
import {
  APP_URL,
  avisosSuprimidosNoContexto,
  erroSemDadosPessoais,
  normalizePhone,
  paraWhatsapp,
  ZIONTALK_TIMEOUT_MS,
  ZIONTALK_URL,
} from "@/lib/sale-notifications.functions";
import {
  destinosWhatsappFoto,
  enviarWhatsappFoto,
  EVENTOS_FOTO,
  type AvisoFoto,
} from "@/lib/photo-notifications";

const Input = z.object({
  sessionId: z.string().uuid(),
  evento: z.enum(EVENTOS_FOTO),
});

/**
 * WhatsApp dos avisos de "Agendar fotos" (o sino já foi gravado pelo banco na mesma transação).
 * Mesmo canal e mesma chave ZionTalk das vendas/captações. 1 mensagem por destinatário do evento:
 * - marcada → fotógrafo; confirmada/recusada → corretor; desmarcada → fotógrafo e corretor.
 * A RPC photo_aviso_para_envio (pelo JWT de quem chamou) só devolve algo se a ÚLTIMA ação da sessão
 * for este evento, feita por esta pessoa há no máximo 2 min — evita aviso forjado ou repetido.
 * Nunca lança: a ação já foi gravada antes desta chamada.
 */
export const notifyPhotoSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const vazio = { notified: 0, sent: 0 };
    try {
      const { supabase, userId } = context;
      if (await avisosSuprimidosNoContexto(supabase)) return vazio;

      const db = supabase as unknown as SupabaseClient;
      const { data: raw, error } = await db.rpc("photo_aviso_para_envio", {
        _session: data.sessionId,
        _evento: data.evento,
      });
      const aviso = (error ? null : raw) as AvisoFoto | null;
      if (!aviso || !aviso.destinos?.length) return vazio;

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { roleRowsInOrg, profilesInOrg } = await import("@/lib/sale-notifications.server");
      const admin = supabaseAdmin as unknown as OrgAdminClient;
      const orgId = aviso.organization_id;
      const alvo = aviso.destinos.filter((id) => id !== userId);
      if (!alvo.length) return vazio;

      const [perfis, papeis] = await Promise.all([
        profilesInOrg<{ id: string; telefone: string | null; ativo: boolean | null }>(
          admin,
          orgId,
          alvo,
          "id, telefone, ativo",
        ),
        roleRowsInOrg<{ user_id: string; notificar_whatsapp: boolean | null }>(admin, orgId, alvo),
      ]);

      const r = await enviarWhatsappFoto({
        aviso,
        evento: data.evento,
        appUrl: APP_URL,
        destinos: destinosWhatsappFoto({ ...aviso, destinos: alvo }, perfis, papeis),
        registrar: async (res) => {
          await admin.from("activity_logs").insert({
            organization_id: orgId,
            autor_id: userId,
            acao: "whatsapp_notification_result",
            payload: {
              foto_sessao_id: data.sessionId,
              evento: aviso.tipo,
              enviados: res.enviados,
              falhas: res.falhas,
              ignorados: res.ignorados,
              ...(res.erros.length ? { erros: res.erros } : {}),
            },
          });
        },
        apiKey: process.env.ZIONTALK_API_KEY,
        fetchImpl: fetch,
        url: ZIONTALK_URL,
        timeoutMs: ZIONTALK_TIMEOUT_MS,
        normalizePhone,
        paraWhatsapp,
        semDadosPessoais: erroSemDadosPessoais,
      });
      return { notified: r.notificados, sent: r.enviados };
    } catch (e) {
      console.error("notifyPhotoSession", erroSemDadosPessoais(String(e)));
      return vazio;
    }
  });
