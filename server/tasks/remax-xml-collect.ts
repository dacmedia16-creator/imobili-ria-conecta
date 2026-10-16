import { createClient } from "@supabase/supabase-js";
import { defineTask } from "nitro/task";
import { feedTargets, runRemaxXmlCollect } from "../../src/lib/remax-xml";

// Coleta diária do XML VRSync RE/MAX -> OLX (venda), base do Feedback e do mapa de captações (t_698be0d2).
// Só roda com REMAX_XML_COLLECT=on. As URLs ficam em REMAX_XML_FEEDS (segredo do Worker, JSON org -> url).
export default defineTask({
  meta: {
    name: "remax-xml-collect",
    description: "Coleta diária do XML de anúncios RE/MAX (venda) para o Feedback e o mapa.",
  },
  async run() {
    if (process.env.REMAX_XML_COLLECT !== "on") return { result: "disabled" };
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const targets = feedTargets(process.env.REMAX_XML_FEEDS);
    if (!supabaseUrl || !serviceRoleKey || !targets.length) return { result: "configuration_missing" };
    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const log = await runRemaxXmlCollect(
      targets,
      {
        async ingest(org, listings, total, started) {
          const { data, error } = await sb.rpc("remax_xml_ingest", {
            _org: org,
            _listings: listings,
            _total: total,
            _started: started,
          });
          if (error) throw new Error(error.message);
          return data;
        },
        async failed(org, message, started) {
          await sb.rpc("remax_xml_mark_failed", { _org: org, _message: message, _started: started });
        },
      },
      (url, init) => fetch(url, init),
    );
    return { result: log.join(" | ") };
  },
});
