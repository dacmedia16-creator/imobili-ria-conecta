import { createFileRoute } from "@tanstack/react-router";
import { guardCrmRoute } from "@/lib/crm-db";
import { CrmPagina } from "@/components/crm/CrmPagina";

// CRM com dois funis (card t_188fb282): só abre com os módulos "crm" e "leads" ligados.
// A RLS de `leads` e as RPCs crm_* são a proteção real (corretor vê só os próprios leads).
export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM" }] }),
  beforeLoad: guardCrmRoute,
  component: CrmPagina,
});
