-- Atribuição de venda = PARTICIPANTES, nunca quem criou (decisão de Denis, 28/09/2026).
--
-- sales.corretor_id é quem CADASTROU a venda (autoria/auditoria). Venda, produção, comissão,
-- "Suas vendas", fila "Sua vez" e liderança passam a seguir os corretores participantes:
--   corretor_captador_id, corretor_vendedor_id e sale_commission_extras.user_id com papel
--   corretor_captador/corretor_vendedor. Sem nenhum participante definido (rascunho recém-criado),
--   quem criou continua responsável (fallback), para o rascunho não ficar órfão.
-- Lançamento: quem cria é o operador do fluxo (papel lancamento) e continua operando a venda
--   (responsável pelas etapas), mas NÃO recebe atribuição comercial por isso.
-- Quem criou e não participa CONTINUA VENDO a venda (autoria), sem editar/avançar etapa e sem contar
-- em relatórios. O card "Comissão prevista" mostra SOMENTE a parte do usuário.
--
-- Somente funções e a policy sales_select; nenhum dado de negócio é alterado.
-- Rollback literal: docs/sql/rollback/20260929100000_atribuicao_participantes.rollback.sql

-- 1. Helpers --------------------------------------------------------------------------------

-- Corretores participantes (atribuição). Interno: não exposto a usuários.
CREATE OR REPLACE FUNCTION public.sale_corretores(_sale_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT s.corretor_captador_id AS uid FROM public.sales s WHERE s.id = _sale_id
    UNION
    SELECT s.corretor_vendedor_id FROM public.sales s WHERE s.id = _sale_id
    UNION
    SELECT e.user_id FROM public.sale_commission_extras e
    WHERE e.sale_id = _sale_id AND e.papel IN ('corretor_captador', 'corretor_vendedor')
  )
  SELECT uid FROM p WHERE uid IS NOT NULL
  UNION
  SELECT s.corretor_id FROM public.sales s
  WHERE s.id = _sale_id AND NOT EXISTS (SELECT 1 FROM p WHERE p.uid IS NOT NULL)
$function$;

-- Quem age na etapa do corretor: participantes na venda padrão; o operador (criador) no Lançamento.
CREATE OR REPLACE FUNCTION public.sale_responsaveis(_sale_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.corretor_id FROM public.sales s
  WHERE s.id = _sale_id AND s.modalidade::text = 'lancamento'
  UNION
  SELECT c FROM public.sales s, public.sale_corretores(s.id) c
  WHERE s.id = _sale_id AND s.modalidade::text IS DISTINCT FROM 'lancamento'
$function$;

CREATE OR REPLACE FUNCTION public.is_sale_corretor(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.sale_corretores(_sale_id) c WHERE c = _user)
$function$;

CREATE OR REPLACE FUNCTION public.is_sale_responsavel(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.sale_responsaveis(_sale_id) c WHERE c = _user)
$function$;

CREATE OR REPLACE FUNCTION public.is_lead_of_sale_corretor(_lider uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _lider IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sale_corretores(_sale_id) c WHERE public.is_lead_of(_lider, c)
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_lead_of_sale_responsavel(_lider uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _lider IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sale_responsaveis(_sale_id) c WHERE public.is_lead_of(_lider, c)
  )
$function$;

-- IDs dos corretores participantes, só para quem já pode ver a venda (usado nas listagens).
CREATE OR REPLACE FUNCTION public.sale_corretores_ids(_sale_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public.can_view_sale(auth.uid(), _sale_id)
    THEN coalesce((SELECT array_agg(c ORDER BY c) FROM public.sale_corretores(_sale_id) c), ARRAY[]::uuid[])
    ELSE ARRAY[]::uuid[] END
$function$;

REVOKE ALL ON FUNCTION public.sale_corretores(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_responsaveis(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_sale_corretor(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_sale_responsavel(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_lead_of_sale_corretor(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_lead_of_sale_responsavel(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sale_corretores_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_sale_corretor(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_sale_responsavel(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_lead_of_sale_corretor(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_lead_of_sale_responsavel(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sale_corretores_ids(uuid) TO authenticated, service_role;

-- 2. Visibilidade: líder dos participantes passa a ver; criador e líder do criador continuam vendo.
CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_active_user(_user) AND EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND (
      s.corretor_id = _user
      OR s.corretor_captador_id = _user
      OR s.corretor_vendedor_id = _user
      OR s.lider_captador_id = _user
      OR s.lider_vendedor_id = _user
      OR EXISTS (SELECT 1 FROM public.sale_commission_extras sce WHERE sce.sale_id = s.id AND sce.user_id = _user)
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_user, ARRAY['gestor','team_leader']::public.app_role[])
          AND (public.is_lead_of(_user, s.corretor_id) OR public.is_lead_of_sale_corretor(_user, s.id)))
      OR (public.has_role(_user,'juridico'::public.app_role) AND s.status::text = ANY (ARRAY[
        'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
        'aguardando_assinatura','contrato_assinado',
        'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
      ]))
    )
  )
$function$;

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated
USING (
  is_active_user((SELECT auth.uid()))
  AND (
    (corretor_id = (SELECT auth.uid()))
    OR (corretor_captador_id = (SELECT auth.uid()))
    OR (corretor_vendedor_id = (SELECT auth.uid()))
    OR (lider_captador_id = (SELECT auth.uid()))
    OR (lider_vendedor_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.sale_commission_extras sce WHERE sce.sale_id = sales.id AND sce.user_id = (SELECT auth.uid()))
    OR has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin']::app_role[])
    OR (has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::app_role[])
        AND (is_lead_of((SELECT auth.uid()), corretor_id) OR is_lead_of_sale_corretor((SELECT auth.uid()), id)))
    OR (has_role((SELECT auth.uid()), 'juridico'::app_role) AND (status::text = ANY (ARRAY[
      'aprovada_gestor','enviada_juridico','em_elaboracao_contrato','contrato_conferencia_gestor',
      'contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura','contrato_assinado',
      'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
    ])))
  )
);

-- 3. Edição e avanço de etapa: "dono" = responsável (participante); líder = líder do responsável.
CREATE OR REPLACE FUNCTION public.can_edit_sale_stage(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_active_user(_user) and exists (
    select 1 from public.sales s
    where s.id = _sale_id
    and (
      public.has_any_role(_user, array['financeiro','admin','super_admin']::public.app_role[])
      or (public.is_sale_responsavel(_user, s.id) and s.status::text = any(array['rascunho','devolvida_ajuste','contrato_conferencia_corretor']))
      or (
        public.has_any_role(_user, array['gestor','team_leader']::public.app_role[])
        and public.is_lead_of_sale_responsavel(_user, s.id)
        and s.status::text = 'rascunho'
      )
      or (public.has_any_role(_user, array['gestor','team_leader']::public.app_role[]) and s.status::text = any(array[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor']))
      or (public.has_role(_user,'juridico') and s.status::text = any(array['aprovada_gestor','em_elaboracao_contrato']))
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.can_edit_sale_comissao(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_active_user(_user) and (
      public.has_any_role(_user, array['financeiro','admin','super_admin']::public.app_role[])
      or (
        public.has_any_role(_user, array['gestor','team_leader']::public.app_role[])
        and not public.is_sale_locked(_sale_id)
        and exists (
          select 1 from public.sales s
          where s.id = _sale_id
          and (
            s.status::text = any(array[
              'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
              'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor'
            ])
            or (s.status::text = 'rascunho' and public.is_lead_of_sale_responsavel(_user, s.id))
          )
        )
      )
      or (
        public.has_role(_user, 'lancamento'::public.app_role)
        and exists (
          select 1 from public.sales s
          where s.id = _sale_id
          and s.corretor_id = _user
          and s.modalidade = 'lancamento'
          and s.status::text = any(array['rascunho','devolvida_ajuste'])
        )
      )
      or (
        not public.is_sale_locked(_sale_id)
        and exists (
          select 1 from public.sales s
          where s.id = _sale_id
          and public.is_sale_responsavel(_user, s.id)
          and s.status::text = any(array['rascunho','devolvida_ajuste'])
        )
      )
    )
$function$;

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
  if public.has_any_role(actor, array['admin','super_admin']::app_role[]) then return new; end if;

  if to_status in ('cancelada', 'arquivada')
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and public.is_lead_of_sale_responsavel(actor, old.id)
     and from_status in (
       'enviada_revisao', 'contrato_conferencia_gestor', 'contrato_ok_corretor',
       'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
       'ocorrencia_devolvida_gestor'
     ) then
    return new;
  end if;

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
$function$;

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
     public.has_any_role(auth.uid(), ARRAY['gestor','team_leader']::public.app_role[]) manager,
     public.can_view_sale(auth.uid(), _sale_id) OR public.can_manage_sale_as_co_leader(_sale_id) accessible,
     public.is_lead_of_sale_responsavel(auth.uid(), _sale_id) leader,
     public.can_manage_sale_as_co_leader(_sale_id) auxiliary
 ) capabilities;
$function$;

-- 4. Início: "Suas vendas" pelos participantes; "Comissão prevista" = só a parte do usuário.
CREATE OR REPLACE FUNCTION public.dashboard_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with parceria_por_occ as (
    select occurrence_id, sum(valor) as valor
    from (
      select occurrence_id, coalesce(valor, 0) as valor
      from occurrence_partners
      union all
      select occurrence_id, coalesce(valor, 0)
      from occurrence_commissions
      where sem_cadastro_confirmado
    ) p
    group by occurrence_id
  ),
  distribuicao_por_occ as (
    select
      o.id as occurrence_id,
      public.calcular_distribuicao_venda(s.*) as resultado
    from occurrences o
    join sales s on s.id = o.sale_id
  ),
  minha_parte_ocorrencia as (
    -- Venda com ocorrência: a parte do usuário é a linha dele em occurrence_commissions.
    select sum(oc.valor) as valor
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join sales s on s.id = o.sale_id
    where oc.user_id = auth.uid()
      and coalesce(oc.sem_cadastro_confirmado, false) = false
      and s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
  ),
  minha_parte_venda as (
    -- Antes da ocorrência: líquido do lado em que participa (mesma distribuição oficial),
    -- indicador, líder e extras vinculados à conta do usuário.
    select sum(
      case when s.corretor_captador_id = auth.uid() then coalesce((d.r->>'liquido_captador')::numeric, 0) else 0 end
      + case when s.corretor_vendedor_id = auth.uid() then coalesce((d.r->>'liquido_vendedor')::numeric, 0) else 0 end
      + case when s.indicador_captador_id = auth.uid() then coalesce(s.valor_comissao_indicador_captador, 0) else 0 end
      + case when s.indicador_vendedor_id = auth.uid() then coalesce(s.valor_comissao_indicador_vendedor, 0) else 0 end
      + case when s.lider_captador_id = auth.uid() then coalesce(s.valor_comissao_lider_captador, 0) else 0 end
      + case when s.lider_vendedor_id = auth.uid() then coalesce(s.valor_comissao_lider_vendedor, 0) else 0 end
      + coalesce((select sum(coalesce(e.valor, 0)) from sale_commission_extras e
                  where e.sale_id = s.id and e.user_id = auth.uid()
                    and coalesce(e.sem_cadastro_confirmado, false) = false), 0)
    ) as valor
    from sales s
    cross join lateral (select public.calcular_distribuicao_venda(s.*) as r) d
    where s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
      and not exists (select 1 from occurrences o where o.sale_id = s.id)
      and (
        auth.uid() in (s.corretor_captador_id, s.corretor_vendedor_id, s.indicador_captador_id,
                       s.indicador_vendedor_id, s.lider_captador_id, s.lider_vendedor_id)
        or exists (select 1 from sale_commission_extras e where e.sale_id = s.id and e.user_id = auth.uid())
      )
  )
  select jsonb_build_object(
    'funil', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
        select status::text as status, count(*) as cnt from sales group by status
      ) t
    ),
    'minhas_vendas', (select count(*) from sales s where public.is_sale_corretor(auth.uid(), s.id)),
    'minhas_pendencias', (select count(*) from sales s where s.status::text in ('rascunho','devolvida_ajuste') and public.is_sale_responsavel(auth.uid(), s.id)),
    'meus_contratos_conferir', (select count(*) from sales s where s.status::text = 'contrato_conferencia_corretor' and public.is_sale_responsavel(auth.uid(), s.id)),
    'meus_assinados', (select count(*) from sales s where s.status::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida') and public.is_sale_corretor(auth.uid(), s.id)),
    'minha_comissao_prevista', coalesce((select valor from minha_parte_ocorrencia), 0) + coalesce((select valor from minha_parte_venda), 0),
    'gestor_aguardando_revisao', (select count(*) from sales where status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (select count(*) from sales where status::text in ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (select count(*) from sales where status::text in ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (select count(*) from sales where status::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (select count(*) from sales where status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (select count(*) from sales where status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (select count(*) from sales where status::text = 'aguardando_assinatura'),
    'juridico_assinados', (select count(*) from sales where status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (select count(*) from sales where status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (select count(*) from sales where status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (select count(*) from occurrences o join sales s on s.id = o.sale_id where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'occ_concluidas_total', (select count(*) from occurrences o join sales s on s.id = o.sale_id where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'comissao_prevista_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_concluida_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_prevista_total', coalesce((
      select sum(p.valor)
      from occurrences o
      join sales s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_concluida_total', coalesce((
      select sum(p.valor)
      from occurrences o
      join sales s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_prevista_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from occurrences o
      join sales s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_concluida_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from occurrences o
      join sales s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_por_corretor', (
      select coalesce(jsonb_object_agg(user_id, total), '{}'::jsonb) from (
        select oc.user_id::text as user_id, sum(oc.valor) as total
        from occurrence_commissions oc
        join occurrences o on o.id = oc.occurrence_id
        join sales s on s.id = o.sale_id
        where s.status::text not in ('cancelada','arquivada') and oc.user_id is not null
        group by oc.user_id
      ) t
    )
  );
$function$;

-- 5. Listagem de vendas: filtro por corretor = participantes; fila "Sua vez" = responsável/líder.
CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with assinaturas as (
    select o.sale_id, max(o.data_assinatura) as data_assinatura
    from public.occurrences o
    group by o.sale_id
  ), base as (
    select
      s.id,
      s.status,
      s.valor_negociado,
      s.imovel_id,
      s.codigo_interno,
      s.corretor_captador,
      s.corretor_vendedor,
      s.updated_at,
      s.created_at,
      s.corretor_id,
      s.modalidade,
      s.data_assinatura,
      case
        when s.modalidade::text = 'lancamento' then
          coalesce(
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
        else
          coalesce(
            a.data_assinatura,
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
      end as data_venda
    from public.sales s
    left join assinaturas a on a.sale_id = s.id
    where (_status is null or s.status::text = _status)
      and (_statuses is null or s.status::text = any(_statuses))
      and (_corretor_ids is null or exists (
        select 1 from unnest(_corretor_ids) c where public.is_sale_corretor(c, s.id)
      ))
  ), filtradas as (
    select b.*
    from base b
    where b.data_venda is not null
      and (_desde is null or b.data_venda >= _desde)
      and (_ate is null or b.data_venda <= _ate)
      and (
        nullif(trim(_q), '') is null
        or b.imovel_id ilike '%' || trim(_q) || '%'
        or b.codigo_interno ilike '%' || trim(_q) || '%'
        or b.corretor_captador ilike '%' || trim(_q) || '%'
        or b.corretor_vendedor ilike '%' || trim(_q) || '%'
        or exists (
          select 1
          from public.sale_parties sp
          where sp.sale_id = b.id
            and sp.nome ilike '%' || trim(_q) || '%'
        )
      )
  ), pagina as (
    select f.*, public.sale_corretores_ids(f.id) as corretores_ids
    from filtradas f
    order by data_venda desc, id
    limit least(greatest(coalesce(_page_size, 10), 1), 50)
    offset greatest(coalesce(_page, 0), 0) * least(greatest(coalesce(_page_size, 10), 1), 50)
  ), totais as (
    select
      count(*)::integer as total_count,
      coalesce(sum(coalesce(valor_negociado, 0)) filter (where status::text not in ('cancelada', 'arquivada')), 0) as total_valor
    from filtradas
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.data_venda desc, p.id) from pagina p),
      '[]'::jsonb
    ),
    'total_count', totais.total_count,
    'total_valor', totais.total_valor
  )
  from totais;
$function$;

CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas_fila(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH assinaturas AS (
    SELECT o.sale_id, max(o.data_assinatura) AS data_assinatura
    FROM public.occurrences o
    GROUP BY o.sale_id
  ), base AS (
    SELECT
      s.id,
      s.status,
      s.valor_negociado,
      s.imovel_id,
      s.codigo_interno,
      s.corretor_captador,
      s.corretor_vendedor,
      s.updated_at,
      s.created_at,
      s.corretor_id,
      s.modalidade,
      s.data_assinatura,
      CASE
        WHEN s.modalidade::text = 'lancamento' THEN
          coalesce(s.data_assinatura, (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        ELSE coalesce(a.data_assinatura, s.data_assinatura, (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
      END AS data_venda
    FROM public.sales s
    LEFT JOIN assinaturas a ON a.sale_id = s.id
    WHERE (_status IS NULL OR s.status::text = _status)
      AND (_statuses IS NULL OR s.status::text = ANY(_statuses))
      AND (_corretor_ids IS NULL OR EXISTS (
        SELECT 1 FROM unnest(_corretor_ids) c WHERE public.is_sale_corretor(c, s.id)
      ))
  ), filtradas AS (
    SELECT b.*
    FROM base b
    WHERE b.data_venda IS NOT NULL
      AND (_desde IS NULL OR b.data_venda >= _desde)
      AND (_ate IS NULL OR b.data_venda <= _ate)
      AND (
        nullif(trim(_q), '') IS NULL
        OR b.imovel_id ILIKE '%' || trim(_q) || '%'
        OR b.codigo_interno ILIKE '%' || trim(_q) || '%'
        OR b.corretor_captador ILIKE '%' || trim(_q) || '%'
        OR b.corretor_vendedor ILIKE '%' || trim(_q) || '%'
        OR EXISTS (
          SELECT 1
          FROM public.sale_parties sp
          WHERE sp.sale_id = b.id
            AND sp.nome ILIKE '%' || trim(_q) || '%'
        )
      )
      AND (
        (
          b.status::text IN ('rascunho', 'devolvida_ajuste', 'contrato_conferencia_corretor')
          AND is_sale_responsavel(auth.uid(), b.id)
        )
        OR (
          b.status::text IN (
            'enviada_revisao', 'contrato_conferencia_gestor', 'contrato_ok_corretor',
            'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
            'ocorrencia_devolvida_gestor'
          )
          AND has_any_role(auth.uid(), ARRAY['gestor', 'team_leader']::app_role[])
          AND (is_lead_of_sale_responsavel(auth.uid(), b.id) OR is_sale_responsavel(auth.uid(), b.id))
        )
        OR (
          b.status::text IN ('aprovada_gestor', 'enviada_juridico', 'em_elaboracao_contrato')
          AND has_role(auth.uid(), 'juridico'::app_role)
        )
        OR (
          b.status::text = 'ocorrencia_analise_financeiro'
          AND has_role(auth.uid(), 'financeiro'::app_role)
        )
      )
  ), pagina AS (
    SELECT f.*, public.sale_corretores_ids(f.id) AS corretores_ids
    FROM filtradas f
    ORDER BY data_venda DESC, id
    LIMIT least(greatest(coalesce(_page_size, 10), 1), 50)
    OFFSET greatest(coalesce(_page, 0), 0) * least(greatest(coalesce(_page_size, 10), 1), 50)
  ), totais AS (
    SELECT count(*)::integer AS total_count, coalesce(sum(coalesce(valor_negociado, 0)) FILTER (WHERE status::text NOT IN ('cancelada', 'arquivada')), 0) AS total_valor
    FROM filtradas
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.data_venda DESC, p.id) FROM pagina p), '[]'::jsonb),
    'total_count', totais.total_count,
    'total_valor', totais.total_valor
  )
  FROM totais;
$function$;
