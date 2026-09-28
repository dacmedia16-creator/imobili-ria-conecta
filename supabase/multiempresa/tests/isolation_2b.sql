-- Ensaio 2b: cadastro de imobiliárias (dados cadastrais) e último acesso por agência.
-- Atores: super-admin da plataforma, admin A (Única Escolha) e admin B (agência sintética); servidor.
-- Tudo em transação + ROLLBACK; nenhuma linha persiste.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_2b_test;
CREATE TABLE mt_2b_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA mt_2b_test TO service_role, authenticated, anon;
GRANT ALL ON mt_2b_test.results TO service_role, authenticated, anon;
GRANT ALL ON SEQUENCE mt_2b_test.results_n_seq TO service_role, authenticated, anon;
CREATE FUNCTION mt_2b_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mt_2b_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION mt_2b_test.try(query text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN EXECUTE query; GET DIAGNOSTICS n=ROW_COUNT; RETURN 'ok:'||n;
 EXCEPTION WHEN OTHERS THEN RETURN 'erro:'||SQLSTATE; END $$;
CREATE FUNCTION mt_2b_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
CREATE FUNCTION mt_2b_test.as_service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true); END $$;
CREATE FUNCTION mt_2b_test.as_anon() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM set_config('role','anon',true); END $$;
CREATE FUNCTION mt_2b_test.done() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims','',true); END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_2b_test TO service_role, authenticated, anon;

-- ---------- Preparação ----------
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('2b000000-0000-4000-8000-0000000000b0','mt-2b-b','Agencia B 2b');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('2b000000-0000-4000-8000-00000000000d','denis.2b@example.test','{"nome":"Denis Plataforma"}','{}'),
 ('2b000000-0000-4000-8000-0000000000a1','a2b.admin@example.test','{"nome":"A Admin"}','{}'),
 ('2b000000-0000-4000-8000-0000000000b1','b2b.admin@example.test','{"nome":"B Admin"}','{"organization_id":"2b000000-0000-4000-8000-0000000000b0"}'),
 ('2b000000-0000-4000-8000-0000000000b2','b2b.corretor@example.test','{"nome":"B Corretor"}','{"organization_id":"2b000000-0000-4000-8000-0000000000b0"}');
INSERT INTO public.platform_admins(user_id) VALUES ('2b000000-0000-4000-8000-00000000000d');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('2b000000-0000-4000-8000-0000000000a1','admin'),('2b000000-0000-4000-8000-0000000000b1','admin');
UPDATE auth.users SET last_sign_in_at = now() WHERE id::text LIKE '2b000000-%';

-- ---------- Estrutura ----------
SELECT mt_2b_test.check('bucket organization-logos publico e limitado a imagens',
 EXISTS (SELECT 1 FROM storage.buckets WHERE id='organization-logos' AND public
   AND allowed_mime_types @> ARRAY['image/png']));
SELECT mt_2b_test.check('sem policy de usuario no bucket de logos (escrita so pelo servidor)',
 NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
   AND coalesce(qual,'')||coalesce(with_check,'') LIKE '%organization-logos%'));

-- ---------- Super-admin da plataforma ----------
SELECT mt_2b_test.as_user('2b000000-0000-4000-8000-00000000000d');
SELECT mt_2b_test.check('plataforma: grava CNPJ (normaliza pontuacao) e cores',
 mt_2b_test.try($$SELECT public.platform_update_organization_profile('2b000000-0000-4000-8000-0000000000b0','12.345.678/0001-90','#1A2B3C','#ffffff')$$)='ok:1');
SELECT mt_2b_test.check('plataforma: CNPJ invalido recusado',
 mt_2b_test.try($$SELECT public.platform_update_organization_profile('2b000000-0000-4000-8000-0000000000b0','123','#1a2b3c',NULL)$$)='erro:23514');
SELECT mt_2b_test.check('plataforma: cor invalida recusada',
 mt_2b_test.try($$SELECT public.platform_update_organization_profile('2b000000-0000-4000-8000-0000000000b0',NULL,'azul',NULL)$$)='erro:23514');
SELECT mt_2b_test.check('plataforma: CNPJ duplicado recusado',
 mt_2b_test.try($$SELECT public.platform_update_organization_profile('00000000-0000-4000-8000-000000000001','12345678000190',NULL,NULL)$$)='erro:23505');
SELECT mt_2b_test.check('plataforma: imobiliaria inexistente',
 mt_2b_test.try($$SELECT public.platform_update_organization_profile(gen_random_uuid(),NULL,NULL,NULL)$$)='erro:P0002');
SELECT mt_2b_test.check('plataforma: ve todas as imobiliarias',
 (SELECT count(*) FROM public.organizations WHERE id IN ('00000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-0000000000b0'))=2);
SELECT mt_2b_test.check('plataforma: nao le auth.users pela funcao do servidor',
 mt_2b_test.try($$SELECT * FROM public.mt_2b_org_auth_users('2b000000-0000-4000-8000-0000000000b0')$$)='erro:42501');
SELECT mt_2b_test.done(); RESET ROLE;
SELECT mt_2b_test.check('plataforma: dados gravados normalizados',
 (SELECT cnpj='12345678000190' AND cor_primaria='#1a2b3c' AND cor_secundaria='#ffffff'
    FROM public.organizations WHERE id='2b000000-0000-4000-8000-0000000000b0'));
SELECT mt_2b_test.check('logo_path fora do prefixo da agencia recusado',
 mt_2b_test.try($$UPDATE public.organizations SET logo_path='00000000-0000-4000-8000-000000000001/logo.png' WHERE id='2b000000-0000-4000-8000-0000000000b0'$$)='erro:23514');

-- ---------- Admin de agência ----------
SELECT mt_2b_test.as_user('2b000000-0000-4000-8000-0000000000a1');
SELECT mt_2b_test.check('admin A: nao edita dados cadastrais de imobiliaria',
 mt_2b_test.try($$SELECT public.platform_update_organization_profile('00000000-0000-4000-8000-000000000001','11222333000181',NULL,NULL)$$)='erro:42501');
SELECT mt_2b_test.check('admin A: nao cria imobiliaria',
 mt_2b_test.try($$SELECT public.platform_create_organization('mt-2b-x','X')$$)='erro:42501');
SELECT mt_2b_test.check('admin A: nao ve a agencia B',
 NOT EXISTS (SELECT 1 FROM public.organizations WHERE id='2b000000-0000-4000-8000-0000000000b0'));
SELECT mt_2b_test.check('admin A: nao altera organizations direto',
 mt_2b_test.try($$UPDATE public.organizations SET cnpj='11222333000181'$$) LIKE 'erro:%');
SELECT mt_2b_test.check('admin A: sem acesso a funcao de ultimo acesso',
 mt_2b_test.try($$SELECT * FROM public.mt_2b_org_auth_users('00000000-0000-4000-8000-000000000001')$$)='erro:42501');
SELECT mt_2b_test.done(); RESET ROLE;

SELECT mt_2b_test.as_user('2b000000-0000-4000-8000-0000000000b1');
SELECT mt_2b_test.check('admin B: nao edita a propria imobiliaria (so a plataforma)',
 mt_2b_test.try($$SELECT public.platform_update_organization_profile('2b000000-0000-4000-8000-0000000000b0',NULL,'#000000',NULL)$$)='erro:42501');
SELECT mt_2b_test.done(); RESET ROLE;

SELECT mt_2b_test.as_anon();
SELECT mt_2b_test.check('anonimo: sem EXECUTE na RPC cadastral',
 mt_2b_test.try($$SELECT public.platform_update_organization_profile('2b000000-0000-4000-8000-0000000000b0',NULL,NULL,NULL)$$)='erro:42501');
SELECT mt_2b_test.done(); RESET ROLE;

-- ---------- Servidor: último acesso por agência ----------
SELECT mt_2b_test.as_service();
SELECT mt_2b_test.check('servidor: ultimo acesso da agencia B traz so usuarios de B',
 (SELECT count(*) = 2 AND bool_and(user_id::text LIKE '2b000000-%-0000000000b%')
    FROM public.mt_2b_org_auth_users('2b000000-0000-4000-8000-0000000000b0')));
SELECT mt_2b_test.check('servidor: ultimo acesso da agencia A nao traz usuarios de B',
 NOT EXISTS (SELECT 1 FROM public.mt_2b_org_auth_users('00000000-0000-4000-8000-000000000001')
   WHERE user_id::text LIKE '2b000000-%-0000000000b%'));
SELECT mt_2b_test.check('servidor: agencia A inclui o admin A',
 EXISTS (SELECT 1 FROM public.mt_2b_org_auth_users('00000000-0000-4000-8000-000000000001')
   WHERE user_id='2b000000-0000-4000-8000-0000000000a1' AND last_sign_in_at IS NOT NULL));
SELECT mt_2b_test.done(); RESET ROLE;

SELECT format('%s %s', CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END, label) FROM mt_2b_test.results ORDER BY n;
SELECT format('TOTAL=%s OK=%s FALHAS=%s', count(*), count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)) FROM mt_2b_test.results;
ROLLBACK;
