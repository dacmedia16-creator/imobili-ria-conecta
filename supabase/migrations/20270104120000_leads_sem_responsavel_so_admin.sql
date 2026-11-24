-- t_b904eca2 (Denis 24/11, "só adm vê"): lead SEM responsável fica visível só para admin/super_admin.
-- Gestor e Team Leader deixam de ver (e, por consequência, de abrir/atribuir/mexer em) lead com
-- responsavel_id NULL; continuam vendo os próprios + os da equipe (t_b855dbb8). Corretor: só os próprios.
-- Uma única regra muda: leads_ve_responsavel (usada por lead_pega → lead_atribuir, lead_mudar_etapa,
-- crm_*, lead_ia_parar; lead_contatos; lead_ia_pode_ver → policy de lead_conversas; proposta_criar)
-- + a policy leads_read, que repetia a mesma condição.
-- Fora desta mudança (regra própria, mantida): o banco "Leads da imobiliária" (lead_banco_listar/lead_pegar),
-- aberto a quem atende leads, sem telefone/e-mail.
-- Rollback: docs/sql/rollback/20270104120000_leads_sem_responsavel_so_admin.rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.leads_ve_responsavel(_resp uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  -- Admin: todos (inclusive sem responsável). Demais: o próprio e os da equipe que lidera.
  -- coalesce: sem responsável dá NULL no IN e NÃO pode passar para gestor/TL/corretor.
  SELECT auth.uid() IS NOT NULL AND coalesce(
    public.leads_admin()
    OR _resp IN (SELECT public.leads_responsaveis_visiveis()), false)
$$;
REVOKE ALL ON FUNCTION public.leads_ve_responsavel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leads_ve_responsavel(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS leads_read ON public.leads;
CREATE POLICY leads_read ON public.leads FOR SELECT TO authenticated
  USING ((SELECT public.leads_admin())
         OR responsavel_id IN (SELECT public.leads_responsaveis_visiveis()));

COMMIT;
