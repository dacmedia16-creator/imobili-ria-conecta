import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EspecialistasDaImobiliaria,
  EspecialistasShell,
} from "@/components/especialistas-diretorio";
import { isValidAgencySlug } from "@/lib/especialistas-publico";
import { loadEspecialistasAgency } from "@/lib/especialistas-publico-dados";
import {
  ESPECIALISTAS_URL,
  ROBOTS_INDEX,
  agencyDescription,
  agencyTitle,
  especialistasAgencyUrl,
  specialistsItemListJsonLd,
} from "@/lib/seo-publico";

const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";

// /especialistas/<slug>: busca + filtro de região só dos corretores dessa imobiliária.
// Imobiliária desligada, sem especialista ou inexistente: "não encontrada" (o banco também devolve vazio).
// SSR (t_e014564f). Com UMA imobiliária publicada, o canonical aponta para /especialistas (mesmo conteúdo).
export const Route = createFileRoute("/especialistas/$slug")({
  beforeLoad: () => {
    if (IS_HOMOLOG) throw redirect({ to: "/auth" });
  },
  loader: ({ params }) => loadEspecialistasAgency(params.slug, isValidAgencySlug(params.slug)),
  head: ({ loaderData }) => {
    if (IS_HOMOLOG || !loaderData) {
      return {
        meta: [
          { title: "ADM MAX — Homologação" },
          { name: "description", content: "Ambiente interno de demonstração do ADM MAX." },
        ],
      };
    }
    if (loaderData.kind !== "ok") {
      return {
        meta: [
          { title: "Imobiliária não encontrada | UniHub" },
          { name: "robots", content: "noindex, follow" },
        ],
      };
    }
    const { agency, specialists } = loaderData.page;
    const canonical = loaderData.total > 1 ? especialistasAgencyUrl(agency.slug) : ESPECIALISTAS_URL;
    const title = agencyTitle(agency);
    const description = agencyDescription(agency);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: ROBOTS_INDEX },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonical },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        {
          "script:ld+json": specialistsItemListJsonLd(
            canonical,
            `Especialistas em imóveis — ${agency.nome}`,
            [{ agency, specialists }],
          ),
        },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: AgencySpecialistsPage,
});

function AgencySpecialistsPage() {
  const data = Route.useLoaderData();

  if (data.kind === "ok")
    return (
      <EspecialistasDaImobiliaria
        key={data.page.agency.slug}
        agency={data.page.agency}
        mostrarOutras={data.total > 1}
        regioesIniciais={data.page.regions}
        especialistasIniciais={data.page.specialists}
      />
    );

  return (
    <EspecialistasShell
      titulo="Encontre um especialista"
      subtitulo="Busque corretores por bairro, condomínio ou cidade."
    >
      {data.kind === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Não foi possível carregar os especialistas agora.
        </div>
      )}
      {data.kind === "missing" && (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-3 font-medium text-slate-800">Imobiliária não encontrada</h2>
          <p className="mt-1 text-sm text-slate-500">
            Esta página não está disponível. Veja as imobiliárias com especialistas publicados.
          </p>
          <Button className="mt-5" asChild>
            <Link to="/especialistas">Ver imobiliárias</Link>
          </Button>
        </div>
      )}
    </EspecialistasShell>
  );
}
