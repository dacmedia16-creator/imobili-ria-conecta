-- Ensaio 1e no clone: matriz papel × ação × agência NO BANCO (RLS, grants, gatilhos, RPCs).
-- Atores: super-admin da plataforma (Denis), admin A, gestor A, corretor A, admin B; e o servidor
-- (service_role). A = Única Escolha (legado, seed 10xx); B = agência sintética criada por Denis.
-- Tudo em transação + ROLLBACK; nenhuma linha persiste.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_1e_test;
CREATE TABLE mt_1e_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA mt_1e_test TO service_role, authenticated;
GRANT ALL ON mt_1e_test.results TO service_role, authenticated;
GRANT ALL ON SEQUENCE mt_1e_test.results_n_seq TO service_role, authenticated;
CREATE FUNCTION mt_1e_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mt_1e_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION mt_1e_test.try(query text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN EXECUTE query; GET DIAGNOSTICS n=ROW_COUNT; RETURN 'ok:'||n;
 EXCEPTION WHEN OTHERS THEN RETURN 'erro:'||SQLSTATE; END $$;
CREATE FUNCTION mt_1e_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
CREATE FUNCTION mt_1e_test.as_service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true); END $$;
CREATE FUNCTION mt_1e_test.done() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims','',true); END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_1e_test TO service_role, authenticated;

-- ---------- Preparação (dono do banco) ----------
-- A: admin 10..01, gestor 10..02 (lidera equipe com corretor 10..03), corretor 10..03.
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('e0000000-0000-4000-8000-00000000000d','denis.1e@example.test','{"nome":"Denis Plataforma"}','{}');
INSERT INTO public.platform_admins(user_id) VALUES ('e0000000-0000-4000-8000-00000000000d');
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('be000000-0000-4000-8000-0000000000b0','mt-1e-b','Agencia B 1e');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('e0000000-0000-4000-8000-0000000000b1','b1e.admin@example.test','{"nome":"B Admin"}','{"organization_id":"be000000-0000-4000-8000-0000000000b0"}'),
 ('e0000000-0000-4000-8000-0000000000b2','b1e.corretor@example.test','{"nome":"B Corretor"}','{"organization_id":"be000000-0000-4000-8000-0000000000b0"}');
INSERT INTO public.user_roles(user_id,role) VALUES ('e0000000-0000-4000-8000-0000000000b1','admin');

-- ---------- Super-admin da plataforma (Denis) ----------
SELECT mt_1e_test.as_user('e0000000-0000-4000-8000-00000000000d');
SELECT mt_1e_test.check('plataforma: cria imobiliaria',
 mt_1e_test.try($$SELECT public.platform_create_organization('mt-1e-c','Agencia C 1e')$$)='ok:1');
SELECT mt_1e_test.check('plataforma: edita imobiliaria',
 mt_1e_test.try($$SELECT public.platform_update_organization('be000000-0000-4000-8000-0000000000b0','Agencia B Renomeada',NULL)$$)='ok:1');
SELECT mt_1e_test.check('plataforma: suspende imobiliaria B',
 mt_1e_test.try($$SELECT public.platform_set_organization_status('be000000-0000-4000-8000-0000000000b0','suspensa')$$)='ok:1');
SELECT mt_1e_test.check('plataforma: reativa imobiliaria B',
 mt_1e_test.try($$SELECT public.platform_set_organization_status('be000000-0000-4000-8000-0000000000b0','ativa')$$)='ok:1');
SELECT mt_1e_test.check('plataforma: nao suspende a agencia legada por engano',
 mt_1e_test.try($$SELECT public.platform_set_organization_status('00000000-0000-4000-8000-000000000001','suspensa')$$)='erro:42501');
SELECT mt_1e_test.check('plataforma: status invalido recusado',
 mt_1e_test.try($$SELECT public.platform_set_organization_status('be000000-0000-4000-8000-0000000000b0','apagada')$$)='erro:22023');
SELECT mt_1e_test.done(); RESET ROLE;
SELECT mt_1e_test.check('plataforma: edicao gravada',
 (SELECT nome FROM public.organizations WHERE id='be000000-0000-4000-8000-0000000000b0')='Agencia B Renomeada');

-- ---------- Admin A ----------
SELECT mt_1e_test.as_user('10000000-0000-4000-8000-000000000001');
SELECT mt_1e_test.check('admin A: nao cria imobiliaria',
 mt_1e_test.try($$SELECT public.platform_create_organization('mt-1e-x','X')$$)='erro:42501');
SELECT mt_1e_test.check('admin A: nao edita imobiliaria (RPC)',
 mt_1e_test.try($$SELECT public.platform_update_organization('00000000-0000-4000-8000-000000000001','Hack',NULL)$$)='erro:42501');
SELECT mt_1e_test.check('admin A: nao suspende imobiliaria (RPC)',
 mt_1e_test.try($$SELECT public.platform_set_organization_status('be000000-0000-4000-8000-0000000000b0','suspensa')$$)='erro:42501');
SELECT mt_1e_test.check('admin A: nao altera organizations direto',
 mt_1e_test.try($$UPDATE public.organizations SET status='suspensa'$$) LIKE 'erro:%');
SELECT mt_1e_test.check('admin A: nao move usuario para B (organization_members)',
 mt_1e_test.try($$UPDATE public.organization_members SET organization_id='be000000-0000-4000-8000-0000000000b0' WHERE user_id='10000000-0000-4000-8000-000000000003'$$) LIKE 'erro:%');
SELECT mt_1e_test.check('admin A: nao move usuario para B (profiles.organization_id)',
 mt_1e_test.try($$UPDATE public.profiles SET organization_id='be000000-0000-4000-8000-0000000000b0' WHERE id='10000000-0000-4000-8000-000000000003'$$) LIKE 'erro:%');
SELECT mt_1e_test.check('admin A: concede gestor a corretor A',
 mt_1e_test.try($$INSERT INTO public.user_roles(user_id,role) VALUES ('10000000-0000-4000-8000-000000000003','gestor')$$)='ok:1');
SELECT mt_1e_test.check('admin A: nao concede admin (so super admin da agencia)',
 mt_1e_test.try($$INSERT INTO public.user_roles(user_id,role) VALUES ('10000000-0000-4000-8000-000000000003','admin')$$)='erro:42501');
SELECT mt_1e_test.check('admin A: nao retira o proprio papel',
 mt_1e_test.try($$DELETE FROM public.user_roles WHERE user_id='10000000-0000-4000-8000-000000000001' AND role='admin'$$)='ok:0');
SELECT mt_1e_test.check('admin A: nao troca o proprio papel',
 mt_1e_test.try($$UPDATE public.user_roles SET role='super_admin' WHERE user_id='10000000-0000-4000-8000-000000000001' AND role='admin'$$) LIKE 'erro:%');
SELECT mt_1e_test.check('admin A: desativa corretor A',
 mt_1e_test.try($$UPDATE public.profiles SET ativo=false WHERE id='10000000-0000-4000-8000-000000000003'$$)='ok:1');
SELECT mt_1e_test.check('admin A: reativa corretor A',
 mt_1e_test.try($$UPDATE public.profiles SET ativo=true WHERE id='10000000-0000-4000-8000-000000000003'$$)='ok:1');
SELECT mt_1e_test.check('admin A: nao ve nem desativa admin B',
 mt_1e_test.try($$UPDATE public.profiles SET ativo=false WHERE id='e0000000-0000-4000-8000-0000000000b1'$$)='ok:0');
SELECT mt_1e_test.check('admin A: nao concede papel a usuario de B',
 mt_1e_test.try($$INSERT INTO public.user_roles(user_id,role) VALUES ('e0000000-0000-4000-8000-0000000000b2','gestor')$$) LIKE 'erro:%');
SELECT mt_1e_test.done(); RESET ROLE;
SELECT mt_1e_test.check('admin A: papel proprio preservado',
 EXISTS (SELECT 1 FROM public.user_roles WHERE user_id='10000000-0000-4000-8000-000000000001' AND role='admin'));
DELETE FROM public.user_roles WHERE user_id='10000000-0000-4000-8000-000000000003' AND role='gestor';

-- ---------- Gestor A ----------
SELECT mt_1e_test.as_user('10000000-0000-4000-8000-000000000002');
SELECT mt_1e_test.check('gestor A: nao cria imobiliaria',
 mt_1e_test.try($$SELECT public.platform_create_organization('mt-1e-y','Y')$$)='erro:42501');
SELECT mt_1e_test.check('gestor A: nao promove corretor a admin',
 mt_1e_test.try($$INSERT INTO public.user_roles(user_id,role) VALUES ('10000000-0000-4000-8000-000000000003','admin')$$)='erro:42501');
SELECT mt_1e_test.check('gestor A: nao concede outros papeis direto',
 mt_1e_test.try($$INSERT INTO public.user_roles(user_id,role) VALUES ('10000000-0000-4000-8000-000000000003','gestor')$$)='erro:42501');
SELECT mt_1e_test.check('gestor A: nao altera o proprio papel',
 mt_1e_test.try($$UPDATE public.user_roles SET role='admin' WHERE user_id='10000000-0000-4000-8000-000000000002' AND role='gestor'$$) LIKE 'erro:%');
SELECT mt_1e_test.check('gestor A: nao se concede admin',
 mt_1e_test.try($$INSERT INTO public.user_roles(user_id,role) VALUES ('10000000-0000-4000-8000-000000000002','admin')$$)='erro:42501');
SELECT mt_1e_test.check('gestor A: desativacao direta no banco nao passa (so via servidor)',
 mt_1e_test.try($$UPDATE public.profiles SET ativo=false WHERE id='10000000-0000-4000-8000-000000000003'$$)='ok:0');
SELECT mt_1e_test.check('gestor A: nao move usuario entre agencias',
 mt_1e_test.try($$UPDATE public.organization_members SET organization_id='be000000-0000-4000-8000-0000000000b0' WHERE user_id='10000000-0000-4000-8000-000000000003'$$) LIKE 'erro:%');
SELECT mt_1e_test.check('gestor A: nao ve usuarios de B',
 (SELECT count(*) FROM public.profiles WHERE organization_id='be000000-0000-4000-8000-0000000000b0')=0);
SELECT mt_1e_test.done(); RESET ROLE;

-- ---------- Corretor A ----------
SELECT mt_1e_test.as_user('10000000-0000-4000-8000-000000000003');
SELECT mt_1e_test.check('corretor A: nao cria imobiliaria',
 mt_1e_test.try($$SELECT public.platform_create_organization('mt-1e-z','Z')$$)='erro:42501');
SELECT mt_1e_test.check('corretor A: nao concede papel',
 mt_1e_test.try($$INSERT INTO public.user_roles(user_id,role) VALUES ('10000000-0000-4000-8000-000000000003','gestor')$$)='erro:42501');
SELECT mt_1e_test.check('corretor A: nao troca o proprio papel',
 mt_1e_test.try($$UPDATE public.user_roles SET role='admin' WHERE user_id='10000000-0000-4000-8000-000000000003'$$) LIKE 'erro:%');
SELECT mt_1e_test.check('corretor A: nao desativa outro usuario',
 mt_1e_test.try($$UPDATE public.profiles SET ativo=false WHERE id='10000000-0000-4000-8000-000000000002'$$)='ok:0');
SELECT mt_1e_test.check('corretor A: nao desativa a si mesmo',
 mt_1e_test.try($$UPDATE public.profiles SET ativo=false WHERE id='10000000-0000-4000-8000-000000000003'$$) LIKE 'erro:%');
SELECT mt_1e_test.done(); RESET ROLE;

-- ---------- Admin B ----------
SELECT mt_1e_test.as_user('e0000000-0000-4000-8000-0000000000b1');
SELECT mt_1e_test.check('admin B: nao cria imobiliaria',
 mt_1e_test.try($$SELECT public.platform_create_organization('mt-1e-w','W')$$)='erro:42501');
SELECT mt_1e_test.check('admin B: nao suspende a agencia A',
 mt_1e_test.try($$SELECT public.platform_set_organization_status('00000000-0000-4000-8000-000000000001','suspensa')$$)='erro:42501');
SELECT mt_1e_test.check('admin B: nao desativa usuario de A',
 mt_1e_test.try($$UPDATE public.profiles SET ativo=false WHERE id='10000000-0000-4000-8000-000000000003'$$)='ok:0');
SELECT mt_1e_test.check('admin B: nao concede papel a usuario de A',
 mt_1e_test.try($$INSERT INTO public.user_roles(user_id,role) VALUES ('10000000-0000-4000-8000-000000000003','gestor')$$) LIKE 'erro:%');
SELECT mt_1e_test.check('admin B: nao remove papel de usuario de A',
 mt_1e_test.try($$DELETE FROM public.user_roles WHERE user_id='10000000-0000-4000-8000-000000000002'$$)='ok:0');
SELECT mt_1e_test.check('admin B: nao ve usuarios de A',
 (SELECT count(*) FROM public.profiles WHERE organization_id='00000000-0000-4000-8000-000000000001')=0);
SELECT mt_1e_test.check('admin B: gerencia usuario da propria agencia (desativa corretor B)',
 mt_1e_test.try($$UPDATE public.profiles SET ativo=false WHERE id='e0000000-0000-4000-8000-0000000000b2'$$)='ok:1');
SELECT mt_1e_test.done(); RESET ROLE;
SELECT mt_1e_test.check('A intacto apos tentativas de B',
 (SELECT ativo FROM public.profiles WHERE id='10000000-0000-4000-8000-000000000003')
 AND (SELECT count(*) FROM public.user_roles WHERE user_id='10000000-0000-4000-8000-000000000002')=2);

-- ---------- Servidor (service_role) ----------
SELECT mt_1e_test.as_service();
SELECT mt_1e_test.check('servidor: nao move vinculo de agencia (UPDATE)',
 mt_1e_test.try($$UPDATE public.organization_members SET organization_id='be000000-0000-4000-8000-0000000000b0' WHERE user_id='10000000-0000-4000-8000-000000000003'$$)='erro:42501');
SELECT mt_1e_test.check('servidor: nao cria vinculo de usuario A em B',
 mt_1e_test.try($$INSERT INTO public.organization_members(organization_id,user_id) VALUES ('be000000-0000-4000-8000-0000000000b0','10000000-0000-4000-8000-000000000003')$$)='erro:42501');
SELECT mt_1e_test.check('servidor: nao troca profiles.organization_id',
 mt_1e_test.try($$UPDATE public.profiles SET organization_id='be000000-0000-4000-8000-0000000000b0' WHERE id='10000000-0000-4000-8000-000000000003'$$)='erro:42501');
SELECT mt_1e_test.check('servidor: desativa corretor (apos regra no servidor)',
 mt_1e_test.try($$UPDATE public.profiles SET ativo=false WHERE id='10000000-0000-4000-8000-000000000003' AND organization_id='00000000-0000-4000-8000-000000000001'$$)='ok:1');
SELECT mt_1e_test.check('servidor: papel de B marcado como A recusado',
 mt_1e_test.try($$INSERT INTO public.user_roles(user_id,role,organization_id) VALUES ('e0000000-0000-4000-8000-0000000000b2','gestor','00000000-0000-4000-8000-000000000001')$$)='erro:42501');
SELECT mt_1e_test.done(); RESET ROLE;

SELECT format('%s %s', CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END, label) FROM mt_1e_test.results ORDER BY n;
SELECT format('TOTAL=%s OK=%s FALHAS=%s', count(*), count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)) FROM mt_1e_test.results;
ROLLBACK;
