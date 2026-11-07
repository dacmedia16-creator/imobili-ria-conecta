import { createFileRoute } from "@tanstack/react-router";
import { sitemapAgencySlugs } from "@/lib/especialistas-publico-dados";
import { SITE_ORIGIN, publicSitemapUrls, sitemapXml } from "@/lib/seo-publico";

// /sitemap.xml (t_e014564f): SÓ as páginas públicas (Hub, /especialistas e, quando houver mais de uma
// imobiliária publicada, a página de cada uma). Nada de tela interna. Em falha do banco sai só o fixo.
// Homologação: mesmos caminhos no endereço da própria homologação (que continua noindex/Disallow).
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const isHomolog = import.meta.env.VITE_HOMOLOG_ONLY === "true";
        const origin = isHomolog ? new URL(request.url).origin : SITE_ORIGIN;
        const slugs = isHomolog ? [] : await sitemapAgencySlugs();
        return new Response(sitemapXml(publicSitemapUrls(slugs, origin)), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
