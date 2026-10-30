import { createFileRoute } from "@tanstack/react-router";
import { receberLeadGrupoOlx, rpcReceberReal } from "@/lib/leads-grupo-olx.server";
import { dispararPrimeiraAuto } from "@/lib/leads-ia-retorno.server";

// Webhook do Grupo ZAP/OLX: Canal Pro -> Integrações -> Leads -> "Receber leads no CRM".
// URL: https://<app>/api/leads/grupo-olx/<token>. O token vem da tela Leads -> Configurar.
// Card t_478b211e. Sem página: só POST (o resto recebe 405).
export const Route = createFileRoute("/api/leads/grupo-olx/$token")({
  server: {
    handlers: {
      // t_ccaa41c0: lead gravado (200) -> 1ª mensagem automática na hora, em segundo plano (só onde a imobiliária ligou).
      POST: async ({ request, params }) => {
        const res = await receberLeadGrupoOlx(request, params.token, await rpcReceberReal());
        if (res.status === 200) await dispararPrimeiraAuto(request).catch(() => undefined);
        return res;
      },
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
