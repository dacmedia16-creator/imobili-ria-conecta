-- t_baf5d60c (Denis 20/10, tópico 6238, opção B): leitura de comissões e parcerias da ocorrência SEM RLS em cascata.
--
-- Antes: as policies de LEITURA de occurrence_commissions / occurrence_partners faziam
--   EXISTS (select 1 from occurrences o where o.id = occurrence_id and o.sale_id in (lista))
-- e, dentro desse EXISTS, o Postgres reaplicava TODAS as policies de occurrences (4 ramos OR, cada um recalculando
-- uma lista de vendas). Para gestor/team leader/jurídico isso recalculava a lista de vendas visíveis ~4x por consulta.
--
-- Agora: duas listas novas (SECURITY DEFINER, search_path vazio, calculadas uma vez por consulta):
--   ocorrencias_visiveis_ids()          = ocorrências da imobiliária atual cuja venda está em vendas_visiveis_ids()
--   ocorrencias_coleader_leitura_ids()  = idem com vendas_coleader_leitura_ids()
-- e as 4 policies de LEITURA passam a usar "occurrence_id in (select lista)".
--
-- A REGRA NÃO MUDA (quem vê o quê):
--   * o.sale_id in vendas_visiveis_ids() já satisfaz occ_view; o.sale_id in vendas_coleader_leitura_ids() já
--     satisfaz occurrences_co_leader_principal_read. Então, no EXISTS antigo, a única restrição extra que a RLS de
--     occurrences acrescentava era org_isolation (organization_id = current_org_id()) — que a lista nova aplica.
--   * Só USING de 4 policies SELECT. Policies ALL/INSERT/UPDATE/DELETE, WITH CHECK, papéis e org_isolation intactos.
--   * Equivalência provada na cópia de produção de 20/10 (16 perfis, 2 imobiliárias): mesmas linhas e md5.
--
-- Idempotente: só altera a policy se o USING atual for o ORIGINAL conferido em produção (md5 em 20/10) ou já o novo;
-- se for diferente dos dois, PARA.
-- Desfazer: supabase/rollback/20261020120000_rls_leitura_ocorrencias_sem_cascata.sql
select set_config('lock_timeout', '5s', true);

create or replace function public.ocorrencias_visiveis_ids()
returns setof uuid
language sql stable security definer set search_path to '' as $$
  select o.id from public.occurrences o
  where o.organization_id = (select public.current_org_id())
    and o.sale_id in (select public.vendas_visiveis_ids()) $$;

create or replace function public.ocorrencias_coleader_leitura_ids()
returns setof uuid
language sql stable security definer set search_path to '' as $$
  select o.id from public.occurrences o
  where o.organization_id = (select public.current_org_id())
    and o.sale_id in (select public.vendas_coleader_leitura_ids()) $$;

revoke all on function public.ocorrencias_visiveis_ids(), public.ocorrencias_coleader_leitura_ids() from public, anon;
grant execute on function public.ocorrencias_visiveis_ids(), public.ocorrencias_coleader_leitura_ids()
  to authenticated, service_role;

do $m$
declare
  _sp text := current_setting('search_path');
  r record;
  _atual text;
begin
  perform set_config('search_path', 'public', true);
  for r in
    select * from (values
      -- (tabela, policy, md5 do USING original de produção 20/10, USING novo)
      ('occurrence_commissions', 'occ_comm_view', '809c45075ce645d3bed1fd97b2efda35',
       'occurrence_id in (select public.ocorrencias_visiveis_ids())'),
      ('occurrence_commissions', 'occurrence_commissions_co_leader_principal_read', '983d14cae93ec3aa59585a196fbb2359',
       'occurrence_id in (select public.ocorrencias_coleader_leitura_ids())'),
      ('occurrence_partners', 'occ_part_view', 'cf7933020f475f18eb93e7ac153ab3bc',
       'occurrence_id in (select public.ocorrencias_visiveis_ids())'),
      ('occurrence_partners', 'occurrence_partners_co_leader_principal_read', '2df6f5f83e1c53dc7238f33665708756',
       'occurrence_id in (select public.ocorrencias_coleader_leitura_ids())')
    ) v(tabela, policy, md5_original, using_novo)
  loop
    select qual into _atual from pg_policies
     where schemaname = 'public' and tablename = r.tabela and policyname = r.policy and cmd = 'SELECT';
    if _atual is null then
      raise exception 'rls_ocorrencias: policy %.% não encontrada', r.tabela, r.policy;
    elsif _atual like '%ocorrencias_%_ids()%' then
      raise notice 'rls_ocorrencias: %.% já no formato novo (pulada)', r.tabela, r.policy;
    elsif md5(_atual) <> r.md5_original then
      raise exception 'rls_ocorrencias: %.% diverge do conferido em produção em 20/10; gere a migration de novo', r.tabela, r.policy;
    else
      execute format('alter policy %I on public.%I using (%s)', r.policy, r.tabela, r.using_novo);
    end if;
  end loop;
  perform set_config('search_path', _sp, true);
end $m$;
