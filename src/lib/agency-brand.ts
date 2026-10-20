// Marca da imobiliária do usuário logado (nome + logo) para mensagens e PDFs (t_475d2778).
// A imobiliária vem do JWT no banco (current_org_id), nunca de um seletor do navegador.
import { supabase } from "@/integrations/supabase/client";
import { fixedPdfLogoForOrganization } from "@/lib/agency-letterhead";

export type AgencyBrandInfo = { id: string; nome: string; pdfLogoUrl: string | null };

export async function loadCurrentAgencyBrand(): Promise<AgencyBrandInfo | null> {
  const { data: orgId, error } = await supabase.rpc("current_org_id");
  if (error || !orgId) return null;
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("nome, logo_path")
    .eq("id", orgId)
    .maybeSingle();
  if (orgError || !org) return null;
  return {
    id: orgId,
    nome: org.nome,
    pdfLogoUrl: org.logo_path
      ? supabase.storage.from("organization-logos").getPublicUrl(org.logo_path).data.publicUrl
      : fixedPdfLogoForOrganization(orgId),
  };
}

/** Baixa o logo para o PDF. PNG e JPG seguem como estão; WEBP é convertido para PNG no navegador. */
export async function logoForPdf(url: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (isPng || isJpg) return bytes;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    return png ? new Uint8Array(await png.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
