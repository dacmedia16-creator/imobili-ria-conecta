import { createFileRoute } from "@tanstack/react-router";
import { depsReengajarReais, receberReengajar } from "@/lib/leads-ia-retorno.server";

// Reengajamento da IA de atendimento (2 toques, ~24 h e ~72 h). Card t_fc4d9b27.
// DESLIGADO: sem o segredo LEADS_IA_REENGAJAR_SEGREDO no servidor a rota responde 404; e cada imobiliária
// precisa ligar o reengajamento na tela (nasce desligado). Nada agenda esta chamada nesta entrega.
export const Route = createFileRoute("/api/leads/reengajar")({
  server: {
    handlers: {
      POST: async ({ request }) => receberReengajar(request, await depsReengajarReais(request)),
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
