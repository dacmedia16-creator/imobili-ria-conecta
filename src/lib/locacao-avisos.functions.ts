import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { avisosSuprimidosNoContexto } from "@/lib/sale-notifications.functions";
import { avisosLocacaoLigados } from "@/lib/locacao-avisos";
import { enviarFilaLocacao } from "@/lib/locacao-avisos.server";

/**
 * Envia os avisos de WhatsApp pendentes DESTA locação ao corretor (t_8f09d406, item 7).
 * - Quem gera os avisos é o banco (gatilhos), com chave única por evento: o mesmo evento nunca vira dois avisos.
 * - Esta função é chamada pela tela logo depois de cada ação (enviar minuta, cobrar pendência, marcar ajuste,
 *   devolver, registrar andamento, agendar vistoria, registrar laudo). O banco confere se quem chamou vê a locação;
 *   só então o servidor reserva no máximo 5 avisos de até 24 h (os mais velhos expiram) e envia pelo MESMO ZionTalk
 *   das vendas (ZIONTALK_API_KEY). O envio em si está em locacao-avisos.server.ts, também usado pelos lembretes
 *   da vistoria (t_c3ea1b18).
 * - Reserva com "FOR UPDATE SKIP LOCKED": duas abas ao mesmo tempo não enviam o mesmo aviso.
 * - Sem ZIONTALK_API_KEY (dev/homologação) nada sai: os avisos ficam "pendente" e expiram em 24 h.
 */
export const enviarAvisosLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ locacaoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Trava geral (t_3194d2d4): desligada por padrão. Sai antes de reservar, então a fila fica "pendente".
    if (!avisosLocacaoLigados(process.env.LOCACAO_AVISOS_WHATSAPP))
      return { enviados: 0, falhas: 0, ignorados: 0, desligado: true };
    const user = context.supabase as unknown as SupabaseClient;
    const { data: pode, error } = await user.rpc("locacao_avisos_pode", { _id: data.locacaoId });
    if (error || pode !== true) return { enviados: 0, falhas: 0, ignorados: 0 };
    // Visão da plataforma (super-admin dentro de outra imobiliária): igual às vendas, não manda WhatsApp.
    if (await avisosSuprimidosNoContexto(context.supabase))
      return { enviados: 0, falhas: 0, ignorados: 0 };
    if (!process.env.ZIONTALK_API_KEY) return { enviados: 0, falhas: 0, ignorados: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    return await enviarFilaLocacao(data.locacaoId, {
      rpc: (fn, args) => admin.rpc(fn, args),
      env: process.env as Record<string, string | undefined>,
    });
  });
