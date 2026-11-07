/**
 * SEO/GEO das páginas públicas (Hub "/" e "/especialistas"), card t_e014564f (Denis, 07/11/2026).
 *
 * Regras:
 * - Só "/", "/especialistas" e "/especialistas/<slug>" entram no índice; o resto do app fica com
 *   noindex (meta no __root) e fora do robots (lista do que é permitido + "Disallow: /").
 * - Robôs de busca e de citação por IA liberados; robôs de TREINO bloqueados.
 * - JSON-LD só com dados que já aparecem na página: nome, regiões e imobiliária (cidade/UF).
 *   Nunca telefone, e-mail ou CPF.
 * - Homologação: tudo bloqueado (noindex + "Disallow: /").
 */
import { APP_ORIGIN } from "@/lib/dominios";

export const SITE_ORIGIN = APP_ORIGIN;
export const HUB_URL = `${SITE_ORIGIN}/`;
export const ESPECIALISTAS_URL = `${SITE_ORIGIN}/especialistas`;

export function especialistasAgencyUrl(slug: string): string {
  return `${ESPECIALISTAS_URL}/${encodeURIComponent(slug)}`;
}

export const HUB_TITLE = "UniHub — Todos os sistemas MAX em um só lugar";
export const HUB_DESCRIPTION =
  "UniHub reúne os sistemas MAX para imobiliárias e corretores: gestão administrativa, estudo de mercado, visitas, treinamento e a página pública para achar um corretor especialista por região.";

/** Meta "robots" das páginas públicas em produção (o __root põe noindex no resto). */
export const ROBOTS_INDEX = "index, follow, max-image-preview:large";

// ---------------------------------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------------------------------

/** Robôs de busca e de citação (respondem perguntas citando a fonte): liberados nas páginas públicas. */
export const SEARCH_BOTS = [
  "Googlebot",
  "Bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
] as const;

/** Robôs de coleta para TREINO de IA: bloqueados no site inteiro. */
export const TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "FacebookBot",
  "Amazonbot",
  "cohere-ai",
  "cohere-training-data-crawler",
  "Diffbot",
  "omgili",
  "AI2Bot",
  "Timpibot",
  "ImagesiftBot",
] as const;

/** O que os robôs de busca podem ler. Todo o resto (telas internas, login, API) fica bloqueado. */
export const ROBOTS_ALLOW = [
  "/$",
  "/especialistas",
  "/assets/",
  "/fonts/",
  "/hub/",
  "/remax-logo-white.png",
  "/og-image.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/sitemap.xml",
] as const;

export function robotsTxt(isHomolog: boolean): string {
  if (isHomolog) {
    return ["# ADM MAX — homologação: nada aqui deve ser indexado.", "User-agent: *", "Disallow: /", ""].join(
      "\n",
    );
  }
  const lines: string[] = [
    "# UniHub — app.somosunihub.com.br",
    "# Páginas públicas: Hub (/) e Ache um especialista (/especialistas). O resto é área interna.",
    "",
    "# Coleta para treino de IA: não autorizada.",
    ...TRAINING_BOTS.map((bot) => `User-agent: ${bot}`),
    "Disallow: /",
    "",
    "# Busca e citação (inclusive respostas de IA com link para a fonte): só páginas públicas.",
    ...SEARCH_BOTS.map((bot) => `User-agent: ${bot}`),
    "User-agent: *",
    "Content-Signal: search=yes, ai-input=yes, ai-train=no",
    ...ROBOTS_ALLOW.map((path) => `Allow: ${path}`),
    "Disallow: /",
    "",
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------
// sitemap.xml
// ---------------------------------------------------------------------------------------------------

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function sitemapXml(urls: readonly string[]): string {
  const unique = [...new Set(urls)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...unique.map((loc) => `  <url><loc>${xmlEscape(loc)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
}

/** URLs públicas: Hub, lista de especialistas e a página de cada imobiliária publicada. */
export function publicSitemapUrls(agencySlugs: readonly string[], origin: string = SITE_ORIGIN): string[] {
  const base = origin.replace(/\/+$/, "");
  return [
    `${base}/`,
    `${base}/especialistas`,
    ...agencySlugs.map((slug) => `${base}/especialistas/${encodeURIComponent(slug)}`),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Textos e JSON-LD
// ---------------------------------------------------------------------------------------------------

export type SeoAgency = { slug: string; nome: string; cidade: string | null; uf: string | null };
export type SeoRegion = { nome: string; cidade: string };
export type SeoSpecialist = { nome: string; regioes: readonly SeoRegion[] };

/** "em Sorocaba e região" quando todas as imobiliárias são da mesma cidade; senão "por região". */
export function cidadeDasImobiliarias(agencies: readonly Pick<SeoAgency, "cidade">[]): string | null {
  const cidades = [...new Set(agencies.map((a) => a.cidade?.trim()).filter((c): c is string => !!c))];
  return cidades.length === 1 ? cidades[0] : null;
}

export function especialistasHeading(agencies: readonly Pick<SeoAgency, "cidade">[]): string {
  const cidade = cidadeDasImobiliarias(agencies);
  return cidade ? `Especialistas em imóveis em ${cidade} e região` : "Especialistas em imóveis por região";
}

export function especialistasTitle(agencies: readonly Pick<SeoAgency, "cidade">[]): string {
  const cidade = cidadeDasImobiliarias(agencies);
  return cidade
    ? `Corretores especialistas em imóveis em ${cidade} e região | UniHub`
    : "Corretores especialistas em imóveis por região | UniHub";
}

export function especialistasDescription(agencies: readonly Pick<SeoAgency, "cidade">[]): string {
  const cidade = cidadeDasImobiliarias(agencies);
  const onde = cidade ? ` em ${cidade} e região` : "";
  return `Encontre o corretor especialista no seu bairro, condomínio ou cidade${onde}. Veja as regiões em que cada corretor atua e fale direto com ele.`;
}

export function agencyTitle(agency: SeoAgency): string {
  const onde = agency.cidade ? ` em ${agency.cidade}` : "";
  return `Especialistas em imóveis da ${agency.nome}${onde} | UniHub`;
}

export function agencyDescription(agency: SeoAgency): string {
  const onde = agency.cidade ? ` em ${agency.cidade}` : "";
  return `Corretores da ${agency.nome}${onde} por bairro, condomínio e cidade. Busque pela região e fale com quem conhece o lugar.`;
}

export function regionLabel(region: SeoRegion): string {
  return region.cidade && region.cidade !== region.nome ? `${region.nome}, ${region.cidade}` : region.nome;
}

function agencyNode(agency: SeoAgency) {
  return {
    "@type": "RealEstateAgent",
    name: agency.nome,
    url: especialistasAgencyUrl(agency.slug),
    ...(agency.cidade || agency.uf
      ? {
          address: {
            "@type": "PostalAddress",
            ...(agency.cidade ? { addressLocality: agency.cidade } : {}),
            ...(agency.uf ? { addressRegion: agency.uf.toUpperCase() } : {}),
            addressCountry: "BR",
          },
        }
      : {}),
  };
}

/** Pessoa da lista: SÓ nome, regiões e imobiliária (nada de telefone, e-mail, CPF ou foto). */
function personNode(specialist: SeoSpecialist, agency: SeoAgency) {
  return {
    "@type": "Person",
    name: specialist.nome,
    jobTitle: "Corretor de imóveis",
    worksFor: agencyNode(agency),
    ...(specialist.regioes.length
      ? {
          workLocation: specialist.regioes.map((region) => ({
            "@type": "Place",
            name: regionLabel(region),
            address: { "@type": "PostalAddress", addressLocality: region.cidade, addressCountry: "BR" },
          })),
        }
      : {}),
  };
}

export function hubJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_ORIGIN}/#organization`,
        name: "UniHub",
        url: HUB_URL,
        description: HUB_DESCRIPTION,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        name: "UniHub",
        url: HUB_URL,
        inLanguage: "pt-BR",
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
      },
    ],
  };
}

export function specialistsItemListJsonLd(
  pageUrl: string,
  name: string,
  groups: readonly { agency: SeoAgency; specialists: readonly SeoSpecialist[] }[],
) {
  const items = groups.flatMap(({ agency, specialists }) =>
    specialists.map((specialist) => personNode(specialist, agency)),
  );
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${pageUrl}#especialistas`,
    name,
    url: pageUrl,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, item })),
  };
}

export function agenciesJsonLd(agencies: readonly SeoAgency[]) {
  return {
    "@context": "https://schema.org",
    "@graph": agencies.map(agencyNode),
  };
}

/** FAQ da página de especialistas. Texto para revisão de Denis antes de publicar (t_e014564f). */
export const ESPECIALISTAS_FAQ: readonly { pergunta: string; resposta: string }[] = [
  {
    pergunta: "Como encontro um corretor especialista na minha região?",
    resposta:
      "Abra a página da imobiliária e busque pelo nome do bairro, do condomínio, da cidade ou do corretor, ou use o filtro de região. Cada cartão mostra as regiões em que o corretor atua.",
  },
  {
    pergunta: "Quem aparece nesta página?",
    resposta:
      "Corretores ativos das imobiliárias que publicaram a página Ache um especialista. Cada corretor informa no próprio cadastro as regiões em que atua.",
  },
  {
    pergunta: "Como falo com o especialista?",
    resposta:
      "Na página da imobiliária, o botão Falar pelo WhatsApp abre a conversa direto com o corretor, quando ele cadastrou o telefone. Alguns corretores também mostram Instagram ou página pessoal.",
  },
  {
    pergunta: "A lista de especialistas é atualizada?",
    resposta:
      "Sim. A lista vem direto do cadastro das imobiliárias: quando um corretor muda as regiões ou deixa de estar ativo, a página muda junto.",
  },
];

export function faqJsonLd(faq: readonly { pergunta: string; resposta: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ pergunta, resposta }) => ({
      "@type": "Question",
      name: pergunta,
      acceptedAnswer: { "@type": "Answer", text: resposta },
    })),
  };
}
