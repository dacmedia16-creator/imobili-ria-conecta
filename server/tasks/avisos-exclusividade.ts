import { createClient } from "@supabase/supabase-js";
import { defineTask } from "nitro/task";
import { runAvisosExclusividade } from "../../src/lib/avisos-exclusividade.server";
import { canaisReais } from "../../src/lib/avisos-canais.server";

export default defineTask({
  meta: {
    name: "avisos-exclusividade",
    description:
      "Avisos diários de exclusividade (30/15/0 dias, vencida semanal, reunião de 45 dias, resumo de segunda). " +
      "Padrão SIMULAÇÃO; só envia com AVISOS_EXCLUSIVIDADE=on e nas imobiliárias com o módulo ligado.",
  },
  async run() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return { result: "configuration_missing" };
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const live = process.env.AVISOS_EXCLUSIVIDADE === "on";
    const canais = live
      ? canaisReais(supabase, {
          vapid: {
            publicKey: process.env.VAPID_PUBLIC_KEY,
            privateKey: process.env.VAPID_PRIVATE_KEY,
            subject: process.env.VAPID_SUBJECT,
          },
          ziontalkKey: process.env.ZIONTALK_API_KEY,
        })
      : null;
    const r = await runAvisosExclusividade(supabase, canais);
    const resumo = r.orgs
      .map((o) => `${o.orgId.slice(0, 8)}:${JSON.stringify(o.totais.porTipo)}${o.erro ? ` erro:${o.erro}` : ""}`)
      .join(" | ");
    console.log(`avisos-exclusividade ${r.modo} ${r.hoje} ${resumo}`);
    return { result: `${r.modo} orgs:${r.orgs.length}` };
  },
});
