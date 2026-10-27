-- ROLLBACK de 20261027210000_admin_todos_botoes_venda (t_3c10bab8): definições de produção lidas em 27/10/2026
-- (main 06d6d83). Sem perda de dados: vendas já canceladas pelo administrador continuam canceladas.
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

CREATE OR REPLACE FUNCTION public.validate_sale_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := auth.uid();
  is_owner boolean := public.is_sale_responsavel(auth.uid(), old.id);
  allowed boolean := false;
  from_status text := old.status::text;
  to_status text := new.status::text;
begin
  if new.status is not distinct from old.status then return new; end if;

  -- 18/10/2026 (t_70734b3a): Clicksign na venda. Só o servidor (sem usuário logado), dentro de
  -- clicksign_sale_set_status (marca local clicksign.sale = id da venda), e só nestas transições.
  if actor is null
     and current_setting('clicksign.sale', true) = old.id::text
     and (from_status, to_status) in (
       ('contrato_ok_corretor', 'aguardando_assinatura'),
       ('aguardando_assinatura', 'contrato_ok_corretor'),
       -- atalho do gestor (o gestor já tem conferencia_gestor → aguardando no fluxo manual)
       ('contrato_conferencia_gestor', 'aguardando_assinatura'),
       ('aguardando_assinatura', 'contrato_conferencia_gestor'),
       ('aguardando_assinatura', 'contrato_assinado'),
       ('contrato_assinado', 'ocorrencia_pendente')
     ) then
    if to_status = 'contrato_assinado'
       and not exists (select 1 from public.sale_documents d where d.sale_id = old.id and d.tipo = 'contrato_assinado') then
      raise exception 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Fase 2f: cancelar venda = só o dono da plataforma, via platform_cancel_sale, depois do rascunho.
  if to_status = 'cancelada' then
    if from_status = 'rascunho' then
      raise exception 'Venda em rascunho não é cancelada: use Excluir venda.' using errcode = '42501';
    end if;
    if actor is not null
       and public.is_platform_super_admin(actor)
       and current_setting('mt.platform_cancel_sale', true) = old.id::text then
      return new;
    end if;
    raise exception 'Somente o dono da plataforma cancela venda.' using errcode = '42501';
  end if;

  if public.has_any_role(actor, array['admin','super_admin']::app_role[]) then return new; end if;

  -- 09/10/2026 (Denis, tópico 6238): desarquivar. Além de admin/super_admin (já retornaram acima),
  -- quem criou a venda (sales.corretor_id) e o gestor/team leader que lidera o criador ou um
  -- responsável podem tirar a venda de 'arquivada', mas SOMENTE de volta para a etapa em que ela
  -- estava quando foi arquivada (último registro do histórico). Motivo obrigatório na tela.
  if from_status = 'arquivada' then
    if actor is not null
       and to_status = (
         select h.de::text from public.sale_status_history h
         where h.sale_id = old.id and h.para = 'arquivada'
         order by h.created_at desc limit 1
       )
       and public.can_view_sale(actor, old.id)
       and (
         old.corretor_id = actor
         or (public.has_any_role(actor, array['gestor','team_leader']::app_role[])
             and (public.is_lead_of(actor, old.corretor_id)
                  or public.is_lead_of_sale_responsavel(actor, old.id)))
       ) then
      return new;
    end if;
    raise exception 'Desarquivar: só quem criou a venda, o gestor/team leader dela ou o admin, e apenas de volta para a etapa anterior ao arquivamento.' using errcode = '42501';
  end if;

  -- Reunião de gestores 08/10/2026: arquivar é liberado a quem já vê/opera a venda (mesmo gate de
  -- change_sale_status), inclusive o corretor, em qualquer etapa ANTES da assinatura do contrato.
  -- Do contrato assinado em diante ninguém arquiva (admin/super_admin já retornaram acima).
  if to_status = 'arquivada' then
    if from_status in (
         'rascunho', 'enviada_revisao', 'devolvida_ajuste', 'aprovada_gestor', 'enviada_juridico',
         'em_elaboracao_contrato', 'contrato_conferencia_gestor', 'contrato_conferencia_corretor',
         'contrato_ok_corretor', 'aguardando_assinatura'
       )
       and actor is not null
       and (public.can_view_sale(actor, old.id) or public.can_edit_sale_as_co_leader(old.id)) then
      return new;
    end if;
    raise exception 'Arquivar só é permitido antes da assinatura do contrato.' using errcode = '42501';
  end if;

  -- Denis 09/10/2026: quem cadastrou a venda (corretor_id) também envia para revisão.
  if old.corretor_id = actor and actor is not null and (from_status, to_status) in (
    ('rascunho', 'enviada_revisao'), ('devolvida_ajuste', 'enviada_revisao')
  ) then allowed := true; end if;

  if is_owner and (from_status, to_status) in (
    ('rascunho', 'enviada_revisao'), ('devolvida_ajuste', 'enviada_revisao'),
    ('contrato_conferencia_corretor', 'contrato_ok_corretor'),
    ('contrato_conferencia_corretor', 'contrato_conferencia_gestor')
  ) then allowed := true; end if;

  if not allowed and is_owner and public.has_any_role(actor, array['gestor','team_leader']::app_role[]) and (from_status, to_status) in (
    ('rascunho', 'aprovada_gestor'), ('devolvida_ajuste', 'aprovada_gestor')
  ) then allowed := true; end if;

  if not allowed
     and from_status = 'rascunho'
     and to_status = 'aprovada_gestor'
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and public.is_lead_of_sale_responsavel(actor, old.id) then
    allowed := true;
  end if;

  if not allowed and is_owner and public.has_role(actor, 'lancamento'::app_role) and (from_status, to_status) in (
    ('rascunho', 'ocorrencia_analise_financeiro'),
    ('devolvida_ajuste', 'ocorrencia_analise_financeiro')
  ) then allowed := true; end if;

  if not allowed and public.has_any_role(actor, array['gestor','team_leader']::app_role[]) and (from_status, to_status) in (
    ('enviada_revisao', 'aprovada_gestor'), ('enviada_revisao', 'devolvida_ajuste'),
    ('contrato_conferencia_gestor', 'contrato_conferencia_corretor'),
    ('contrato_conferencia_gestor', 'aguardando_assinatura'),
    ('contrato_conferencia_gestor', 'em_elaboracao_contrato'),
    ('contrato_ok_corretor', 'aguardando_assinatura'),
    ('contrato_ok_corretor', 'contrato_conferencia_corretor'),
    ('contrato_ok_corretor', 'em_elaboracao_contrato'),
    ('aguardando_assinatura', 'contrato_assinado'),
    ('aguardando_assinatura', 'em_elaboracao_contrato'),
    ('contrato_assinado', 'ocorrencia_pendente'), ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'aguardando_assinatura'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida')
  ) then allowed := true; end if;

  if not allowed and public.has_role(actor, 'juridico') and (from_status, to_status) in (
    ('aprovada_gestor', 'em_elaboracao_contrato'), ('aprovada_gestor', 'enviada_revisao'),
    ('aprovada_gestor', 'devolvida_ajuste'),
    ('em_elaboracao_contrato', 'contrato_conferencia_gestor'),
    ('em_elaboracao_contrato', 'enviada_revisao'), ('em_elaboracao_contrato', 'devolvida_ajuste')
  ) then allowed := true; end if;

  -- 19/10/2026 (Denis, t_e6f778ac): assinatura manual (papel). O jurídico também escolhe o papel em
  -- contrato_ok_corretor. Ele NÃO marca o contrato assinado (correção de Denis 19/10, t_6efe0960):
  -- só sobe o arquivo (policies abaixo); marcar segue com gestor/team leader e ADM, como antes.
  -- A organização e a visibilidade continuam sendo conferidas em change_sale_status (can_view_sale).
  if not allowed and public.has_role(actor, 'juridico') and (from_status, to_status) in (
    ('contrato_ok_corretor', 'aguardando_assinatura')
  ) then allowed := true; end if;

  if not allowed and public.has_role(actor, 'financeiro') and (from_status, to_status) in (
    ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor'),
    ('ocorrencia_analise_financeiro', 'ocorrencia_concluida'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida'),
    ('ocorrencia_concluida', 'ocorrencia_pendente')
  ) then allowed := true; end if;

  if not allowed and public.has_role(actor, 'financeiro') and new.modalidade = 'lancamento' and (from_status, to_status) in (
    ('ocorrencia_analise_financeiro', 'devolvida_ajuste'),
    ('ocorrencia_concluida', 'ocorrencia_analise_financeiro')
  ) then allowed := true; end if;

  if not allowed then
    raise exception 'Transição de status não permitida para este usuário: % -> %', from_status, to_status using errcode = '42501';
  end if;

  if from_status = 'aguardando_assinatura' and to_status = 'contrato_assinado'
     and not exists (select 1 from public.sale_documents d where d.sale_id = old.id and d.tipo = 'contrato_assinado') then
    raise exception 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.' using errcode = '23514';
  end if;
  return new;
end;
$function$
;
DROP FUNCTION IF EXISTS public.org_admin_cancel_sale(uuid, text);
DROP POLICY IF EXISTS sales_insert_corretor ON public.sales;
CREATE POLICY sales_insert_corretor ON public.sales AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((corretor_id = ( SELECT auth.uid() AS uid)) AND (( SELECT has_role(( SELECT auth.uid() AS uid), 'corretor'::app_role) AS has_role) OR ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) OR (( SELECT has_role(( SELECT auth.uid() AS uid), 'lancamento'::app_role) AS has_role) AND (modalidade = 'lancamento'::text))));
COMMIT;
