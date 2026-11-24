import { createFileRoute } from "@tanstack/react-router";
import { guardLeadsRoute } from "@/lib/leads-db";
import { LeadsPagina } from "@/components/leads/LeadsPagina";

// Piloto de leads (card t_2472761a). Admin vê a imobiliária; gestor e Team Leader, os próprios + os da equipe (t_b855dbb8).
// A RLS de `leads` é a proteção real: um corretor que abrir esta rota vê só os próprios leads.
export const Route = createFileRoute("/_authenticated/painel-leads")({
  head: () => ({ meta: [{ title: "Painel de leads" }] }),
  beforeLoad: guardLeadsRoute,
  component: () => <LeadsPagina modo="painel" />,
});
