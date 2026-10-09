import { createClient } from "@supabase/supabase-js";
import { defineTask } from "nitro/task";
import { runRemaxSiteCollect } from "../../src/lib/remax-site";

// Coleta diária dos anúncios públicos do site RE/MAX (sem IA, sem custo; cron do próprio Worker).
// Só roda quando REMAX_SITE_COLLECT=on (variável do Worker): publicar o código NÃO liga a coleta sozinha.
export default defineTask({
  meta: {
    name: "remax-site-collect",
    description: "Coleta diária dos anúncios do site RE/MAX para sugerir o anúncio na captação.",
  },
  async run() {
    if (process.env.REMAX_SITE_COLLECT !== "on") return { result: "disabled" };
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return { result: "configuration_missing" };
    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const log = await runRemaxSiteCollect(
      {
        async targets() {
          const { data, error } = await sb.rpc("remax_site_collect_targets");
          if (error) throw new Error(error.message);
          return (data ?? []) as { organization_id: string; offices: number[] }[];
        },
        async ingest(org, listings, agents, started) {
          const { data, error } = await sb.rpc("remax_site_ingest", {
            _org: org,
            _listings: listings,
            _agents: agents,
            _started: started,
          });
          if (error) throw new Error(error.message);
          return data;
        },
        async failed(org, message, started) {
          await sb.rpc("remax_site_mark_failed", {
            _org: org,
            _message: message,
            _started: started,
          });
        },
      },
      (url, init) => fetch(url, init),
    );
    return { result: log.join(" | ") };
  },
});
