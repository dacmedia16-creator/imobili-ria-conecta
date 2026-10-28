import { createFileRoute } from "@tanstack/react-router";
import { depsReengajarReais, receberReengajar } from "@/lib/leads-ia-retorno.server";

// Reengajamento da IA de atendimento (2 toques, ~24 h e ~72 h, card t_fc4d9b27) e lembrete rápido de 15 min
// (t_b3f753a5), na mesma chamada. Sem o segredo LEADS_IA_REENGAJAR_SEGREDO no servidor a rota responde 404; cada
// imobiliária liga cada lembrete na tela (nascem desligados). Quem chama a cada 5 min é o pg_cron "leads-reengajar"
// (configurado em produção no t_6a5312a4, fora do repositório).
export const Route = createFileRoute("/api/leads/reengajar")({
  server: {
    handlers: {
      POST: async ({ request }) => receberReengajar(request, await depsReengajarReais(request)),
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
