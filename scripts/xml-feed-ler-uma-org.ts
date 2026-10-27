// Leitura EXTRA do "Link do XML" de UMA imobiliária (t_25fe1197, aprovada por Denis em 27/10 só para depois
// da publicação). Mesmo caminho da task xml-feed-collect: só GET (fetchXmlSeguro, sem IP interno), modo
// genérico, ingestão pela RPC remax_xml_ingest (que já recusa queda brusca). NÃO mexe no horário dos gatilhos
// nem em outras imobiliárias. Uso (no cartão de publicação, com o ambiente de produção carregado, nunca no git):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/xml-feed-ler-uma-org.ts eb0a260a-db2f-4cbf-b031-f0c2aebb407c
import { createClient } from "@supabase/supabase-js";
import { runRemaxXmlCollect } from "../src/lib/remax-xml";
import { fetchXmlSeguro } from "../src/lib/xml-feed-seguro";

const org = process.argv[2] ?? "";
if (!/^[0-9a-f-]{36}$/.test(org)) throw new Error("Informe o id (uuid) de UMA imobiliária.");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes.");
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await sb.from("organization_xml_feeds").select("organization_id, url").eq("organization_id", org).maybeSingle();
if (error || !data) throw new Error("Imobiliária sem Link do XML (ou leitura falhou).");
const log = await runRemaxXmlCollect(
  [{ org, url: (data as { url: string }).url, modo: "generico" }],
  {
    async ingest(o, listings, total, started, modo) {
      const { data: r, error: e } = await sb.rpc("remax_xml_ingest", { _org: o, _listings: listings, _total: total, _started: started, _modo: modo ?? "generico" });
      if (e) throw new Error(e.message);
      return r;
    },
    async failed(o, message, started) {
      await sb.from("remax_xml_runs").insert({ organization_id: o, status: "erro", message: message.slice(0, 300), started_at: started });
    },
  },
  (u: string) => fetchXmlSeguro(u),
);
// Só o resumo (sem link nem dados pessoais).
console.log(JSON.stringify(log));
