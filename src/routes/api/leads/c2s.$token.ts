import { createFileRoute } from "@tanstack/react-router";
import { buscarLeadC2sReal, receberLeadC2s, rpcC2sReal } from "@/lib/leads-c2s.server";
import { depsReais, enviarAvisosCorretor } from "@/lib/leads-ia-retorno.server";

// Webhook do C2S (on_create_lead): URL https://<app>/api/leads/c2s/<token>. Card t_32f5458d.
// Sem página: só POST (o resto recebe 405). O aviso ao corretor sai logo depois, em segundo plano; o pg_cron
// (a cada 5 min, rota /api/leads/reengajar) repesca o que sobrar. Nada sai sem lead_config.c2s_aviso_whats.
export const Route = createFileRoute("/api/leads/c2s/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const env = process.env as Record<string, string | undefined>;
        const res = await receberLeadC2s(
          request,
          params.token,
          await rpcC2sReal(),
          buscarLeadC2sReal(env),
        );
        if (res.status === 200) {
          const deps = await depsReais(request).catch(() => null);
          if (deps?.avisos) {
            const p = enviarAvisosCorretor(null, { ...deps, ...deps.avisos })
              .then(() => undefined)
              .catch(() => {
                console.error("leads c2s: aviso ao corretor falhou");
              });
            if (deps.emSegundoPlano) deps.emSegundoPlano(p);
            else await p;
          }
        }
        return res;
      },
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
