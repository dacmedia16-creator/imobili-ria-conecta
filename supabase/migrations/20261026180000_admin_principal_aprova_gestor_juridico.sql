-- t_c6638199 (Denis 26/10/2026): o Administrador principal (papel super_admin DA IMOBILIÁRIA) faz
-- sozinho as etapas de GESTOR e de JURÍDICO da venda (imobiliárias sem gestor/jurídico).
-- Aditiva: só CREATE OR REPLACE, acrescentando 'super_admin' onde o papel era exigido.
-- Já liberavam admin/super_admin antes (sem mudança): validate_sale_status_transition, can_edit_sale_stage,
-- can_view_sale, policies de sale_documents (aprovar/devolver documento), insert_sale_document.
-- Isolamento entre imobiliárias inalterado: has_any_role/has_role usam mt_in_ctx_org e as funções
-- continuam presas a current_org_id()/mt_1b_gate(). Financeiro não muda.
-- Rollback: supabase/rollback/20261026180000_admin_principal_aprova_gestor_juridico.sql
BEGIN;
CREATE OR REPLACE FUNCTION public.sale_management_capabilities(_sale_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
   'can_manage', COALESCE(active AND manager AND accessible, false),
   'team_owner', COALESCE(active AND manager AND accessible AND (leader OR auxiliary), false),
   'can_edit', COALESCE(active AND manager AND accessible AND NOT public.is_sale_locked(_sale_id)
     AND (public.can_edit_sale_stage(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id)), false),
   'auxiliary', COALESCE(auxiliary, false)
 ) FROM (
   SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.ativo IS TRUE) active,
     public.has_any_role(auth.uid(), ARRAY['gestor','team_leader','super_admin']::public.app_role[]) manager,
     public.can_view_sale(auth.uid(), _sale_id) OR public.can_manage_sale_as_co_leader(_sale_id) accessible,
     public.is_lead_of_sale_responsavel(auth.uid(), _sale_id) leader,
     public.can_manage_sale_as_co_leader(_sale_id) auxiliary
 ) capabilities;
$function$
;

CREATE OR REPLACE FUNCTION public.can_read_sale_juridico_certidao(_sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
  SELECT COALESCE(public.is_active_user(auth.uid())
    AND public.has_any_role(auth.uid(), ARRAY['juridico','super_admin']::public.app_role[])
    AND EXISTS (
      SELECT 1 FROM public.sales s
      JOIN public.sale_juridico_reached r ON r.sale_id = s.id
      WHERE s.id = _sale_id AND s.modalidade = 'padrao'
        AND s.status::text IN (
          'enviada_revisao','devolvida_ajuste',
          'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
          'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
          'aguardando_assinatura','contrato_assinado','ocorrencia_pendente',
          'ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
        )
    ), false)
  ),false) AND public.mt_1b_gate() AND ((EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')));
$function$
;

CREATE OR REPLACE FUNCTION public.can_upload_contrato_assinado_juridico(_sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(public.is_active_user(auth.uid())
    AND public.has_any_role(auth.uid(), ARRAY['juridico','super_admin']::public.app_role[])
    AND EXISTS (SELECT 1 FROM public.sales s
      WHERE s.id = _sale_id AND s.organization_id = public.current_org_id()
        AND s.status::text = 'aguardando_assinatura')
    AND public.can_view_sale(auth.uid(), _sale_id)
    AND NOT public.is_sale_locked(_sale_id), false);
$function$
;

CREATE OR REPLACE FUNCTION public.corrigir_descricao_matricula(_sale_id uuid, _descricao text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_org uuid; actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
     OR nullif(trim(_descricao), '') IS NULL OR length(_descricao) > 10000 THEN
    RETURN false;
  END IF;
  SELECT organization_id INTO v_org FROM public.sales WHERE id = _sale_id;
  IF v_org IS NULL OR NOT public.can_view_sale(actor, _sale_id) OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id AND r.organization_id = p.organization_id
    WHERE p.id = actor AND p.organization_id = v_org
      AND r.role IN ('juridico'::public.app_role, 'admin'::public.app_role, 'super_admin'::public.app_role)
  ) THEN RETURN false; END IF;
  UPDATE public.sales SET imovel_observacoes = trim(_descricao)
    WHERE id = _sale_id AND imovel_observacoes_origem = 'ia_matricula'
      AND imovel_observacoes IS DISTINCT FROM trim(_descricao);
  RETURN FOUND;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_matricula_descricao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.imovel_observacoes_origem <> 'manual'
       OR NEW.imovel_descricao_corrigida_por IS NOT NULL
       OR NEW.imovel_descricao_corrigida_em IS NOT NULL THEN
      RAISE EXCEPTION 'Origem e auditoria da descrição não podem ser fornecidas na criação';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.imovel_observacoes_origem IS DISTINCT FROM OLD.imovel_observacoes_origem THEN
    IF OLD.imovel_observacoes_origem <> 'manual'
       OR NEW.imovel_observacoes_origem <> 'ia_matricula'
       OR current_setting('app.matricula_descricao', true) IS DISTINCT FROM 'extracao' THEN
      RAISE EXCEPTION 'Origem da descrição não pode ser alterada manualmente';
    END IF;
  END IF;
  IF OLD.imovel_observacoes_origem = 'ia_matricula'
     AND NEW.imovel_observacoes IS DISTINCT FROM OLD.imovel_observacoes THEN
    IF actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.id AND r.organization_id = p.organization_id
      WHERE p.id = actor AND p.organization_id = OLD.organization_id
        AND r.role IN ('juridico'::public.app_role, 'admin'::public.app_role, 'super_admin'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'Somente jurídico ou admin da imobiliária pode corrigir a descrição';
    END IF;
    NEW.imovel_descricao_corrigida_por := actor;
    NEW.imovel_descricao_corrigida_em := now();
  ELSIF NEW.imovel_descricao_corrigida_por IS DISTINCT FROM OLD.imovel_descricao_corrigida_por
     OR NEW.imovel_descricao_corrigida_em IS DISTINCT FROM OLD.imovel_descricao_corrigida_em THEN
    RAISE EXCEPTION 'Registro de correção não pode ser alterado';
  END IF;
  RETURN NEW;
END;
$function$
;
COMMIT;
