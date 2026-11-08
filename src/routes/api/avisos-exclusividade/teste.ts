import { createFileRoute } from "@tanstack/react-router";
import { receberTesteAvisos } from "@/lib/avisos-teste.server";
import { enviarWhatsappZiontalk } from "@/lib/avisos-canais.server";

// Teste de WhatsApp dos avisos de exclusividade (t_5f295777): 1 mensagem só para o número de teste (secret).
// Desligada (404) sem o segredo AVISOS_TESTE_SEGREDO no servidor.
export const Route = createFileRoute("/api/avisos-exclusividade/teste")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        receberTesteAvisos(request, { env: process.env, whatsapp: enviarWhatsappZiontalk }),
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
