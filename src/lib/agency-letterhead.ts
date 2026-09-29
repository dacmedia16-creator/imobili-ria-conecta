import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const LEGACY_ORG_ID = "00000000-0000-4000-8000-000000000001";
const LEGACY_LEGAL_NAME = "IMOBILIÁRIA RE/MAX ÚNICA NEGÓCIOS IMOB. LTDA";
const LEGACY_CRECI = "CRECI: 29.886-J";

export type AgencyLetterhead = { name: string; creci: string | null };

export function letterheadForOrganization(id: string, name: string): AgencyLetterhead {
  if (!name.trim()) throw new Error("A imobiliária não tem nome cadastrado.");
  return id === LEGACY_ORG_ID
    ? { name: LEGACY_LEGAL_NAME, creci: LEGACY_CRECI }
    : { name: name.trim(), creci: null };
}

export async function loadAgencyLetterhead(organizationId: string): Promise<AgencyLetterhead> {
  if (!organizationId) throw new Error("Imobiliária da venda não identificada.");
  const { data, error } = await supabase
    .from("organizations")
    .select("nome")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) throw new Error("Não foi possível identificar a imobiliária da venda.");
  return letterheadForOrganization(organizationId, data.nome);
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
