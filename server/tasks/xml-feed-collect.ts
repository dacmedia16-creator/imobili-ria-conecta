import { createClient } from "@supabase/supabase-js";
import { defineTask } from "nitro/task";
import { runRemaxXmlCollect } from "../../src/lib/remax-xml";
import { fetchXmlSeguro } from "../../src/lib/xml-feed-seguro";

// Coleta de HORA EM HORA dos links "Link do XML (portais)" cadastrados na tela (card t_76243950), modo
// genérico (sem contato). Mesma chave da coleta RE/MAX: só roda com REMAX_XML_COLLECT=on. Os links vêm da
// tabela organization_xml_feeds (só service_role lê). Download sempre com fetchXmlSeguro (sem IP interno).
// O REMAX_XML_FEEDS (Única Escolha) continua na task remax-xml-collect, 1x por dia, sem mudança.
export default defineTask({
  meta: {
    name: "xml-feed-collect",
    description: "Coleta de hora em hora dos XML de portais cadastrados por imobiliária (modo genérico).",
  },
  async run() {
    if (process.env.REMAX_XML_COLLECT !== "on") return { result: "disabled" };
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return { result: "configuration_missing" };
    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await sb.from("organization_xml_feeds").select("organization_id, url");
    if (error) return { result: "read_failed" };
    const targets = ((data ?? []) as { organization_id: string; url: string }[]).map((r) => ({
      org: r.organization_id,
      url: r.url,
      modo: "generico" as const,
    }));
    if (!targets.length) return { result: "no_feeds" };
    const log = await runRemaxXmlCollect(
      targets,
      {
        async ingest(org, listings, total, started, modo) {
          const { data: r, error: e } = await sb.rpc("remax_xml_ingest", {
            _org: org,
            _listings: listings,
            _total: total,
            _started: started,
            _modo: modo ?? "generico",
          });
          if (e) throw new Error(e.message);
          return r;
        },
        async failed(org, message, started) {
          await sb.rpc("remax_xml_mark_failed", { _org: org, _message: message, _started: started });
        },
      },
      (url, init) => fetchXmlSeguro(url, init),
    );
    return { result: log.join(" | ") };
  },
});
