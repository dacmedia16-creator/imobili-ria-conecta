-- POC t_6d8e1a3d — massa SINTÉTICA no homolog, dentro de transação que termina em ROLLBACK.
-- Variáveis psql: :n_a (vendas extras na Agência A), :n_orgs (imobiliárias sintéticas extras), :n_per (vendas por imobiliária extra)
set local session_replication_role = replica;  -- só para semear (FK/gatilhos desligados); volta a origin antes de medir

-- usuários sintéticos para a matriz (juridico, sem papel, inativo, co-líder)
insert into public.profiles (id, nome, ativo, organization_id) values
 ('d0000000-0000-4000-8000-0000000000a1','POC juridico',true,'00000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-0000000000a2','POC sem papel',true,'00000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-0000000000a3','POC inativo',false,'00000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-0000000000a4','POC co-lider',true,'00000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, ativo)
 select '00000000-0000-4000-8000-000000000001', id, true from public.profiles where id::text like 'd0000000-%';
insert into public.user_roles (user_id, role, organization_id) values
 ('d0000000-0000-4000-8000-0000000000a1','juridico','00000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-0000000000a3','corretor','00000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-0000000000a4','team_leader','00000000-0000-4000-8000-000000000001');
insert into public.team_co_leaders (team_id, user_id, organization_id)
 values ('ca3efa47-cbae-4e72-995e-f54fcb86f1d9','d0000000-0000-4000-8000-0000000000a4','00000000-0000-4000-8000-000000000001');
insert into public.sale_juridico_reached (sale_id, organization_id)
 select id, organization_id from public.sales where false; -- (estrutura conferida; preenchido abaixo)

create temp table seed_plan (org uuid, n int, corretores uuid[], lideres uuid[]) on commit drop;
insert into seed_plan values
 ('00000000-0000-4000-8000-000000000001', :n_a,
  array['ebffaded-075c-493f-89e2-1d3d62901dc4','b316b223-da46-4c2c-9952-25096d5ae5ff','10000000-0000-4000-8000-000000000003',
        'a742cfda-4731-4fa8-989a-374d2fdf0820','5745cbff-22b6-4a28-a515-dd6706504b8b','10000000-0000-4000-8000-000000000001',
        'cab7391a-463f-4d97-b99b-ced6e4696796','10000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-0000000000a3']::uuid[],
  array['cab7391a-463f-4d97-b99b-ced6e4696796','10000000-0000-4000-8000-000000000002']::uuid[]),
 ('2a000000-0000-4000-8000-0000000000b0', 30,
  array['23e65aaf-2614-463e-baec-cf562bb94244','4996f8c5-3b3d-4ea6-9f5b-671b79941a7e']::uuid[],
  array['4996f8c5-3b3d-4ea6-9f5b-671b79941a7e']::uuid[]);
insert into seed_plan
 select gen_random_uuid(), :n_per, array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()], array[gen_random_uuid()]
 from generate_series(1, :n_orgs);

create temp table ss on commit drop as
select gen_random_uuid() id, p.org, i,
  p.corretores[1 + (i % cardinality(p.corretores))] c1,
  p.corretores[1 + ((i*7+3) % cardinality(p.corretores))] c2,
  case when i % 4 <> 0 then p.lideres[1 + (i % cardinality(p.lideres))] end l1,
  p.lideres[1 + ((i+1) % cardinality(p.lideres))] g1,
  case when i % 7 = 0 then 'lancamento' else 'padrao' end modal,
  (case i % 10 when 0 then 'ocorrencia_pendente' when 1 then 'ocorrencia_analise_financeiro' when 6 then 'ocorrencia_devolvida_gestor'
     when 7 then 'contrato_conferencia_gestor' when 8 then 'rascunho' when 9 then 'contrato_assinado' else 'ocorrencia_concluida' end)::public.sale_status st,
  (300000 + (i*137731 % 900000))::numeric vn,
  now() - ((i*37 % 365) || ' days')::interval - ((i % 23) || ' hours')::interval ca
from seed_plan p, generate_series(1, p.n) i;
alter table ss add column c numeric; update ss set c = round(vn*0.06, 2);

insert into public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_vendedor_id, lider_captador_id, lider_vendedor_id,
  status, modalidade, imovel_id, codigo_interno, valor_negociado, percentual_comissao, valor_total_comissao,
  percentual_remax, valor_remax, valor_comissao_captador, valor_comissao_vendedor, valor_comissao_lider_captador, valor_comissao_lider_vendedor,
  indicador_captador_id, indicador_captador, valor_comissao_indicador_captador, parceria_tipo, parceria_valor, parceria_nome,
  valor_comissao_imobiliaria, data_assinatura, premio_valor, created_at, updated_at)
select id, org, c1,
  case when modal='padrao' then c1 end, case when modal='padrao' then c2 end,
  case when modal='padrao' then l1 end, case when modal='padrao' and i % 3 = 1 then g1 end,
  st, modal, 'POC-'||left(org::text,4)||'-'||i, 'POC'||i, vn, 6, c,
  case when modal='padrao' and i % 3 <> 0 then 4.2 end, case when modal='padrao' and i % 3 <> 0 then round(c*0.7,2) end,
  case when modal='padrao' then round(c*0.2,2) end, case when modal='padrao' then round(c*0.2,2) end,
  case when modal='padrao' and l1 is not null then round(c*0.02,2) end, case when modal='padrao' and i % 3 = 1 then round(c*0.015,2) end,
  case when modal='padrao' and i % 9 = 0 then c2 end, case when modal='padrao' and i % 9 = 0 then 'Indicador POC' end,
  case when modal='padrao' and i % 9 = 0 then round(c*0.02,2) end,
  case when i % 6 = 0 then 'imobiliaria_externa' end, case when i % 6 = 0 then round(c*0.1,2) end, case when i % 6 = 0 then 'Parceira POC' end,
  case when modal='padrao' and i % 3 = 0 then round(c*0.5,2) end,
  case when modal='lancamento' and i % 2 = 0 then (ca + interval '10 days')::date end,
  case when modal='lancamento' and i % 5 = 0 then 1000 end,
  ca, ca
from ss;

-- histórico (~10 linhas por venda, como em produção); evento oficial de assinatura/entrada no Financeiro
insert into public.sale_status_history (sale_id, de, para, autor_id, created_at, organization_id)
select id, 'rascunho', 'enviada_revisao', c1, ca + (k || ' hours')::interval, org from ss, generate_series(1,8) k where st <> 'rascunho';
insert into public.sale_status_history (sale_id, de, para, autor_id, created_at, organization_id)
select id, 'aguardando_assinatura', 'contrato_assinado', c1, ca + interval '10 days' + ((i % 5) || ' hours')::interval, org
from ss where st not in ('rascunho','contrato_conferencia_gestor');
insert into public.sale_status_history (sale_id, de, para, autor_id, created_at, organization_id)
select id, 'ocorrencia_pendente', 'ocorrencia_analise_financeiro', c1, ca + interval '12 days', org
from ss where st::text like 'ocorrencia%' and st <> 'ocorrencia_pendente';
insert into public.sale_juridico_reached (sale_id, organization_id) select id, org from ss where st not in ('rascunho');

-- ocorrência + comissões (gerenciadas, manuais e sem cadastro) + parceiros
create temp table so on commit drop as
select gen_random_uuid() oid_, ss.* from ss where st::text like 'ocorrencia%';
insert into public.occurrences (id, sale_id, status, valor_negociado, valor_comissao, percentual_comissao, organization_id, created_at)
select oid_, id, case when st='ocorrencia_concluida' then 'concluida' else 'pendente' end, vn, c, 6, org, ca + interval '11 days' from so;
insert into public.occurrence_commissions (occurrence_id, papel, user_id, valor, managed_by_sale, sem_cadastro_confirmado, organization_id)
select oid_, 'corretor_captador', c1, round(c*0.2,2), true, false, org from so
union all select oid_, 'corretor_vendedor', c2, round(c*0.2,2), true, false, org from so
union all select oid_, 'lider_captador', l1, round(c*0.02,2), true, false, org from so where l1 is not null
union all select oid_, 'outro', null, 500, false, false, org from so where i % 5 = 0
union all select oid_, 'outro', null, 300, false, true, org from so where i % 8 = 0;
insert into public.occurrence_partners (occurrence_id, nome, valor, tipo, from_sale, organization_id)
select oid_, 'Parceira POC', round(c*0.1,2), 'imobiliaria_externa', true, org from so where i % 6 = 0;

-- extras da divisão de comissão
insert into public.sale_commission_extras (sale_id, nome, papel, origem, lado, user_id, valor, sem_cadastro_confirmado, organization_id)
select id, 'Gestor POC', 'gestor', 'imobiliaria', 'captador', g1, round(c*0.01,2), false, org from ss where modal='padrao' and i % 2 = 0
union all select id, 'Corretor extra POC', 'corretor_vendedor', 'vendedor', null, c1, round(c*0.01,2), false, org from ss where modal='padrao' and i % 5 = 0
union all select id, 'Coord POC', 'coordenador_lancamento', 'imobiliaria', null, g1, round(c*0.3,2), false, org from ss where modal='lancamento'
union all select id, 'Vend lanc POC', 'corretor_vendedor', 'imobiliaria', null, c2, round(c*0.3,2), false, org from ss where modal='lancamento'
union all select id, 'Externo POC', 'outro', 'imobiliaria', null, null, 200, true, org from ss where modal='lancamento' and i % 3 = 0;

-- filhas usadas só pela matriz de permissão
insert into public.sale_parties (sale_id, papel, organization_id) select id, 'comprador', org from ss where i <= 60;
insert into public.sale_payment (sale_id, organization_id) select id, org from ss where i <= 60;
insert into public.sale_documents (sale_id, tipo, organization_id) select id, 'outro', org from ss where i <= 60;
insert into public.sale_comments (sale_id, autor_id, texto, organization_id) select id, c1, 'poc', org from ss where i <= 60;
insert into public.activity_logs (acao, organization_id, sale_id) select 'poc', org, id from ss where i <= 60;

set local session_replication_role = origin;
analyze public.sales; analyze public.sale_status_history; analyze public.occurrences; analyze public.occurrence_commissions;
analyze public.occurrence_partners; analyze public.sale_commission_extras; analyze public.profiles; analyze public.user_roles;
select (select count(*) from public.sales) vendas_total,
       (select count(*) from public.sales where organization_id='00000000-0000-4000-8000-000000000001') vendas_org_a,
       (select count(distinct organization_id) from public.sales) orgs_com_venda,
       (select count(*) from public.sale_status_history) hist, (select count(*) from public.occurrences) occ,
       (select count(*) from public.occurrence_commissions) occ_comm, (select count(*) from public.sale_commission_extras) extras;
