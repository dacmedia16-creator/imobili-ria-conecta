begin;
select 'md5_antes', md5(string_agg(id::text||coalesce(responsavel_id::text,'-')||etapa||coalesce(no_banco_desde::text,'-'), ',' order by id)) from public.leads;
select 'processar_prazos_leads_off', public.leads_processar_prazos();
select 'md5_depois', md5(string_agg(id::text||coalesce(responsavel_id::text,'-')||etapa||coalesce(no_banco_desde::text,'-'), ',' order by id)) from public.leads;
rollback;
