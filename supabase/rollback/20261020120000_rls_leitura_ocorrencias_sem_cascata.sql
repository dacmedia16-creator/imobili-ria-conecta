-- DESFAZER da migration 20261020120000_rls_leitura_ocorrencias_sem_cascata (t_baf5d60c).
-- Volta o USING das 4 policies de LEITURA EXATAMENTE ao texto de produção de 20/10/2026 (pg_policies, somente leitura)
-- e apaga as 2 listas novas. Não mexe em dados, tabelas, outras policies nem outras funções. Idempotente.
begin;
select set_config('lock_timeout', '5s', true);

ALTER POLICY occ_comm_view ON public.occurrence_commissions USING (EXISTS ( SELECT 1
   FROM public.occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids)))));
ALTER POLICY occurrence_commissions_co_leader_principal_read ON public.occurrence_commissions USING (EXISTS ( SELECT 1
   FROM public.occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids)))));
ALTER POLICY occ_part_view ON public.occurrence_partners USING (EXISTS ( SELECT 1
   FROM public.occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids)))));
ALTER POLICY occurrence_partners_co_leader_principal_read ON public.occurrence_partners USING (EXISTS ( SELECT 1
   FROM public.occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT public.vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids)))));

drop function if exists public.ocorrencias_visiveis_ids();
drop function if exists public.ocorrencias_coleader_leitura_ids();

-- conferência: as 4 policies voltaram ao md5 de produção de 20/10
do $c$
begin
  perform set_config('search_path', 'public', true);
  if (select count(*) from pg_policies where schemaname = 'public' and (tablename, policyname, md5(qual)) in (
        ('occurrence_commissions', 'occ_comm_view', '809c45075ce645d3bed1fd97b2efda35'),
        ('occurrence_commissions', 'occurrence_commissions_co_leader_principal_read', '983d14cae93ec3aa59585a196fbb2359'),
        ('occurrence_partners', 'occ_part_view', 'cf7933020f475f18eb93e7ac153ab3bc'),
        ('occurrence_partners', 'occurrence_partners_co_leader_principal_read', '2df6f5f83e1c53dc7238f33665708756'))) <> 4 then
    raise exception 'desfazer: policies não voltaram ao texto de produção de 20/10';
  end if;
end $c$;
commit;
