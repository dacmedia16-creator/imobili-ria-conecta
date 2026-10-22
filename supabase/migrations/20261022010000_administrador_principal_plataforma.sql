-- 20261022010000_administrador_principal_plataforma (cartão t_44d957b1, aprovação de Denis em 21/10/2026, tópico 6238).
-- "Super Admin" passa a ser SÓ o super-admin da plataforma (platform_admins). O papel de agência
-- super_admin continua no enum (sem migração de dados), mas na tela se chama "Administrador
-- principal" e perde, NO BANCO:
--   1) conceder/retirar o papel super_admin via RLS de user_roles (só a plataforma);
--   2) cadastrar usuário já como super_admin (cadastro_equipe_destino);
--   3) ver o bloco "Saúde do WhatsApp" da visão executiva (desempenho_contexto_periodo).
-- Continua podendo: conceder/retirar "admin" e todos os demais papéis da própria agência,
-- Configurações, Assinatura digital etc. "Entrar como" não tem RPC: a tabela de sessões é fechada
-- para authenticated; a trava é a server function (is_platform_super_admin) e, NO BANCO, o
-- gatilho da seção 4 (autor da sessão precisa estar em platform_admins).
--   4) "Entrar como" pela plataforma: a auditoria (operational_impersonation_sessions/_actions)
--      exigia autor e alvo com perfil NA MESMA agência (FK composta + mt_1b_set_org). A plataforma
--      não é membro das imobiliárias em que entra pelo Painel, então a auditoria passa a herdar a
--      agência SÓ do alvo (e da sessão), e o autor passa a ser exigido como super-admin da plataforma.
-- Idempotente. Rollback: supabase/rollback/20261022010000_administrador_principal_plataforma.sql (definições lidas de produção em 22/10/2026).
-- NÃO aplicar em produção sem novo "sim" de Denis.
-- Sem BEGIN/COMMIT próprios (o aplicador já abre transação; o teste roda dentro de uma desfeita).

-- 1) RLS de user_roles: super_admin de agência não concede nem retira super_admin.
DROP POLICY IF EXISTS user_roles_admin_write ON public.user_roles;
CREATE POLICY user_roles_admin_write ON public.user_roles AS PERMISSIVE FOR ALL TO authenticated
  USING (((SELECT auth.uid()) <> user_id) AND (
    ((SELECT public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role))
      AND (role <> 'super_admin'::public.app_role
           OR (SELECT public.is_platform_super_admin((SELECT auth.uid())))))
    OR ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      AND (role <> ALL (ARRAY['admin'::public.app_role, 'super_admin'::public.app_role])))
  ))
  WITH CHECK (((SELECT auth.uid()) <> user_id) AND (
    ((SELECT public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role))
      AND (role <> 'super_admin'::public.app_role
           OR (SELECT public.is_platform_super_admin((SELECT auth.uid())))))
    OR ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      AND (role <> ALL (ARRAY['admin'::public.app_role, 'super_admin'::public.app_role])))
  ));

-- 2) Cadastro: super_admin de agência não cria usuário já como super_admin.
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

  -- "Administrador principal" (super_admin) cadastra qualquer papel, MENOS "Administrador
  -- principal": esse papel só a plataforma concede (t_44d957b1, 21/10/2026).
  if 'super_admin' = any(_roles) then
    if _role = 'super_admin' then
      raise exception using errcode = '42501', message = 'cadastro_principal_so_plataforma';
    end if;
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

-- 3) Visão executiva: bloco WhatsApp só para o super-admin da plataforma.
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
    'whatsapp', case when public.is_platform_super_admin(auth.uid()) then
      (select jsonb_build_object('eventos', eventos, 'enviados', enviados, 'falhas', falhas, 'eventos_com_falha', eventos_com_falha) from whatsapp)
      else null end
  ) where _de <= _ate and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$;

-- 4) "Entrar como" pela plataforma (auditoria). O autor da sessão deixa de precisar de perfil na
--    agência do alvo (a plataforma não é membro dela); a agência da auditoria vem SÓ do alvo.
--    Em troca, o banco passa a exigir que o autor de uma sessão nova seja super-admin da plataforma
--    (falha fechada também para service_role): agência nenhuma abre sessão de "entrar como".
ALTER TABLE public.operational_impersonation_sessions
  DROP CONSTRAINT IF EXISTS mt_1b_operational_impersonation_sessions_actor_user_id_org_fk;
ALTER TABLE public.operational_impersonation_actions
  DROP CONSTRAINT IF EXISTS mt_1b_operational_impersonation_actions_actor_user_id_org_fk;
-- actor_user_id continua com FK para auth.users (operational_impersonation_*_actor_user_id_fkey).

DROP TRIGGER IF EXISTS trg_00_org ON public.operational_impersonation_sessions;
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.operational_impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.mt_1b_set_org('profiles', 'target_user_id', 'null', 'null');

CREATE OR REPLACE FUNCTION public.impersonation_actor_plataforma()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id THEN
    RETURN NEW;
  END IF;
  IF NEW.actor_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = NEW.actor_user_id) THEN
    RAISE EXCEPTION 'impersonacao_so_plataforma' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.impersonation_actor_plataforma() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_01_impersonation_actor_plataforma ON public.operational_impersonation_sessions;
CREATE TRIGGER trg_01_impersonation_actor_plataforma
  BEFORE INSERT OR UPDATE OF actor_user_id ON public.operational_impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.impersonation_actor_plataforma();
