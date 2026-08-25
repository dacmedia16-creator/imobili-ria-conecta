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
  telefone: string;
  regioes: PublicSpecialistRegion[];
};

export function whatsappDigits(telefone: string): string {
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
