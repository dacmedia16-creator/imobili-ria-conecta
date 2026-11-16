import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  APP_URL,
  ZIONTALK_TIMEOUT_MS,
  ZIONTALK_URL,
  avisosSuprimidosNoContexto,
  erroSemDadosPessoais,
  normalizePhone,
  paraWhatsapp,
} from "@/lib/sale-notifications.functions";
import {
  MAX_AVISOS_POR_CHAMADA,
  motivoParaNaoEnviar,
  textoAvisoLocacao,
  type AvisoReservado,
} from "@/lib/locacao-avisos";

/**
 * Envia os avisos de WhatsApp pendentes DESTA locação ao corretor (t_8f09d406, item 7).
 * - Quem gera os avisos é o banco (gatilhos), com chave única por evento: o mesmo evento nunca vira dois avisos.
 * - Esta função é chamada pela tela logo depois de cada ação (enviar minuta, cobrar pendência, marcar ajuste,
 *   devolver, registrar andamento). O banco confere se quem chamou vê a locação; só então o servidor reserva no
 *   máximo 5 avisos de até 24 h (os mais velhos expiram) e envia pelo MESMO ZionTalk das vendas (ZIONTALK_API_KEY).
 * - Reserva com "FOR UPDATE SKIP LOCKED": duas abas ao mesmo tempo não enviam o mesmo aviso.
 * - Sem ZIONTALK_API_KEY (dev/homologação) nada sai: os avisos ficam "pendente" e expiram em 24 h.
 */
export const enviarAvisosLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ locacaoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: pode, error } = await user.rpc("locacao_avisos_pode", { _id: data.locacaoId });
    if (error || pode !== true) return { enviados: 0, falhas: 0, ignorados: 0 };
    // Visão da plataforma (super-admin dentro de outra imobiliária): igual às vendas, não manda WhatsApp.
    if (await avisosSuprimidosNoContexto(context.supabase))
      return { enviados: 0, falhas: 0, ignorados: 0 };
    const apiKey = process.env.ZIONTALK_API_KEY;
    if (!apiKey) return { enviados: 0, falhas: 0, ignorados: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const { data: reservados, error: e2 } = await admin.rpc("locacao_avisos_reservar", {
      _id: data.locacaoId,
      _limite: MAX_AVISOS_POR_CHAMADA,
    });
    if (e2 || !Array.isArray(reservados)) return { enviados: 0, falhas: 0, ignorados: 0 };

    let enviados = 0;
    let falhas = 0;
    let ignorados = 0;
    for (const a of (reservados as AvisoReservado[]).slice(0, MAX_AVISOS_POR_CHAMADA)) {
      const phone = normalizePhone(a.telefone);
      const motivo = motivoParaNaoEnviar(a, phone);
      if (motivo) {
        ignorados++;
        await admin.rpc("locacao_avisos_concluir", {
          _aviso: a.aviso_id,
          _status: "ignorado",
          _erro: motivo,
        });
        continue;
      }
      const texto = textoAvisoLocacao(a, `${APP_URL}/locacoes/${a.locacao_id}`);
      try {
        const res = await fetch(ZIONTALK_URL, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${apiKey}:`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            msg: paraWhatsapp(texto),
            mobile_phone: phone as string,
          }).toString(),
          signal: AbortSignal.timeout(ZIONTALK_TIMEOUT_MS),
        });
        if (res.status === 201) {
          enviados++;
          await admin.rpc("locacao_avisos_concluir", { _aviso: a.aviso_id, _status: "enviado" });
        } else {
          falhas++;
          const corpo = await res.text().catch(() => "");
          // Resposta 5xx pode ter sido enviada apesar da falha; não reenvia automaticamente.
          const status = res.status >= 500 ? "incerto" : "falhou";
          await admin.rpc("locacao_avisos_concluir", {
            _aviso: a.aviso_id,
            _status: status,
            _erro: `${res.status} ${erroSemDadosPessoais(corpo)}`,
          });
        }
      } catch (e) {
        // A rede pode falhar após a entrega. Todo erro sem resposta confirmada fica "incerto" (sem reenvio).
        const timeout = e instanceof Error && e.name === "TimeoutError";
        falhas++;
        await admin.rpc("locacao_avisos_concluir", {
          _aviso: a.aviso_id,
          _status: "incerto",
          _erro: timeout
            ? `timeout ${ZIONTALK_TIMEOUT_MS / 1000}s`
            : erroSemDadosPessoais(e instanceof Error ? e.message : String(e)),
        });
      }
    }
    return { enviados, falhas, ignorados };
  });
