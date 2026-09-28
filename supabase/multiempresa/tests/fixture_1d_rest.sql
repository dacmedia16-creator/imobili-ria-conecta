-- Fixture SINTÉTICA do ensaio 1d via PostgREST local (persistente até fixture_1d_rest_cleanup.sql).
-- Agência A = legado Única Escolha; agência B criada aqui. UUIDs com prefixo 3d.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('3d000000-0000-4000-8000-0000000000b0','mt-rest-b','Agencia B REST');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('3d000000-0000-4000-8000-00000000a001','rest-a-gestor@example.test','{"nome":"A Gestor"}','{"organization_id":"00000000-0000-4000-8000-000000000001"}'),
 ('3d000000-0000-4000-8000-00000000a002','rest-a-corretor@example.test','{"nome":"A Corretor"}','{"organization_id":"00000000-0000-4000-8000-000000000001"}'),
 ('3d000000-0000-4000-8000-00000000a003','rest-a-fin@example.test','{"nome":"A Fin"}','{"organization_id":"00000000-0000-4000-8000-000000000001"}'),
 ('3d000000-0000-4000-8000-00000000b001','rest-b-gestor@example.test','{"nome":"B Gestor"}','{"organization_id":"3d000000-0000-4000-8000-0000000000b0"}'),
 ('3d000000-0000-4000-8000-00000000b002','rest-b-corretor@example.test','{"nome":"B Corretor"}','{"organization_id":"3d000000-0000-4000-8000-0000000000b0"}'),
 ('3d000000-0000-4000-8000-00000000b003','rest-b-fin@example.test','{"nome":"B Fin"}','{"organization_id":"3d000000-0000-4000-8000-0000000000b0"}');
-- Telefones sintéticos: A = 1599991xxx, B = 1599992xxx (xxx = 3 últimos dígitos do id).
UPDATE public.profiles
   SET telefone = CASE WHEN organization_id = '00000000-0000-4000-8000-000000000001'
                       THEN '1599991' ELSE '1599992' END || right(id::text, 3)
 WHERE id::text LIKE '3d000000%';
INSERT INTO public.user_roles(user_id,role) VALUES
 ('3d000000-0000-4000-8000-00000000a001','gestor'),
 ('3d000000-0000-4000-8000-00000000a003','financeiro'),
 ('3d000000-0000-4000-8000-00000000a003','juridico'),
 ('3d000000-0000-4000-8000-00000000b001','gestor'),
 ('3d000000-0000-4000-8000-00000000b003','financeiro'),
 ('3d000000-0000-4000-8000-00000000b003','juridico');
INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
 ('3d0a0000-0000-4000-8000-00000000000a','3d000000-0000-4000-8000-00000000a001','Equipe A REST','00000000-0000-4000-8000-000000000001'),
 ('3d0a0000-0000-4000-8000-00000000000b','3d000000-0000-4000-8000-00000000b001','Equipe B REST','3d000000-0000-4000-8000-0000000000b0');
INSERT INTO public.team_members(team_id,membro_id,tipo) VALUES
 ('3d0a0000-0000-4000-8000-00000000000a','3d000000-0000-4000-8000-00000000a002','corretor'),
 ('3d0a0000-0000-4000-8000-00000000000b','3d000000-0000-4000-8000-00000000b002','corretor');
INSERT INTO public.sales(id,corretor_id,imovel_id,organization_id) VALUES
 ('3d050000-0000-4000-8000-00000000000a','3d000000-0000-4000-8000-00000000a002','REST-A','00000000-0000-4000-8000-000000000001'),
 ('3d050000-0000-4000-8000-00000000000b','3d000000-0000-4000-8000-00000000b002','REST-B','3d000000-0000-4000-8000-0000000000b0');
INSERT INTO public.sale_documents(id,sale_id,tipo,file_name) VALUES
 ('3d0d0000-0000-4000-8000-00000000000a','3d050000-0000-4000-8000-00000000000a','contrato','contrato-a.pdf'),
 ('3d0d0000-0000-4000-8000-00000000000b','3d050000-0000-4000-8000-00000000000b','contrato','contrato-b.pdf');
INSERT INTO public.room_reservations(id,room,reserved_date,start_time,end_time,responsible_id,
  responsible_name,purpose,participant_user_ids,organization_id) VALUES
 ('3d070000-0000-4000-8000-00000000000a','Barão Sala 4',current_date+5,'09:00','10:00',
  '3d000000-0000-4000-8000-00000000a002','A Corretor','Reunião de equipe',
  ARRAY['3d000000-0000-4000-8000-00000000a001']::uuid[],'00000000-0000-4000-8000-000000000001'),
 ('3d070000-0000-4000-8000-00000000000b','Barão Sala 4',current_date+5,'09:00','10:00',
  '3d000000-0000-4000-8000-00000000b002','B Corretor','Reunião de equipe',
  ARRAY['3d000000-0000-4000-8000-00000000b001']::uuid[],'3d000000-0000-4000-8000-0000000000b0');
COMMIT;
