import { defineTask } from "nitro/task";
import { depsEsperaReais, esperaUmaRodada } from "../../src/lib/leads-ia-retorno.server";

// t_82c89141 item 6b: resposta de espera depois do repasse ao corretor (1 por conversa a cada 2 h, só se ninguém
// da equipe respondeu em lead_config.ia_espera_min). Se a migration 20261027200000 não estiver aplicada, a RPC
// falha e a tarefa só registra "erro" (nada é enviado).
export default defineTask({
  meta: {
    name: "leads-ia-espera",
    description: "Nicole: resposta curta de espera quando o cliente escreve depois do repasse e ninguém responde.",
  },
  async run() {
    const r = await esperaUmaRodada(await depsEsperaReais()).catch(() => ({ r: "erro" as const }));
    return { result: r.r === "preparado" ? `preparado leads:${r.leads} enviadas:${r.enviadas}` : r.r };
  },
});
