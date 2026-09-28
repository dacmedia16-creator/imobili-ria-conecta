-- Ensaio 2c: página pública de Especialistas depois da 1b.
-- Visitante anônimo vê só a agência histórica; usuário logado vê só a própria agência; nunca mistura.
-- Tudo em transação + ROLLBACK; nenhuma linha persiste.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_2c_test;
CREATE TABLE mt_2c_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA mt_2c_test TO service_role, authenticated, anon;
GRANT ALL ON mt_2c_test.results TO service_role, authenticated, anon;
GRANT ALL ON SEQUENCE mt_2c_test.results_n_seq TO service_role, authenticated, anon;
CREATE FUNCTION mt_2c_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mt_2c_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION mt_2c_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
CREATE FUNCTION mt_2c_test.as_anon() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM set_config('role','anon',true); END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_2c_test TO service_role, authenticated, anon;

-- ---------- Preparação (dados sintéticos) ----------
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('2c000000-0000-4000-8000-0000000000b0','mt-2c-b','Agencia B 2c');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('2c000000-0000-4000-8000-0000000000a1','a2c.corretor@example.test','{"nome":"Zz2c Corretor A"}','{}'),
 ('2c000000-0000-4000-8000-0000000000b1','b2c.corretor@example.test','{"nome":"Zz2c Corretor B"}','{"organization_id":"2c000000-0000-4000-8000-0000000000b0"}');
INSERT INTO public.positioning_regions(id, organization_id, cidade, zona, nome, tipo) VALUES
 (920001,'00000000-0000-4000-8000-000000000001','Cidade2c','Zona','Bairro2c A','bairro'),
 (920002,'2c000000-0000-4000-8000-0000000000b0','Cidade2c','Zona','Bairro2c B','bairro');
INSERT INTO public.corretor_positioning_regions(corretor_id, region_id) VALUES
 ('2c000000-0000-4000-8000-0000000000a1',920001),
 ('2c000000-0000-4000-8000-0000000000b1',920002);

-- ---------- Estrutura ----------
SELECT mt_2c_test.check('RPCs publicas voltaram ao dono original (nao mt_1b_definer)',
 NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('list_public_specialists','list_public_positioning_regions')
   AND proowner::regrole::text = 'mt_1b_definer'));
SELECT mt_2c_test.check('mt_2c_public_org nao e SECURITY INVOKER sem search_path',
 EXISTS (SELECT 1 FROM pg_proc WHERE proname='mt_2c_public_org' AND prosecdef AND proconfig IS NOT NULL));

-- ---------- Visitante anônimo ----------
SELECT mt_2c_test.as_anon();
SELECT mt_2c_test.check('anonimo: ve especialista da agencia historica',
 EXISTS (SELECT 1 FROM public.list_public_specialists(NULL,NULL) WHERE id='2c000000-0000-4000-8000-0000000000a1'));
SELECT mt_2c_test.check('anonimo: NAO ve especialista da agencia B',
 NOT EXISTS (SELECT 1 FROM public.list_public_specialists(NULL,NULL) WHERE id='2c000000-0000-4000-8000-0000000000b1'));
SELECT mt_2c_test.check('anonimo: busca por nome nao vaza B',
 (SELECT count(*) FROM public.list_public_specialists('Zz2c',NULL)) = 1);
SELECT mt_2c_test.check('anonimo: filtro por regiao de B devolve vazio',
 (SELECT count(*) FROM public.list_public_specialists(NULL,920002)) = 0);
SELECT mt_2c_test.check('anonimo: regioes so da agencia historica',
 EXISTS (SELECT 1 FROM public.list_public_positioning_regions() WHERE id=920001)
 AND NOT EXISTS (SELECT 1 FROM public.list_public_positioning_regions() WHERE id=920002));
SELECT mt_2c_test.check('anonimo: contagem de corretores da regiao A = 1',
 (SELECT corretores FROM public.list_public_positioning_regions() WHERE id=920001) = 1);
RESET ROLE;

-- ---------- Usuário logado da agência B ----------
SELECT mt_2c_test.as_user('2c000000-0000-4000-8000-0000000000b1');
SELECT mt_2c_test.check('B logado: ve especialista de B',
 EXISTS (SELECT 1 FROM public.list_public_specialists(NULL,NULL) WHERE id='2c000000-0000-4000-8000-0000000000b1'));
SELECT mt_2c_test.check('B logado: NAO ve especialista da agencia historica',
 NOT EXISTS (SELECT 1 FROM public.list_public_specialists(NULL,NULL) WHERE id='2c000000-0000-4000-8000-0000000000a1'));
SELECT mt_2c_test.check('B logado: regioes so de B',
 (SELECT array_agg(id) FROM public.list_public_positioning_regions()) = ARRAY[920002::bigint]);
RESET ROLE;

-- ---------- Usuário logado da agência histórica ----------
SELECT mt_2c_test.as_user('2c000000-0000-4000-8000-0000000000a1');
SELECT mt_2c_test.check('A logado: nao ve B',
 NOT EXISTS (SELECT 1 FROM public.list_public_specialists(NULL,NULL) WHERE id='2c000000-0000-4000-8000-0000000000b1'));
RESET ROLE;

-- ---------- Agência histórica suspensa: visitante não vê ninguém (falha fechada) ----------
UPDATE public.organizations SET status='suspensa' WHERE id='00000000-0000-4000-8000-000000000001';
SELECT mt_2c_test.as_anon();
SELECT mt_2c_test.check('sem agencia publica resolvida: nada listado',
 (SELECT count(*) FROM public.list_public_specialists(NULL,NULL)) = 0
 AND (SELECT count(*) FROM public.list_public_positioning_regions()) = 0);
RESET ROLE;
SELECT set_config('request.jwt.claims','',true);

SELECT 'FALHA: ' || label FROM mt_2c_test.results WHERE NOT ok ORDER BY n;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM mt_2c_test.results;
ROLLBACK;
