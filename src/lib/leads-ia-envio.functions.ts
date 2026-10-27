import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { escolherCanal, primeiraComLinkProibido } from "./leads-ia-canal";

/**
 * Envio REAL de UMA mensagem pendente da IA pelo WhatsApp (ZionTalk). Card t_5d8c0b63.
 * Fluxo: botão do gestor -> esta função -> confere que o gestor vê a conversa (RLS) -> canal do servidor
 * (LEADS_IA_ENVIO_REAL=on + ZIONTALK_LEADS_IA_API_KEY; senão, nada sai) -> RPC lead_ia_envio_reservar
 * (o BANCO confere IA ligada, canal real na imobiliária e na conversa, contato na LISTA de liberados,
 * opt-out e limite de 1ª mensagem do dia; marca "enviando") -> ZionTalk -> lead_ia_envio_resultado.
 * Uma mensagem por clique; nunca repete sozinho. Sem telefone nem texto em log.
 */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

const Input = z.object({ leadId: z.string().uuid() });

export const enviarMensagemIa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: gestor } = await user.rpc("leads_gestor");
    if (gestor !== true) return { ok: false as const, erro: "sem_permissao" };
    const { data: cv } = await user
      .from("lead_conversas")
      .select("id,canal")
      .eq("lead_id", data.leadId)
      .maybeSingle();
    if (!cv || (cv as { canal: string }).canal !== "ziontalk") return { ok: false as const, erro: "modo_teste" };

    const canal = escolherCanal(process.env as Record<string, string | undefined>);
    if (canal.nome !== "ziontalk") return { ok: false as const, erro: "envio_desligado" };

    const db = await admin();
    const { data: rows, error } = await db.rpc("lead_ia_envio_reservar", { _lead: data.leadId });
    if (error) {
      console.error("lead_ia_envio_reservar falhou:", error.code);
      return { ok: false as const, erro: "falha" };
    }
    const m = (rows as Array<{ msg_id: string; telefone: string; texto: string; primeira: boolean }> | null)?.[0];
    if (!m) return { ok: false as const, erro: "nada_a_enviar" };
    if (m.primeira && primeiraComLinkProibido(m.texto)) { // só o link do anúncio (t_25fe1197)
      await db.rpc("lead_ia_envio_resultado", { _msg: m.msg_id, _ok: false });
      return { ok: false as const, erro: "link_na_primeira" };
    }
    const r = await canal.enviar(m.telefone, m.texto);
    await db.rpc("lead_ia_envio_resultado", { _msg: m.msg_id, _ok: r.status === "enviada" });
    if (r.status !== "enviada") {
      const erro = r.status === "falhou" ? r.erro : "envio_desligado";
      console.error("envio ZionTalk (leads IA) falhou:", erro);
      return { ok: false as const, erro };
    }
    return { ok: true as const };
  });
