-- gerado por gen_matriz.py; requer temp table equiv
grant all on equiv to authenticated;
reset role;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000001','role','authenticated')::text, true), set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('10000000-0000-4000-8000-000000000001'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'admin+corretor', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','7dd997f7-2021-43ea-af9c-e758b826fcfd','role','authenticated')::text, true), set_config('request.jwt.claim.sub','7dd997f7-2021-43ea-af9c-e758b826fcfd', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('7dd997f7-2021-43ea-af9c-e758b826fcfd'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'admin', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','0a321807-c739-4b26-89e7-6e6fdef00297','role','authenticated')::text, true), set_config('request.jwt.claim.sub','0a321807-c739-4b26-89e7-6e6fdef00297', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('0a321807-c739-4b26-89e7-6e6fdef00297'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'super_admin', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed','role','authenticated')::text, true), set_config('request.jwt.claim.sub','b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'financeiro', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','cab7391a-463f-4d97-b99b-ced6e4696796','role','authenticated')::text, true), set_config('request.jwt.claim.sub','cab7391a-463f-4d97-b99b-ced6e4696796', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('cab7391a-463f-4d97-b99b-ced6e4696796'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'gestor_A', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000002','role','authenticated')::text, true), set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('10000000-0000-4000-8000-000000000002'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'gestor_B+corretor', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','d0000000-0000-4000-8000-0000000000a4','role','authenticated')::text, true), set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-0000000000a4', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('d0000000-0000-4000-8000-0000000000a4'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'co_lider', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','ebffaded-075c-493f-89e2-1d3d62901dc4','role','authenticated')::text, true), set_config('request.jwt.claim.sub','ebffaded-075c-493f-89e2-1d3d62901dc4', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('ebffaded-075c-493f-89e2-1d3d62901dc4'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'corretor_1', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','b316b223-da46-4c2c-9952-25096d5ae5ff','role','authenticated')::text, true), set_config('request.jwt.claim.sub','b316b223-da46-4c2c-9952-25096d5ae5ff', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('b316b223-da46-4c2c-9952-25096d5ae5ff'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'corretor_2', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000003','role','authenticated')::text, true), set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('10000000-0000-4000-8000-000000000003'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'corretor_liderado', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','d0000000-0000-4000-8000-0000000000a1','role','authenticated')::text, true), set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('d0000000-0000-4000-8000-0000000000a1'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'juridico', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','d0000000-0000-4000-8000-0000000000a2','role','authenticated')::text, true), set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-0000000000a2', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('d0000000-0000-4000-8000-0000000000a2'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'sem_papel', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','d0000000-0000-4000-8000-0000000000a3','role','authenticated')::text, true), set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-0000000000a3', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('d0000000-0000-4000-8000-0000000000a3'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'inativo', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','b3144521-7e3b-4f48-a1e0-29d90fd3f536','role','authenticated')::text, true), set_config('request.jwt.claim.sub','b3144521-7e3b-4f48-a1e0-29d90fd3f536', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('b3144521-7e3b-4f48-a1e0-29d90fd3f536'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'outra_imob_admin', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
select set_config('request.jwt.claims', json_build_object('sub','23e65aaf-2614-463e-baec-cf562bb94244','role','authenticated')::text, true), set_config('request.jwt.claim.sub','23e65aaf-2614-463e-baec-cf562bb94244', true);
set local role authenticated;
insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('23e65aaf-2614-463e-baec-cf562bb94244'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), 'outra_imob_corretor', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);
reset role;
