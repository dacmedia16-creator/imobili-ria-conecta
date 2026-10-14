import { createClient } from "@supabase/supabase-js";
import { defineTask } from "nitro/task";
import { runOpportunityAlerts } from "../../src/lib/oportunidades-alerts.server";

const ZIONTALK_URL = "https://app.ziontalk.com/api/send_message/";
const APP_URL = process.env.APP_URL || "https://unicaescolha.com.br";

export default defineTask({
  meta: {
    name: "opportunity-alerts",
    description:
      "Oportunidades: procura do grupo × captação da equipe. Padrão dry-run; só envia com OPORTUNIDADES_ALERTAS=on e destino piloto.",
  },
  async run() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return { result: "configuration_missing" };
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const apiKey = process.env.ZIONTALK_API_KEY;
    // Piloto: tudo vai para o número do Denis (OPORTUNIDADES_ALERTAS_DESTINO), nunca direto ao captador.
    const live = process.env.OPORTUNIDADES_ALERTAS === "on" && Boolean(apiKey);
    const send = live
      ? async (phone: string, msg: string) => {
          const r = await fetch(ZIONTALK_URL, {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${apiKey}:`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ msg, mobile_phone: phone }).toString(),
          });
          return r.status === 201;
        }
      : null;
    const r = await runOpportunityAlerts(supabase, {
      send,
      pilotPhone: process.env.OPORTUNIDADES_ALERTAS_DESTINO ?? null,
      appUrl: APP_URL,
    });
    return { result: `planned:${r.planned} sent:${r.sent} failed:${r.failed} dry_run:${r.dryRun}` };
  },
});
