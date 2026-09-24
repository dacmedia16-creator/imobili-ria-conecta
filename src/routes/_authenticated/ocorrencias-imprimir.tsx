import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { OccurrenceReportBody } from "@/components/vendas/OccurrenceReportBody";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { podeImprimirOcorrenciasConcluidas } from "@/lib/ocorrencias-concluidas";
import { LANCAMENTO_COMISSAO_PAPEIS } from "@/lib/status";
import { z } from "zod";
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

const printDocumentsSchema = z.array(
  z.object({
    sale: z.object({ id: z.string(), modalidade: z.string().nullable().optional() }).passthrough(),
    occ: z
      .object({ id: z.string(), sale_id: z.string(), status: z.literal("concluida") })
      .passthrough(),
    parties: z.array(z.object({ sale_id: z.string(), papel: z.string() }).passthrough()),
    commissions: z.array(z.object({ occurrence_id: z.string() }).passthrough()),
    partners: z.array(z.object({ occurrence_id: z.string() }).passthrough()),
    distribuicao: z.object({}).passthrough().nullable(),
  }),
);

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
    if (error || !podeImprimirOcorrenciasConcluidas(roles)) {
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
        if (saleIds.length > 50)
          throw new Error("Selecione no máximo 50 ocorrências por impressão.");
        const { data, error: rpcError } = await supabase.rpc("imprimir_ocorrencias_concluidas", {
          p_sale_ids: saleIds,
        });
        if (rpcError) throw rpcError;
        const parsed = printDocumentsSchema.safeParse(data);
        if (
          !parsed.success ||
          parsed.data.length !== saleIds.length ||
          parsed.data.some(
            (doc, index) =>
              doc.sale.id !== saleIds[index] ||
              doc.occ.sale_id !== saleIds[index] ||
              doc.parties.some((party) => party.sale_id !== saleIds[index]) ||
              doc.commissions.some((commission) => commission.occurrence_id !== doc.occ.id) ||
              doc.partners.some((partner) => partner.occurrence_id !== doc.occ.id),
          )
        ) {
          throw new Error("O documento retornou dados incompletos ou inconsistentes.");
        }
        const details: PrintOccurrence[] = parsed.data.map((doc) => ({
          sale: doc.sale as unknown as SaleRow,
          occ: doc.occ as unknown as OccurrenceRow,
          commissions: doc.commissions as unknown as OccurrenceCommissionRow[],
          partners: doc.partners as unknown as OccurrencePartnerRow[],
          parties: Object.fromEntries(doc.parties.map((party) => [party.papel, party])) as Record<
            string,
            PartyRow
          >,
          distribuicao: doc.distribuicao as PrintDistribution | null,
        }));
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
