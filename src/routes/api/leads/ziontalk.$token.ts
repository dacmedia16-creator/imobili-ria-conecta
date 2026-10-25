import { createFileRoute } from "@tanstack/react-router";
import { depsReais, receberRetornoZionTalk } from "@/lib/leads-ia-retorno.server";

// Retorno ZionTalk -> ADM (a IA de atendimento responde no WhatsApp). Card t_6f688b4b.
// URL: https://<app>/api/leads/ziontalk/<token>. O token vem de Leads -> Configurar -> IA de atendimento.
// Sem página: só POST (o resto recebe 405).
export const Route = createFileRoute("/api/leads/ziontalk/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        receberRetornoZionTalk(request, params.token, await depsReais(request)),
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
