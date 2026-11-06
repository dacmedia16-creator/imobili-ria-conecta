-- Teste do rodízio COM leads religado (dentro de transação, desfeito no fim)
begin;
update public.organization_modules set enabled = true where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c' and module='leads';
select 'proximo_rodizio_sem_exclusao', public.lead_rodizio_proximo('eb0a260a-db2f-4cbf-b031-f0c2aebb407c', null, '{}');
select 'proximo_rodizio_excluindo_reais', coalesce(public.lead_rodizio_proximo('eb0a260a-db2f-4cbf-b031-f0c2aebb407c', null,
  array['11111111-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000002']::uuid[])::text, 'NINGUEM (vai p/ banco)');
select 'ficticio_pode_ser_responsavel', count(*) filter (where public.lead_pode_ser_responsavel(id, 'eb0a260a-db2f-4cbf-b031-f0c2aebb407c'))
  from public.profiles where id::text like 'de30de30-%';
select 'processar_prazos', public.leads_processar_prazos();
select 'leads_com_ficticio_apos_prazos', count(*) from public.leads where responsavel_id::text like 'de30de30-%' or captador_id::text like 'de30de30-%';
rollback;
select 'activity_logs_tipos', string_agg(acao||'='||n, ' ') from (select coalesce(acao::text,'?') acao, count(*) n from public.activity_logs group by 1) x;
