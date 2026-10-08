import { createServerFn } from "@tanstack/react-start";
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
  enviarAvisosCaptacao,
  textoAvisoCaptacao,
  type DestinoAviso,
  type EventoCaptacao,
} from "@/lib/captacao-auditoria";

const Input = z.object({
  captureId: z.string().uuid(),
  evento: z.enum(["enviada", "devolvida", "aprovada"]),
});

const ACAO_DO_EVENTO: Record<EventoCaptacao, string> = {
  enviada: "enviar",
  devolvida: "devolver",
  aprovada: "aprovar",
};

/** Só vale como aviso a transição que esta pessoa acabou de gravar (evita aviso forjado/repetido). */
const JANELA_MS = 2 * 60 * 1000;

/**
 * Avisos da captação exclusiva (sino + WhatsApp), mesmo padrão e mesma chave ZionTalk das vendas.
 * - enviada: gestor/TL (e co-líderes) da equipe do captador;
 * - devolvida (com o motivo) e aprovada: o captador.
 * Quem agiu nunca é avisado de si mesmo. WhatsApp respeita user_roles.notificar_whatsapp (opt-out);
 * sem telefone ou inativo = só sino. Nunca lança: a transição já foi gravada antes desta chamada.
 */
export const notifyCaptureTransition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const vazio = { notified: 0, sent: 0 };
    try {
      const { supabase, userId } = context;
      if (await avisosSuprimidosNoContexto(supabase)) return vazio;

      // Leitura pelo JWT: se a pessoa não enxerga a captação, não avisa ninguém.
      const { data: cap } = await supabase
        .from("exclusive_captures" as never)
        .select("id, organization_id, captor_id, broker_name")
        .eq("id", data.captureId)
        .maybeSingle();
      const capture = cap as {
        id: string;
        organization_id: string;
        captor_id: string | null;
        broker_name: string | null;
      } | null;
      if (!capture) return vazio;

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { leaderIdsForCorretor, roleRowsInOrg, profilesInOrg } = await import(
        "@/lib/sale-notifications.server"
      );
      const admin = supabaseAdmin as unknown as OrgAdminClient;
      const orgId = capture.organization_id;

      // A última ação registrada tem de ser esta, feita agora por quem chamou.
      const { data: hist } = await admin
        .from("exclusive_history")
        .select("action, actor_id, detail, created_at")
        .eq("organization_id", orgId)
        .eq("capture_id", capture.id)
        .in("action", ["enviar", "devolver", "aprovar", "assinatura"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const ultima = hist as {
        action: string;
        actor_id: string;
        detail: string | null;
        created_at: string;
      } | null;
      if (
        !ultima ||
        ultima.action !== ACAO_DO_EVENTO[data.evento] ||
        ultima.actor_id !== userId ||
        Date.now() - new Date(ultima.created_at).getTime() > JANELA_MS
      )
        return vazio;

      const papel = data.evento === "enviada" ? "gestor" : "corretor";
      const ids =
        data.evento === "enviada"
          ? await leaderIdsForCorretor(admin, orgId, capture.captor_id)
          : capture.captor_id
            ? [capture.captor_id]
            : [];
      const alvo = Array.from(new Set(ids)).filter((id) => id !== userId);
      if (!alvo.length) return vazio;

      const [perfis, papeis] = await Promise.all([
        profilesInOrg<{ id: string; telefone: string | null; ativo: boolean | null }>(
          admin,
          orgId,
          alvo,
          "id, telefone, ativo",
        ),
        roleRowsInOrg<{ user_id: string; role: string; notificar_whatsapp: boolean | null }>(
          admin,
          orgId,
          alvo,
        ),
      ]);
      const bate = (role: string) =>
        papel === "gestor" ? role === "gestor" || role === "team_leader" : role === "corretor";
      // Só perfis da própria agência (profilesInOrg filtra) entram como destino.
      const destinos: DestinoAviso[] = perfis.map((p) => ({
        id: p.id,
        telefone: p.telefone,
        ativo: p.ativo,
        querWhatsapp:
          papeis.find((r) => r.user_id === p.id && bate(r.role))?.notificar_whatsapp !== false,
      }));

      const texto = textoAvisoCaptacao({
        evento: data.evento,
        captureId: capture.id,
        corretor: capture.broker_name,
        motivo: data.evento === "devolvida" ? ultima.detail : null,
        appUrl: APP_URL,
      });

      const r = await enviarAvisosCaptacao({
        texto,
        destinos,
        gravarSino: async (rows) => {
          const { error } = await admin.from("notifications").insert(
            rows.map((row) => ({
              ...row,
              organization_id: orgId,
              exclusive_capture_id: capture.id,
              tipo: `captacao_${data.evento}`,
            })),
          );
          if (error) throw new Error(error.message);
        },
        registrar: async (res) => {
          await admin.from("activity_logs").insert({
            organization_id: orgId,
            autor_id: userId,
            acao: "whatsapp_notification_result",
            payload: {
              captacao_id: capture.id,
              evento: `captacao_${data.evento}`,
              enviados: res.enviados,
              falhas: res.falhas,
              ignorados: res.ignorados,
              notificados_interno: res.notificados,
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
      console.error("notifyCaptureTransition", erroSemDadosPessoais(String(e)));
      return vazio;
    }
  });
