-- Itens 1 e 2 da conferência de desempenho — ETAPA 1 (item 2): permissões calculadas UMA vez por consulta.
--
-- Antes: cada policy de LEITURA chamava can_view_sale(uid, sale_id) (ou a regra de co-líder/jurídico) linha por
-- linha. Agora a lista de vendas que a pessoa pode ver é calculada uma vez por consulta e a policy usa
-- "sale_id IN (lista)". A REGRA NÃO MUDA:
--   * vendas_visiveis_ids() reproduz can_view_sale ramo a ramo (equivalência testada em
--     supabase/tests/perf_itens_1_2/equivalencia.sql, perfil a perfil);
--   * as 4 listas de co-líder/jurídico chamam a MESMA função atual para cada venda da imobiliária; o "portão"
--     só pula o cálculo quando a função daria falso de qualquer jeito (pessoa não é co-líder / não é jurídico).
-- Só muda o USING das policies de LEITURA (SELECT) e o USING das policies ALL. WITH CHECK e as policies de
-- INSERT/UPDATE/DELETE ficam exatamente como estão.
--
-- Idempotente: as funções usam CREATE OR REPLACE; cada policy só é alterada se o USING atual for o ORIGINAL
-- conferido em produção; se já estiver no formato novo, é pulada; se for diferente dos dois, a migration PARA.
-- Desfazer: supabase/rollback/20261008100000_perf_itens_1_2.sql.

create or replace function public.vendas_visiveis_ids()
returns setof uuid
language sql stable security definer
set search_path to ''
as $$
  with u as (
    select (select auth.uid()) uid, public.current_org_id() org
  ), ctx as (
    select u.uid, u.org,
      coalesce(public.is_active_user(u.uid), false) ativo,
      coalesce(public.has_any_role(u.uid, array['financeiro','admin','super_admin']::public.app_role[]), false) amplo,
      coalesce(public.has_any_role(u.uid, array['gestor','team_leader']::public.app_role[]), false) lider,
      coalesce(public.has_role(u.uid, 'juridico'::public.app_role), false) juridico
    from u
    where u.uid is not null and u.org is not null and public.mt_1b_gate()
  ), liderados as (   -- = is_lead_of(uid, membro): equipes que lidera, co-lidera ou cuja equipe-mãe lidera/co-lidera
    select distinct tm.membro_id
    from ctx
    join public.teams t on t.organization_id = ctx.org
    join public.team_members tm on tm.team_id = t.id
    left join public.teams pt on pt.id = t.parent_team_id
    where ctx.lider
      and (t.lider_id = ctx.uid or pt.lider_id = ctx.uid
        or exists (select 1 from public.team_co_leaders cl where cl.team_id = t.id and cl.user_id = ctx.uid)
        or (pt.id is not null and exists (select 1 from public.team_co_leaders cl where cl.team_id = pt.id and cl.user_id = ctx.uid)))
      and exists (select 1 from public.organization_members m where m.user_id = tm.membro_id and m.ativo and m.organization_id = ctx.org)
  )
  select s.id
  from ctx
  join public.sales s on s.organization_id = ctx.org
  where ctx.ativo and (
       ctx.amplo
    or ctx.uid in (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id, s.lider_captador_id, s.lider_vendedor_id)
    or exists (select 1 from public.sale_commission_extras e where e.sale_id = s.id and e.user_id = ctx.uid)
    or (ctx.lider and (
          s.corretor_id in (select membro_id from liderados)
       or exists (  -- = is_lead_of_sale_corretor (sale_corretores)
            select 1 from (
              select x.uid from (
                select s.corretor_captador_id uid union select s.corretor_vendedor_id
                union select e.user_id from public.sale_commission_extras e
                 where e.sale_id = s.id and e.papel in ('corretor_captador','corretor_vendedor')) x
              where x.uid is not null
              union
              select s.corretor_id where s.corretor_captador_id is null and s.corretor_vendedor_id is null
                and not exists (select 1 from public.sale_commission_extras e
                  where e.sale_id = s.id and e.papel in ('corretor_captador','corretor_vendedor') and e.user_id is not null)
            ) c where c.uid in (select membro_id from liderados))))
    or (ctx.juridico and s.status::text = any (array['aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura',
        'contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida']))
  )
$$;

create or replace function public.vendas_coleader_leitura_ids() returns setof uuid
language sql stable security definer set search_path to '' as $$
  with g as (select 1 where exists (select 1 from public.team_co_leaders cl where cl.user_id = (select auth.uid())))
  select s.id from g, public.sales s where s.organization_id = public.current_org_id()
    and public.can_read_principal_sale_as_co_leader(s.id) $$;

create or replace function public.vendas_coleader_gestao_ids() returns setof uuid
language sql stable security definer set search_path to '' as $$
  with g as (select 1 where exists (select 1 from public.team_co_leaders cl where cl.user_id = (select auth.uid())))
  select s.id from g, public.sales s where s.organization_id = public.current_org_id()
    and public.can_manage_sale_as_co_leader(s.id) $$;

create or replace function public.vendas_coleader_edicao_ids() returns setof uuid
language sql stable security definer set search_path to '' as $$
  with g as (select 1 where exists (select 1 from public.team_co_leaders cl where cl.user_id = (select auth.uid())))
  select s.id from g, public.sales s where s.organization_id = public.current_org_id()
    and public.can_edit_sale_as_co_leader(s.id) $$;

create or replace function public.vendas_juridico_certidao_ids() returns setof uuid
language sql stable security definer set search_path to '' as $$
  with g as (select 1 where exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'juridico'))
  select s.id from g, public.sales s where s.organization_id = public.current_org_id()
    and public.can_read_sale_juridico_certidao(s.id) $$;

revoke all on function public.vendas_visiveis_ids(), public.vendas_coleader_leitura_ids(), public.vendas_coleader_gestao_ids(),
  public.vendas_coleader_edicao_ids(), public.vendas_juridico_certidao_ids() from public, anon;
grant execute on function public.vendas_visiveis_ids(), public.vendas_coleader_leitura_ids(), public.vendas_coleader_gestao_ids(),
  public.vendas_coleader_edicao_ids(), public.vendas_juridico_certidao_ids() to authenticated, service_role;

-- Lista explícita das policies alteradas: USING original (lido em produção) e USING novo.
-- (search_path só desta transação: os textos de policy usam nomes sem "public.", como o Postgres os devolve)
select set_config('search_path', 'public, extensions', true), set_config('lock_timeout', '5s', true);
create temp table if not exists perf_alvo (tabela text, politica text, cmd text, using_original text, using_novo text);
truncate pg_temp.perf_alvo;
-- >>> GERADO
-- 46 policies (36 SELECT + 10 ALL, só o USING). Gerado por supabase/tests/perf_itens_1_2/gerar_sql.py
insert into pg_temp.perf_alvo (tabela, politica, cmd, using_original, using_novo) values
    ($q$activity_logs$q$, $q$co_leader_activity_read$q$, $q$SELECT$q$,
     $q$can_manage_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_gestao_ids() AS vendas_coleader_gestao_ids))$q$),
    ($q$activity_logs$q$, $q$juridico_returned_activity_read$q$, $q$SELECT$q$,
     $q$can_read_sale_juridico_certidao(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))$q$),
    ($q$activity_logs$q$, $q$log_view$q$, $q$SELECT$q$,
     $q$(((sale_id IS NULL) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::app_role, 'super_admin'::app_role]) AS has_any_role)) OR ((sale_id IS NOT NULL) AND can_view_sale(( SELECT auth.uid() AS uid), sale_id)))$q$,
     $q$(((sale_id IS NULL) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::app_role, 'super_admin'::app_role]) AS has_any_role)) OR ((sale_id IS NOT NULL) AND (sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))))$q$),
    ($q$document_extractions$q$, $q$view extractions if can view sale$q$, $q$SELECT$q$,
     $q$can_view_sale(( SELECT auth.uid() AS uid), sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$),
    ($q$occurrence_commissions$q$, $q$co_leader_commissions_write$q$, $q$ALL$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_edit_sale_as_co_leader(o.sale_id))))$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids)))))$q$),
    ($q$occurrence_commissions$q$, $q$occ_comm_view$q$, $q$SELECT$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id))))$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids)))))$q$),
    ($q$occurrence_commissions$q$, $q$occ_comm_write$q$, $q$ALL$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role))))$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids)) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role))))$q$),
    ($q$occurrence_commissions$q$, $q$occurrence_commissions_co_leader_principal_read$q$, $q$SELECT$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_read_principal_sale_as_co_leader(o.sale_id))))$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids)))))$q$),
    ($q$occurrence_partners$q$, $q$co_leader_partners_write$q$, $q$ALL$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_edit_sale_as_co_leader(o.sale_id))))$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids)))))$q$),
    ($q$occurrence_partners$q$, $q$occ_part_view$q$, $q$SELECT$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id))))$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids)))))$q$),
    ($q$occurrence_partners$q$, $q$occ_part_write$q$, $q$ALL$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role))))$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids)) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role))))$q$),
    ($q$occurrence_partners$q$, $q$occurrence_partners_co_leader_principal_read$q$, $q$SELECT$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_read_principal_sale_as_co_leader(o.sale_id))))$q$,
     $q$(EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids)))))$q$),
    ($q$occurrences$q$, $q$co_leader_occurrence_write$q$, $q$ALL$q$,
     $q$can_edit_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids))$q$),
    ($q$occurrences$q$, $q$occ_view$q$, $q$SELECT$q$,
     $q$can_view_sale(( SELECT auth.uid() AS uid), sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$),
    ($q$occurrences$q$, $q$occ_write$q$, $q$ALL$q$,
     $q$(( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) AND can_view_sale(( SELECT auth.uid() AS uid), sale_id))$q$,
     $q$(( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) AND (sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids)))$q$),
    ($q$occurrences$q$, $q$occurrences_co_leader_principal_read$q$, $q$SELECT$q$,
     $q$can_read_principal_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids))$q$),
    ($q$sale_bank_accounts$q$, $q$co_leader_bank_read$q$, $q$SELECT$q$,
     $q$can_manage_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_gestao_ids() AS vendas_coleader_gestao_ids))$q$),
    ($q$sale_bank_accounts$q$, $q$co_leader_bank_write$q$, $q$ALL$q$,
     $q$can_edit_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids))$q$),
    ($q$sale_bank_accounts$q$, $q$juridico_returned_bank_read$q$, $q$SELECT$q$,
     $q$can_read_sale_juridico_certidao(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))$q$),
    ($q$sale_bank_accounts$q$, $q$sale_bank_select$q$, $q$SELECT$q$,
     $q$can_view_sale(( SELECT auth.uid() AS uid), sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$),
    ($q$sale_comment_recipients$q$, $q$sale_comment_recipients_view$q$, $q$SELECT$q$,
     $q$can_view_sale(( SELECT auth.uid() AS uid), sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$),
    ($q$sale_comments$q$, $q$co_leader_comments_read$q$, $q$SELECT$q$,
     $q$can_manage_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_gestao_ids() AS vendas_coleader_gestao_ids))$q$),
    ($q$sale_comments$q$, $q$juridico_returned_comments_read$q$, $q$SELECT$q$,
     $q$can_read_sale_juridico_certidao(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))$q$),
    ($q$sale_comments$q$, $q$sale_comments_view$q$, $q$SELECT$q$,
     $q$can_view_sale(( SELECT auth.uid() AS uid), sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$),
    ($q$sale_commission_extras$q$, $q$co_leader_extras_write$q$, $q$ALL$q$,
     $q$can_edit_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids))$q$),
    ($q$sale_commission_extras$q$, $q$juridico_returned_extras_read$q$, $q$SELECT$q$,
     $q$can_read_sale_juridico_certidao(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))$q$),
    ($q$sale_commission_extras$q$, $q$sale_commission_extras_co_leader_principal_read$q$, $q$SELECT$q$,
     $q$can_read_principal_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids))$q$),
    ($q$sale_commission_extras$q$, $q$sale_commission_extras_select$q$, $q$SELECT$q$,
     $q$can_view_sale(( SELECT auth.uid() AS uid), sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$),
    ($q$sale_documents$q$, $q$co_leader_documents_read$q$, $q$SELECT$q$,
     $q$((deleted_at IS NULL) AND can_manage_sale_as_co_leader(sale_id))$q$,
     $q$((deleted_at IS NULL) AND (sale_id IN ( SELECT public.vendas_coleader_gestao_ids() AS vendas_coleader_gestao_ids)))$q$),
    ($q$sale_documents$q$, $q$juridico_returned_documents_read$q$, $q$SELECT$q$,
     $q$can_read_sale_juridico_certidao(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))$q$),
    ($q$sale_documents$q$, $q$sale_docs_select$q$, $q$SELECT$q$,
     $q$(can_view_sale(( SELECT auth.uid() AS uid), sale_id) AND ((deleted_at IS NULL) OR ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::app_role, 'super_admin'::app_role]) AS has_any_role)))$q$,
     $q$((sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids)) AND ((deleted_at IS NULL) OR ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::app_role, 'super_admin'::app_role]) AS has_any_role)))$q$),
    ($q$sale_geo$q$, $q$sale_geo_read$q$, $q$SELECT$q$,
     $q$((organization_id = ( SELECT current_org_id() AS current_org_id)) AND ( SELECT mt_1b_gate() AS mt_1b_gate) AND can_view_sale(( SELECT auth.uid() AS uid), sale_id))$q$,
     $q$((organization_id = ( SELECT current_org_id() AS current_org_id)) AND ( SELECT mt_1b_gate() AS mt_1b_gate) AND (sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids)))$q$),
    ($q$sale_parties$q$, $q$co_leader_parties_write$q$, $q$ALL$q$,
     $q$can_edit_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids))$q$),
    ($q$sale_parties$q$, $q$juridico_returned_parties_read$q$, $q$SELECT$q$,
     $q$can_read_sale_juridico_certidao(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))$q$),
    ($q$sale_parties$q$, $q$sale_parties_co_leader_principal_read$q$, $q$SELECT$q$,
     $q$can_read_principal_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids))$q$),
    ($q$sale_parties$q$, $q$sale_parties_select$q$, $q$SELECT$q$,
     $q$can_view_sale(( SELECT auth.uid() AS uid), sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$),
    ($q$sale_payment$q$, $q$co_leader_payment_write$q$, $q$ALL$q$,
     $q$can_edit_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids))$q$),
    ($q$sale_payment$q$, $q$juridico_returned_payment_read$q$, $q$SELECT$q$,
     $q$can_read_sale_juridico_certidao(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))$q$),
    ($q$sale_payment$q$, $q$sale_payment_co_leader_principal_read$q$, $q$SELECT$q$,
     $q$can_read_principal_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids))$q$),
    ($q$sale_payment$q$, $q$sale_payment_select$q$, $q$SELECT$q$,
     $q$can_view_sale(( SELECT auth.uid() AS uid), sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$),
    ($q$sale_status_history$q$, $q$co_leader_history_read$q$, $q$SELECT$q$,
     $q$can_manage_sale_as_co_leader(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_coleader_gestao_ids() AS vendas_coleader_gestao_ids))$q$),
    ($q$sale_status_history$q$, $q$history_view$q$, $q$SELECT$q$,
     $q$can_view_sale(( SELECT auth.uid() AS uid), sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$),
    ($q$sale_status_history$q$, $q$juridico_returned_history_read$q$, $q$SELECT$q$,
     $q$can_read_sale_juridico_certidao(sale_id)$q$,
     $q$(sale_id IN ( SELECT public.vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))$q$),
    ($q$sales$q$, $q$juridico_returned_sale_read$q$, $q$SELECT$q$,
     $q$can_read_sale_juridico_certidao(id)$q$,
     $q$(id IN ( SELECT public.vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))$q$),
    ($q$sales$q$, $q$sales_co_leader_principal_read$q$, $q$SELECT$q$,
     $q$can_read_principal_sale_as_co_leader(id)$q$,
     $q$(id IN ( SELECT public.vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids))$q$),
    ($q$sales$q$, $q$sales_select$q$, $q$SELECT$q$,
     $q$(( SELECT is_active_user(( SELECT auth.uid() AS uid)) AS is_active_user) AND ((corretor_id = ( SELECT auth.uid() AS uid)) OR (corretor_captador_id = ( SELECT auth.uid() AS uid)) OR (corretor_vendedor_id = ( SELECT auth.uid() AS uid)) OR (lider_captador_id = ( SELECT auth.uid() AS uid)) OR (lider_vendedor_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM sale_commission_extras sce
  WHERE ((sce.sale_id = sales.id) AND (sce.user_id = ( SELECT auth.uid() AS uid))))) OR ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role) OR (( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) AND (is_lead_of(( SELECT auth.uid() AS uid), corretor_id) OR is_lead_of_sale_corretor(( SELECT auth.uid() AS uid), id))) OR (( SELECT has_role(( SELECT auth.uid() AS uid), 'juridico'::app_role) AS has_role) AND ((status)::text = ANY (ARRAY['aprovada_gestor'::text, 'enviada_juridico'::text, 'em_elaboracao_contrato'::text, 'contrato_conferencia_gestor'::text, 'contrato_conferencia_corretor'::text, 'contrato_ok_corretor'::text, 'aguardando_assinatura'::text, 'contrato_assinado'::text, 'ocorrencia_pendente'::text, 'ocorrencia_analise_financeiro'::text, 'ocorrencia_devolvida_gestor'::text, 'ocorrencia_concluida'::text])))))$q$,
     $q$(id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))$q$);
-- <<< GERADO

do $p$
declare
  r record; atual text; n_alt int := 0; n_ja int := 0;
  velhas constant text := '\m(can_view_sale|can_read_principal_sale_as_co_leader|can_manage_sale_as_co_leader|can_read_sale_juridico_certidao|can_edit_sale_as_co_leader)\(';
  novas constant text := 'vendas_(visiveis|coleader_leitura|coleader_gestao|coleader_edicao|juridico_certidao)_ids\(';
begin
  for r in select * from pg_temp.perf_alvo order by tabela, politica loop
    select p.qual into atual from pg_policies p
     where p.schemaname = 'public' and p.tablename = r.tabela and p.policyname = r.politica and p.cmd = r.cmd;
    if not found then
      raise exception 'policy %.% (%) não existe; produção mudou, gere o SQL de novo', r.tabela, r.politica, r.cmd;
    end if;
    if replace(atual, 'public.', '') = replace(r.using_original, 'public.', '') then
      execute format('alter policy %I on public.%I using (%s)', r.politica, r.tabela, r.using_novo);
      n_alt := n_alt + 1;
    elsif atual ~ novas and atual !~ velhas then
      n_ja := n_ja + 1;  -- já no formato novo (o Postgres reescreve o texto; por isso não comparo literal)
    else
      raise exception 'USING de %.% diverge do conferido em produção; gere o SQL de novo. Atual: %', r.tabela, r.politica, atual;
    end if;
  end loop;
  raise notice 'etapa 1: % policies alteradas, % já estavam no formato novo (total %)',
    n_alt, n_ja, (select count(*) from pg_temp.perf_alvo);
end $p$;

drop table pg_temp.perf_alvo;
