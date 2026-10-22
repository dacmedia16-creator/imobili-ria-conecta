-- Rollback de 20261022010000_administrador_principal_plataforma.sql (t_44d957b1).
-- Restaura EXATAMENTE as definições lidas de produção em 22/10/2026 (somente leitura) antes da
-- mudança. Nenhum dado é alterado (a migration também não altera dados).
BEGIN;

DROP POLICY IF EXISTS user_roles_admin_write ON public.user_roles;
CREATE POLICY user_roles_admin_write ON public.user_roles AS PERMISSIVE FOR ALL TO authenticated
  USING ((( SELECT auth.uid() AS uid) <> user_id) AND (( SELECT has_role(( SELECT auth.uid() AS uid), 'super_admin'::app_role) AS has_role) OR (( SELECT has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) AS has_role) AND (role <> ALL (ARRAY['admin'::app_role, 'super_admin'::app_role])))))
  WITH CHECK ((( SELECT auth.uid() AS uid) <> user_id) AND (( SELECT has_role(( SELECT auth.uid() AS uid), 'super_admin'::app_role) AS has_role) OR (( SELECT has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) AS has_role) AND (role <> ALL (ARRAY['admin'::app_role, 'super_admin'::app_role])))));

CREATE OR REPLACE FUNCTION public.cadastro_equipe_destino(_actor uuid, _org uuid, _role app_role)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _roles public.app_role[];
  _team uuid;
begin
  if _actor is null or _org is null or _role is null then
    raise exception using errcode = '42501', message = 'cadastro_sem_agencia';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = _actor and m.organization_id = _org and m.ativo and o.status = 'ativa'
  ) or not exists (
    select 1 from public.profiles p
    where p.id = _actor and p.organization_id = _org and p.ativo is true
  ) then
    raise exception using errcode = '42501', message = 'cadastro_sem_agencia';
  end if;

  select coalesce(array_agg(ur.role), '{}') into _roles
  from public.user_roles ur
  where ur.user_id = _actor and ur.organization_id = _org;

  if 'super_admin' = any(_roles) then
    return null;
  end if;

  if 'admin' = any(_roles) then
    if _role in ('admin', 'super_admin') then
      raise exception using errcode = '42501', message = 'cadastro_admin_nao_cria_admin';
    end if;
    return null;
  end if;

  if not (_roles && array['gestor', 'team_leader']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'cadastro_sem_permissao';
  end if;

  if _role <> 'corretor' then
    raise exception using errcode = '42501', message = 'cadastro_lider_so_corretor';
  end if;

  select t.id into _team
  from public.teams t
  where t.organization_id = _org and t.lider_id = _actor
  order by (t.parent_team_id is not null), t.created_at, t.id
  limit 1;

  if _team is null and not ('gestor' = any(_roles)) then
    raise exception using errcode = '42501', message = 'cadastro_lider_sem_equipe';
  end if;

  return _team;
end
$function$;

CREATE OR REPLACE FUNCTION public.desempenho_contexto_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with stage_map(status, stage) as (values
    ('rascunho','inicio'), ('devolvida_ajuste','inicio'), ('ocorrencia_devolvida_gestor','inicio'),
    ('enviada_revisao','aprovacao'), ('aprovada_gestor','aprovacao'),
    ('enviada_juridico','juridico'), ('em_elaboracao_contrato','juridico'),
    ('contrato_conferencia_gestor','juridico'), ('contrato_conferencia_corretor','juridico'),
    ('contrato_ok_corretor','juridico'), ('aguardando_assinatura','juridico'),
    ('contrato_assinado','concluida'), ('ocorrencia_pendente','concluida'),
    ('ocorrencia_analise_financeiro','concluida'), ('ocorrencia_concluida','concluida')
  ), historico as (
    select h.sale_id, h.para,
      least(coalesce(lead(h.created_at) over (partition by h.sale_id order by h.created_at), ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')), ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo'))
        - greatest(h.created_at, (_de::timestamp at time zone 'America/Sao_Paulo')) duracao
    from sale_status_history h where h.created_at < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), tempo as (
    select coalesce(jsonb_object_agg(stage, media), '{}'::jsonb) valor from (
      select sm.stage, round((avg(extract(epoch from h.duracao)) / 86400.0)::numeric, 1) media
      from historico h join stage_map sm on sm.status = h.para::text
      where h.duracao > interval '0 seconds' group by sm.stage
    ) x
  ), efetivadas as (
    select sale_id, venda_em as efetivada_em from public.vendas_comerciais_validas()
  ), evolucao as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', to_char(m.mes, 'YYYY-MM'), 'vendas_fechadas', coalesce(v.vendas, 0),
      'comissao', coalesce(v.comissao, 0)
    ) order by m.mes), '[]'::jsonb) valor
    from generate_series(date_trunc('month', _de::timestamp), date_trunc('month', _ate::timestamp), interval '1 month') m(mes)
    left join (
      select date_trunc('month', e.efetivada_em at time zone 'America/Sao_Paulo') mes, count(distinct e.sale_id) vendas,
        coalesce(sum(oc.valor) filter (where oc.user_id is not null), 0) comissao
      from efetivadas e
      left join occurrences o on o.sale_id = e.sale_id
      left join occurrence_commissions oc on oc.occurrence_id = o.id
      where e.efetivada_em >= (_de::timestamp at time zone 'America/Sao_Paulo') and e.efetivada_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      group by 1
    ) v on v.mes = m.mes
  ), whatsapp as (
    select count(*) eventos, coalesce(sum((payload->>'enviados')::int), 0) enviados,
      coalesce(sum((payload->>'falhas')::int), 0) falhas,
      count(*) filter (where (payload->>'falhas')::int > 0) eventos_com_falha
    from activity_logs where acao = 'whatsapp_notification_result'
      and created_at >= (_de::timestamp at time zone 'America/Sao_Paulo') and created_at < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  )
  select jsonb_build_object(
    'tempo_por_etapa', (select valor from tempo),
    'evolucao_mensal', (select valor from evolucao),
    'whatsapp', case when has_any_role(auth.uid(), array['super_admin']::app_role[]) then
      (select jsonb_build_object('eventos', eventos, 'enviados', enviados, 'falhas', falhas, 'eventos_com_falha', eventos_com_falha) from whatsapp)
      else null end
  ) where _de <= _ate and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$;


-- 4) "Entrar como": volta a exigir autor e alvo com perfil na mesma agência (definição original de
--    20260928010000_mt_fase1b_escopo). NOT VALID: sessões já gravadas pela plataforma em agência da
--    qual ela não é membro continuam no histórico (não se apaga auditoria); vale para linhas novas.
DROP TRIGGER IF EXISTS trg_01_impersonation_actor_plataforma ON public.operational_impersonation_sessions;
DROP FUNCTION IF EXISTS public.impersonation_actor_plataforma();
DROP TRIGGER IF EXISTS trg_00_org ON public.operational_impersonation_sessions;
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.operational_impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.mt_1b_set_org('profiles', 'target_user_id', 'profiles', 'actor_user_id');
ALTER TABLE public.operational_impersonation_sessions
  DROP CONSTRAINT IF EXISTS mt_1b_operational_impersonation_sessions_actor_user_id_org_fk;
ALTER TABLE public.operational_impersonation_sessions
  ADD CONSTRAINT mt_1b_operational_impersonation_sessions_actor_user_id_org_fk
  FOREIGN KEY (actor_user_id, organization_id) REFERENCES public.profiles(id, organization_id) NOT VALID;
ALTER TABLE public.operational_impersonation_actions
  DROP CONSTRAINT IF EXISTS mt_1b_operational_impersonation_actions_actor_user_id_org_fk;
ALTER TABLE public.operational_impersonation_actions
  ADD CONSTRAINT mt_1b_operational_impersonation_actions_actor_user_id_org_fk
  FOREIGN KEY (actor_user_id, organization_id) REFERENCES public.profiles(id, organization_id) NOT VALID;
-- Se não houver sessão da plataforma fora da própria agência, valida (fica idêntico ao original).
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_impersonation_sessions
      VALIDATE CONSTRAINT mt_1b_operational_impersonation_sessions_actor_user_id_org_fk;
    ALTER TABLE public.operational_impersonation_actions
      VALIDATE CONSTRAINT mt_1b_operational_impersonation_actions_actor_user_id_org_fk;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'FKs do autor ficam NOT VALID: há sessões históricas da plataforma em outra agência.';
  END;
END $$;

COMMIT;
