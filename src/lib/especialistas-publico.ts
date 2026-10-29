/** Regras puras da página pública "Ache um especialista" (t_6d8de1d7). */

export type AgencyLike = { slug: string; cidade: string | null; uf: string | null };

/** Lista com exatamente 1 imobiliária publicada vai direto para a página dela. */
export function directAgencySlug(agencies: AgencyLike[]): string | null {
  return agencies.length === 1 ? agencies[0].slug : null;
}

export function agencyLocationLabel(agency: Pick<AgencyLike, "cidade" | "uf">): string {
  const cidade = agency.cidade?.trim() ?? "";
  const uf = agency.uf?.trim().toUpperCase() ?? "";
  if (cidade && uf) return `${cidade} — ${uf}`;
  return cidade || uf;
}

export function specialistsCountLabel(n: number): string {
  return `${n} ${n === 1 ? "especialista" : "especialistas"}`;
}

/** Slug aceito na URL pública (o mesmo formato do identificador da imobiliária). */
export function isValidAgencySlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80;
}

/** Nome de região normalizado como no banco (regiao_norm): sem acento, minúsculo, espaços simples. */
export function regionNorm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export const REGION_STATUS_LABEL = {
  ativa: "Ativa",
  pendente: "Aguardando sua decisão",
  recusada: "Recusada",
  juntada: "Juntada a outra",
} as const;
