import { createFileRoute } from "@tanstack/react-router";
import { guardLeadsRoute } from "@/lib/leads-db";
import { LeadsPagina } from "@/components/leads/LeadsPagina";

// Piloto de leads (card t_2472761a): só aparece com o módulo "leads" ligado na imobiliária.
export const Route = createFileRoute("/_authenticated/meus-leads")({
  head: () => ({ meta: [{ title: "Meus leads" }] }),
  beforeLoad: guardLeadsRoute,
  component: () => <LeadsPagina modo="meus" />,
});
