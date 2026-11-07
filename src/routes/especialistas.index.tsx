import { createFileRoute, redirect } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import {
  EspecialistasDaImobiliaria,
  EspecialistasFaq,
  EspecialistasShell,
  ImobiliariasLista,
} from "@/components/especialistas-diretorio";
import { loadEspecialistasIndex } from "@/lib/especialistas-publico-dados";
import {
  ESPECIALISTAS_FAQ,
  ESPECIALISTAS_URL,
  ROBOTS_INDEX,
  agenciesJsonLd,
  especialistasDescription,
  especialistasHeading,
  especialistasTitle,
  faqJsonLd,
  specialistsItemListJsonLd,
} from "@/lib/seo-publico";

const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";

// /especialistas (endereço oficial: app.somosunihub.com.br/especialistas).
// SSR (t_e014564f): nomes, regiões e imobiliária saem no HTML inicial, para busca e citação.
// Com UMA imobiliária publicada, a própria página mostra os corretores dela (antes o navegador
// pulava para /especialistas/<slug>). Com várias, mostra a lista de imobiliárias.
export const Route = createFileRoute("/especialistas/")({
  beforeLoad: () => {
    if (IS_HOMOLOG) throw redirect({ to: "/auth" });
  },
  loader: () => loadEspecialistasIndex(),
  head: ({ loaderData }) => {
    if (IS_HOMOLOG || !loaderData) {
      return {
        meta: [
          { title: "ADM MAX — Homologação" },
          { name: "description", content: "Ambiente interno de demonstração do ADM MAX." },
        ],
      };
    }
    const agencies =
      loaderData.kind === "single"
        ? [loaderData.page.agency]
        : loaderData.kind === "list"
          ? loaderData.agencies
          : [];
    const title = especialistasTitle(agencies);
    const description = especialistasDescription(agencies);
    const jsonLd =
      loaderData.kind === "single"
        ? specialistsItemListJsonLd(ESPECIALISTAS_URL, especialistasHeading(agencies), [
            { agency: loaderData.page.agency, specialists: loaderData.page.specialists },
          ])
        : loaderData.kind === "list" && agencies.length > 0
          ? agenciesJsonLd(agencies)
          : null;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: ROBOTS_INDEX },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: ESPECIALISTAS_URL },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(jsonLd ? [{ "script:ld+json": jsonLd }] : []),
        { "script:ld+json": faqJsonLd(ESPECIALISTAS_FAQ) },
      ],
      links: [{ rel: "canonical", href: ESPECIALISTAS_URL }],
    };
  },
  component: EspecialistasPage,
});

function EspecialistasPage() {
  const data = Route.useLoaderData();
  const faq = <EspecialistasFaq itens={ESPECIALISTAS_FAQ} />;

  if (data.kind === "single") {
    return (
      <EspecialistasDaImobiliaria
        agency={data.page.agency}
        mostrarOutras={false}
        titulo={especialistasHeading([data.page.agency])}
        regioesIniciais={data.page.regions}
        especialistasIniciais={data.page.specialists}
        rodape={faq}
      />
    );
  }

  const agencies = data.kind === "list" ? data.agencies : [];
  return (
    <EspecialistasShell
      titulo={especialistasHeading(agencies)}
      subtitulo="Escolha a imobiliária para ver os corretores e as regiões em que cada um atua."
    >
      {data.kind === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Não foi possível carregar as imobiliárias agora.
        </div>
      )}
      {data.kind === "list" && agencies.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-3 font-medium text-slate-800">Nenhuma imobiliária disponível</h2>
        </div>
      )}
      {agencies.length > 0 && (
        <>
          <h2 className="mb-6 text-xl font-semibold text-slate-900">Imobiliárias com especialistas</h2>
          <ImobiliariasLista agencies={agencies} />
        </>
      )}
      {faq}
    </EspecialistasShell>
  );
}
