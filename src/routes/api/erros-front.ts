import { createFileRoute } from "@tanstack/react-router";
import { receberErroFront } from "@/lib/erros-front.server";

// Erros do navegador (t_59e94d27): recebe um resumo mascarado e escreve 1 linha no Workers Logs.
// Sem banco e sem terceiros. Resposta 204 sem corpo.
export const Route = createFileRoute("/api/erros-front")({
  server: {
    handlers: {
      POST: async ({ request }) => receberErroFront(request),
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
