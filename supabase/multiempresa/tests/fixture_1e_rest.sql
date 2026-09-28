-- Fixture SINTÉTICA do ensaio 1e via PostgREST local (persistente até fixture_1e_rest_cleanup.sql).
-- Agência A = legado Única Escolha; agência B criada aqui. UUIDs com prefixo 3e.
-- A: super admin, admin, gestor (lidera corretor A1), corretor A1, corretor A2 (sem equipe), admin A2.
-- B: admin, corretor.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('3e000000-0000-4000-8000-0000000000b0','mt-rest-1e-b','Agencia B REST 1e');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('3e000000-0000-4000-8000-00000000a000','rest1e-a-super@example.test','{"nome":"A Super"}','{"organization_id":"00000000-0000-4000-8000-000000000001"}'),
 ('3e000000-0000-4000-8000-00000000a001','rest1e-a-admin@example.test','{"nome":"A Admin"}','{"organization_id":"00000000-0000-4000-8000-000000000001"}'),
 ('3e000000-0000-4000-8000-00000000a002','rest1e-a-gestor@example.test','{"nome":"A Gestor"}','{"organization_id":"00000000-0000-4000-8000-000000000001"}'),
 ('3e000000-0000-4000-8000-00000000a003','rest1e-a-cor1@example.test','{"nome":"A Corretor1"}','{"organization_id":"00000000-0000-4000-8000-000000000001"}'),
 ('3e000000-0000-4000-8000-00000000a004','rest1e-a-cor2@example.test','{"nome":"A Corretor2"}','{"organization_id":"00000000-0000-4000-8000-000000000001"}'),
 ('3e000000-0000-4000-8000-00000000a005','rest1e-a-admin2@example.test','{"nome":"A Admin2"}','{"organization_id":"00000000-0000-4000-8000-000000000001"}'),
 ('3e000000-0000-4000-8000-00000000b001','rest1e-b-admin@example.test','{"nome":"B Admin"}','{"organization_id":"3e000000-0000-4000-8000-0000000000b0"}'),
 ('3e000000-0000-4000-8000-00000000b002','rest1e-b-cor@example.test','{"nome":"B Corretor"}','{"organization_id":"3e000000-0000-4000-8000-0000000000b0"}');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('3e000000-0000-4000-8000-00000000a000','super_admin'),
 ('3e000000-0000-4000-8000-00000000a001','admin'),
 ('3e000000-0000-4000-8000-00000000a002','gestor'),
 ('3e000000-0000-4000-8000-00000000a005','admin'),
 ('3e000000-0000-4000-8000-00000000b001','admin');
INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
 ('3e0a0000-0000-4000-8000-00000000000a','3e000000-0000-4000-8000-00000000a002','Equipe A REST 1e','00000000-0000-4000-8000-000000000001');
INSERT INTO public.team_members(team_id,membro_id,tipo) VALUES
 ('3e0a0000-0000-4000-8000-00000000000a','3e000000-0000-4000-8000-00000000a003','corretor');
COMMIT;
