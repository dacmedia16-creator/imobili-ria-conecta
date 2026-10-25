import { createFileRoute } from "@tanstack/react-router";
import { guardLeadsRoute } from "@/lib/leads-db";
import { LeadsPagina } from "@/components/leads/LeadsPagina";

// Piloto de leads (card t_2472761a). Gestor/admin vê a imobiliária; Team Leader, a própria equipe.
// A RLS de `leads` é a proteção real: um corretor que abrir esta rota vê só os próprios leads.
export const Route = createFileRoute("/_authenticated/painel-leads")({
  head: () => ({ meta: [{ title: "Painel de leads" }] }),
  beforeLoad: guardLeadsRoute,
  component: () => <LeadsPagina modo="painel" />,
});
