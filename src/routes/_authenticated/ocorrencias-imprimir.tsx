import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { OccurrenceReportBody } from "@/components/vendas/OccurrenceReportBody";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { LANCAMENTO_COMISSAO_PAPEIS } from "@/lib/status";
import type {
  OccurrenceCommissionRow,
  OccurrencePartnerRow,
  OccurrenceRow,
  PartyRow,
  SaleRow,
} from "@/lib/database.types";

const AGENCY_NAME = "IMOBILIÁRIA RE/MAX ÚNICA NEGÓCIOS IMOB. LTDA";
const AGENCY_CRECI = "CRECI: 29.886-J";

type PrintDistribution = {
  saldo_liquido_imobiliaria?: number | null;
  saldo_imobiliaria?: number | null;
};

type PrintOccurrence = {
  sale: SaleRow;
  occ: OccurrenceRow;
  commissions: OccurrenceCommissionRow[];
  partners: OccurrencePartnerRow[];
  parties: Record<string, PartyRow>;
  distribuicao: PrintDistribution | null;
};

export const Route = createFileRoute("/_authenticated/ocorrencias-imprimir")({
  head: () => ({ meta: [{ title: "Imprimir ocorrências" }] }),
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id);
    const roles = (data ?? []).map((row) => row.role);
    if (
      error ||
      !roles.some((role) =>
        [
          "corretor",
          "gestor",
          "team_leader",
          "admin",
          "super_admin",
          "financeiro",
          "juridico",
          "lancamento",
        ].includes(role),
      )
    ) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: OcorrenciasImprimirPage,
});

function OcorrenciasImprimirPage() {
  const { session, loading: authLoading } = useAuth();
  const idsKey = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : (new URLSearchParams(window.location.search).get("ids") ?? ""),
    [],
  );
  const [items, setItems] = useState<PrintOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !session) return;
    const saleIds = [
      ...new Set(
        idsKey
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (saleIds.length === 0) {
      setError("Nenhuma ocorrência foi selecionada.");
      setLoading(false);
      return;
    }
    let ativo = true;
    const carregar = async () => {
      try {
        const [salesResult, occurrencesResult, partiesResult, ...distResults] = await Promise.all([
          supabase.from("sales").select("*").in("id", saleIds),
          supabase.from("occurrences").select("*").in("sale_id", saleIds).eq("status", "concluida"),
          supabase.from("sale_parties").select("*").in("sale_id", saleIds),
          ...saleIds.map((saleId) =>
            supabase.rpc("calcular_distribuicao_venda", { p_sale_id: saleId }),
          ),
        ]);
        const initialResults = [salesResult, occurrencesResult, partiesResult, ...distResults];
        const initialFailed = initialResults.find((result) => result.error);
        if (initialFailed?.error) throw initialFailed.error;

        const occurrenceIds = (occurrencesResult.data ?? []).map((occurrence) => occurrence.id);
        const [commissionsResult, partnersResult] = await Promise.all([
          occurrenceIds.length > 0
            ? supabase
                .from("occurrence_commissions")
                .select("*")
                .in("occurrence_id", occurrenceIds)
                .order("created_at")
            : Promise.resolve({ data: [], error: null }),
          occurrenceIds.length > 0
            ? supabase
                .from("occurrence_partners")
                .select("*")
                .in("occurrence_id", occurrenceIds)
                .order("created_at")
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (commissionsResult.error) throw commissionsResult.error;
        if (partnersResult.error) throw partnersResult.error;

        const salesById = new Map((salesResult.data ?? []).map((sale) => [sale.id, sale]));
        const occurrencesBySale = new Map<string, OccurrenceRow>();
        for (const occurrence of occurrencesResult.data ?? []) {
          occurrencesBySale.set(occurrence.sale_id, occurrence);
        }
        const commissionsByOccurrence = new Map<string, OccurrenceCommissionRow[]>();
        for (const commission of commissionsResult.data ?? []) {
          const current = commissionsByOccurrence.get(commission.occurrence_id) ?? [];
          current.push(commission);
          commissionsByOccurrence.set(commission.occurrence_id, current);
        }
        const partnersByOccurrence = new Map<string, OccurrencePartnerRow[]>();
        for (const partner of partnersResult.data ?? []) {
          const current = partnersByOccurrence.get(partner.occurrence_id) ?? [];
          current.push(partner);
          partnersByOccurrence.set(partner.occurrence_id, current);
        }
        const partiesBySale = new Map<string, Record<string, PartyRow>>();
        for (const party of partiesResult.data ?? []) {
          const current = partiesBySale.get(party.sale_id) ?? {};
          current[party.papel] = party;
          partiesBySale.set(party.sale_id, current);
        }
        const distributionsBySale = new Map(
          saleIds.map((saleId, index) => [
            saleId,
            (distResults[index].data as unknown as PrintDistribution | null) ?? null,
          ]),
        );
        const details: PrintOccurrence[] = [];
        for (const saleId of saleIds) {
          const sale = salesById.get(saleId);
          const occ = occurrencesBySale.get(saleId);
          if (!sale || !occ) continue;
          details.push({
            sale,
            occ,
            commissions: commissionsByOccurrence.get(occ.id) ?? [],
            partners: partnersByOccurrence.get(occ.id) ?? [],
            parties: partiesBySale.get(sale.id) ?? {},
            distribuicao: distributionsBySale.get(sale.id) ?? null,
          });
        }
        if (details.length === 0) throw new Error("Nenhuma ocorrência concluída foi encontrada.");
        if (!ativo) return;
        setItems(details);
        setLoading(false);
      } catch (err) {
        if (!ativo) return;
        setError(err instanceof Error ? err.message : "Não foi possível carregar as ocorrências.");
        setLoading(false);
      }
    };
    void carregar();
    return () => {
      ativo = false;
    };
  }, [authLoading, idsKey, session]);

  useEffect(() => {
    if (loading || error || items.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [error, items.length, loading]);

  if (authLoading || loading)
    return (
      <p className="p-6 text-sm text-muted-foreground print:hidden">Preparando ocorrências...</p>
    );
  if (error)
    return (
      <div className="space-y-3 p-6 print:hidden">
        <p className="font-medium text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.close()}>
          Fechar
        </Button>
      </div>
    );

  return (
    <main className="mx-auto max-w-6xl p-4 print:max-w-none print:p-0">
      {items.map((item, index) => (
        <section
          key={item.occ.id}
          className={index > 0 ? "break-before-page pt-4 print:pt-0" : "pt-4 print:pt-0"}
        >
          <div className="mb-3 flex items-center justify-between border-b pb-2 print:hidden">
            <div>
              <div className="text-sm font-bold">{AGENCY_NAME}</div>
              <div className="text-xs text-muted-foreground">{AGENCY_CRECI}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
          </div>
          <div className="mb-3 hidden border-b pb-2 print:block">
            <div className="text-sm font-bold">{AGENCY_NAME}</div>
            <div className="text-xs text-muted-foreground">{AGENCY_CRECI}</div>
          </div>
          <OccurrenceReportBody
            sale={item.sale}
            occ={item.occ}
            commissions={item.commissions}
            partners={item.partners}
            parties={item.parties}
            distribuicao={item.distribuicao}
            papeis={item.sale.modalidade === "lancamento" ? LANCAMENTO_COMISSAO_PAPEIS : undefined}
          />
        </section>
      ))}
    </main>
  );
}
