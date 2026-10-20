import { createClient } from "@supabase/supabase-js";
import { defineTask } from "nitro/task";
import { runClicksignAvisos, type PendenteWhats } from "../../src/lib/clicksign-avisos.server";

const ZIONTALK_URL = "https://app.ziontalk.com/api/send_message/";
const APP_URL = process.env.APP_URL || "https://app.somosmaxhub.com.br";

export default defineTask({
  meta: {
    name: "clicksign-avisos",
    description:
      "WhatsApp dos avisos da Clicksign (enviado, todos assinaram, recusado, prazo perto de vencer).",
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
        signal: AbortSignal.timeout(10_000),
      });
      return r.status === 201;
    };
    const r = await runClicksignAvisos(
      {
        async lembretePrazo() {
          const { data, error } = await supabase.rpc("clicksign_lembrete_prazo" as never);
          if (error) throw new Error("lembrete_failed");
          return (data as number | null) ?? 0;
        },
        async pendentes(limite) {
          const { data, error } = await supabase.rpc(
            "clicksign_whatsapp_pendentes" as never,
            { _limite: limite } as never,
          );
          if (error) return [];
          return (data ?? []) as PendenteWhats[];
        },
        async marcar(id, resultado, erro) {
          await supabase.rpc(
            "clicksign_whatsapp_marcar" as never,
            { _id: id, _resultado: resultado, _erro: erro ?? null } as never,
          );
        },
      },
      send,
      APP_URL,
    );
    return {
      result: `lembretes:${r.lembretes} enviados:${r.enviados} ignorados:${r.ignorados} falhas:${r.falhas}`,
    };
  },
});
