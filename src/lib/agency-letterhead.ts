import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

const db = supabase as unknown as SupabaseClient;

const LEGACY_ORG_ID = "00000000-0000-4000-8000-000000000001";

// Logo histórica preservada enquanto a agência não cadastrar logo próprio.
export function fixedLogoForOrganization(id: string): string | null {
  return id === LEGACY_ORG_ID ? "/remax-icon.png" : null;
}

export type AgencyLetterhead = { name: string; creci: string | null };

export function letterheadForOrganization(
  name: string,
  legalName: string | null,
  creci: string | null,
): AgencyLetterhead {
  const title = legalName?.trim() || name.trim();
  if (!title) throw new Error("A imobiliária não tem nome cadastrado.");
  return { name: title, creci: creci?.trim() || null };
}

export async function loadAgencyLetterhead(organizationId: string): Promise<AgencyLetterhead> {
  if (!organizationId) throw new Error("Imobiliária da venda não identificada.");
  const { data, error } = await db
    .from("organizations")
    .select("nome, razao_social, creci")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) throw new Error("Não foi possível identificar a imobiliária da venda.");
  return letterheadForOrganization(data.nome, data.razao_social, data.creci);
}

export function useAgencyLetterhead(organizationId: string) {
  const [result, setResult] = useState<{
    id: string;
    letterhead: AgencyLetterhead | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    loadAgencyLetterhead(organizationId)
      .then((letterhead) => {
        if (active) setResult({ id: organizationId, letterhead, error: null });
      })
      .catch(() => {
        if (active)
          setResult({
            id: organizationId,
            letterhead: null,
            error: "Imobiliária não identificada; impressão indisponível.",
          });
      });
    return () => {
      active = false;
    };
  }, [organizationId]);
  return result?.id === organizationId ? result : null;
}
