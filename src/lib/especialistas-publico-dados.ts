/**
 * Dados das páginas públicas de especialistas carregados no servidor (SSR), card t_e014564f.
 * Usa só as RPCs públicas que a página já usava no navegador (mesmos campos, nada novo exposto).
 * Nunca lança erro: devolve { kind: "error" } para a página mostrar o aviso sem derrubar o SSR
 * (o deploy:safe confere /especialistas com curl --fail; um 500 aqui reverteria o deploy).
 */
import {
  listPublicAgencies,
  listPublicOrgRegions,
  listPublicOrgSpecialists,
  type PublicAgency,
} from "@/lib/positioning-db";
import type { PositioningRegion, PublicSpecialist } from "@/lib/positioning";

// shortcut: tempo fixo de 6 s por leitura; se o Supabase demorar mais, a página sai com o aviso.
const TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type AgencyPageData = {
  agency: PublicAgency;
  regions: PositioningRegion[];
  specialists: PublicSpecialist[];
};

async function loadAgencyPage(agency: PublicAgency): Promise<AgencyPageData> {
  const [regions, specialists] = await Promise.all([
    withTimeout(listPublicOrgRegions(agency.slug)),
    withTimeout(listPublicOrgSpecialists(agency.slug, "", null)),
  ]);
  return { agency, regions, specialists };
}

/**
 * /especialistas: com UMA imobiliária publicada, a própria página mostra os corretores dela
 * (antes o navegador pulava para /especialistas/<slug>; agora o endereço oficial já tem o conteúdo).
 */
export type EspecialistasIndexData =
  | { kind: "single"; page: AgencyPageData }
  | { kind: "list"; agencies: PublicAgency[] }
  | { kind: "error" };

export async function loadEspecialistasIndex(): Promise<EspecialistasIndexData> {
  try {
    const agencies = await withTimeout(listPublicAgencies());
    if (agencies.length === 1) return { kind: "single", page: await loadAgencyPage(agencies[0]) };
    return { kind: "list", agencies };
  } catch {
    return { kind: "error" };
  }
}

export type EspecialistasAgencyData =
  | { kind: "ok"; page: AgencyPageData; total: number }
  | { kind: "missing"; total: number }
  | { kind: "error" };

export async function loadEspecialistasAgency(
  slug: string,
  isValidSlug: boolean,
): Promise<EspecialistasAgencyData> {
  if (!isValidSlug) return { kind: "missing", total: 0 };
  try {
    const agencies = await withTimeout(listPublicAgencies());
    const agency = agencies.find((row) => row.slug === slug);
    if (!agency) return { kind: "missing", total: agencies.length };
    return { kind: "ok", page: await loadAgencyPage(agency), total: agencies.length };
  } catch {
    return { kind: "error" };
  }
}

/** Slugs que entram no sitemap: com uma imobiliária só, a página dela é a própria /especialistas. */
export async function sitemapAgencySlugs(): Promise<string[]> {
  try {
    const agencies = await withTimeout(listPublicAgencies());
    return agencies.length > 1 ? agencies.map((a) => a.slug) : [];
  } catch {
    return [];
  }
}
