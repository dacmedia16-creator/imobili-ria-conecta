import { createFileRoute } from "@tanstack/react-router";
import { receberLeadGrupoOlx, rpcReceberReal } from "@/lib/leads-grupo-olx.server";

// Webhook do Grupo ZAP/OLX: Canal Pro -> Integrações -> Leads -> "Receber leads no CRM".
// URL: https://<app>/api/leads/grupo-olx/<token>. O token vem da tela Leads -> Configurar.
// Card t_478b211e. Sem página: só POST (o resto recebe 405).
export const Route = createFileRoute("/api/leads/grupo-olx/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        receberLeadGrupoOlx(request, params.token, await rpcReceberReal()),
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
