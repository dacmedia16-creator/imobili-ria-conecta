import { createFileRoute } from "@tanstack/react-router";
import { robotsTxt } from "@/lib/seo-publico";

// /robots.txt do app (t_e014564f). Em produção a Cloudflare pode PREFIXAR o bloco "Managed robots.txt"
// a este arquivo; as regras daqui (busca/citação liberadas só nas páginas públicas, treino bloqueado,
// telas internas fora, linha Sitemap) valem logo abaixo. Homologação: tudo bloqueado.
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(robotsTxt(import.meta.env.VITE_HOMOLOG_ONLY === "true"), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        }),
    },
  },
});
