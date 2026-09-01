export type PositioningRegion = {
  id: number;
  cidade: string;
  zona: string | null;
  nome: string;
  tipo: string;
  corretores?: number;
};

export type PublicSpecialistRegion = Omit<PositioningRegion, "corretores">;

export type PublicSpecialist = {
  id: string;
  nome: string;
  avatar_url: string | null;
  telefone: string | null;
  pagina_pessoal_url: string | null;
  instagram_url: string | null;
  regioes: PublicSpecialistRegion[];
};

export const MAX_POSITIONING_REGIONS = 2;

export function addPositioningRegion(current: number[], id: number): { ids: number[]; limitReached: boolean } {
  if (current.includes(id)) return { ids: current, limitReached: false };
  if (current.length >= MAX_POSITIONING_REGIONS) return { ids: current, limitReached: true };
  return { ids: [...current, id], limitReached: false };
}

export function normalizeExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeInstagramUrl(value: string): string | null {
  const trimmed = value.trim().replace(/^@/, "");
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9._]{1,30}$/.test(trimmed)) return `https://www.instagram.com/${trimmed}/`;
  const normalized = normalizeExternalUrl(trimmed);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (!["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function whatsappDigits(telefone: string | null): string {
  if (!telefone) return "";
  const digits = telefone.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export function whatsappSpecialistUrl(especialista: PublicSpecialist, regiao?: string): string {
  const phone = whatsappDigits(especialista.telefone);
  const origem = regiao?.trim() ? ` da região de ${regiao.trim()}` : "";
  const message = `Olá, ${especialista.nome}! Encontrei seu perfil na página de especialistas${origem} e gostaria de conversar.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function parseSpecialistRegions(value: unknown): PublicSpecialistRegion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PublicSpecialistRegion => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return typeof row.id === "number" && typeof row.nome === "string" && typeof row.cidade === "string";
  });
}

export function groupRegions(regions: PositioningRegion[]): { label: string; items: PositioningRegion[] }[] {
  const groups = new Map<string, PositioningRegion[]>();
  for (const region of regions) {
    const label = region.zona ? `${region.cidade} — ${region.zona}` : region.cidade;
    groups.set(label, [...(groups.get(label) ?? []), region]);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}
