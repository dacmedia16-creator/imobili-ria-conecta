import { createFileRoute } from "@tanstack/react-router";
import { depsRetornoAquecerReais, receberRetornoZionTalk } from "@/lib/leads-ia-retorno.server";

// Retorno do chip do AQUECIMENTO de leads parados (t_a2cae373). Separado do retorno do chip de atendimento
// (/api/leads/ziontalk/<token>): token próprio (Leads -> Configurar -> Aquecer leads parados) e respostas pelo
// chip do aquecimento. A mensagem cai na mesma conversa do lead. Sem página: só POST (o resto recebe 405).
// t_879234c7: cada chip tem o próprio link; o token diz de qual chip é e as respostas saem pela chave dele.
export const Route = createFileRoute("/api/leads/aquecer/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        receberRetornoZionTalk(
          request,
          params.token,
          await depsRetornoAquecerReais(request, params.token),
        ),
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
