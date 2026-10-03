import { createClient } from "@supabase/supabase-js";
import { defineTask } from "nitro/task";
import { runExclusiveExpiryAlerts } from "../../src/lib/exclusive-expiry-alerts.server";

const ZIONTALK_URL = "https://app.ziontalk.com/api/send_message/";
const APP_URL = process.env.APP_URL || "https://unicaescolha.com.br";

export default defineTask({
  meta: {
    name: "exclusive-expiry-alerts",
    description: "Alerta semanal (WhatsApp) de exclusividades vencendo ou vencidas.",
  },
  async run() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const apiKey = process.env.ZIONTALK_API_KEY;
    if (!supabaseUrl || !serviceRoleKey || !apiKey) return { result: "configuration_missing" };
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const send = async (phone: string, msg: string) => {
      const r = await fetch(ZIONTALK_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${apiKey}:`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ msg, mobile_phone: phone }).toString(),
      });
      return r.status === 201;
    };
    const { sent, failed } = await runExclusiveExpiryAlerts(supabase, send, APP_URL);
    return { result: `sent:${sent} failed:${failed}` };
  },
});
