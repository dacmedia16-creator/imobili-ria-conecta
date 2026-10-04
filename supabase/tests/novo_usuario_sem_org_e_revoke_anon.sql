-- Suíte da migration 20261004220000 (rodar SÓ em clone descartável; grava e limpa dados sintéticos).
-- Saída: linhas OK|... / FALHA|... e TOTAL=n FALHAS=m. Sem ON_ERROR_STOP: erros esperados são casos.
\pset pager off
\pset format unaligned
\pset tuples_only on
CREATE TEMP TABLE r(caso text, ok boolean, det text);
GRANT ALL ON r TO PUBLIC;
-- Organizações sintéticas (X ativa, S suspensa).
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('f1000000-0000-4000-8000-0000000000a1','teste-fix-x','Teste Fix X'),
 ('f1000000-0000-4000-8000-0000000000a2','teste-fix-s','Teste Fix S');
UPDATE public.organizations SET status='suspensa' WHERE id='f1000000-0000-4000-8000-0000000000a2';

-- 1. Sem organização (equivale ao cadastro público): recusado na confirmação da transação.
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
VALUES ('f2000000-0000-4000-8000-000000000001','fix-sem-org@example.test','{}','{"nome":"Sem Org"}');
INSERT INTO r SELECT '1 sem org recusado', count(*)=0, 'users='||count(*) FROM auth.users WHERE id='f2000000-0000-4000-8000-000000000001';
INSERT INTO r SELECT '1b sem org: nada na agencia legada', count(*)=0, 'members='||count(*) FROM public.organization_members WHERE user_id='f2000000-0000-4000-8000-000000000001';

-- 1c. organization_id vazio também é recusado.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES ('f2000000-0000-4000-8000-000000000007','fix-vazio@example.test','{"organization_id":""}');
INSERT INTO r SELECT '1c org vazio recusado', count(*)=0, 'users='||count(*) FROM auth.users WHERE id='f2000000-0000-4000-8000-000000000007';

-- 2. Padrão GoTrue createUser (tela Usuários e primeiro admin): INSERT sem app_metadata + UPDATE na mesma transação.
BEGIN;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
VALUES ('f2000000-0000-4000-8000-000000000002','fix-gotrue@example.test','{"provider":"email"}','{"nome":"Via GoTrue"}');
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"organization_id":"f1000000-0000-4000-8000-0000000000a1"}'
 WHERE id='f2000000-0000-4000-8000-000000000002';
COMMIT;
INSERT INTO r SELECT '2 createUser (INSERT+UPDATE) provisiona na agencia certa',
  (SELECT organization_id FROM public.organization_members WHERE user_id='f2000000-0000-4000-8000-000000000002')='f1000000-0000-4000-8000-0000000000a1'
  AND (SELECT organization_id FROM public.profiles WHERE id='f2000000-0000-4000-8000-000000000002')='f1000000-0000-4000-8000-0000000000a1'
  AND (SELECT count(*) FROM public.user_roles WHERE user_id='f2000000-0000-4000-8000-000000000002' AND role='corretor')=1,
  'ok';

-- 3. INSERT já com organization_id (fixtures/variante): provisiona direto.
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
VALUES ('f2000000-0000-4000-8000-000000000003','fix-direto@example.test','{"organization_id":"f1000000-0000-4000-8000-0000000000a1"}','{"nome":"Direto"}');
INSERT INTO r SELECT '3 com org direto provisiona', count(*)=1, 'members='||count(*) FROM public.organization_members WHERE user_id='f2000000-0000-4000-8000-000000000003' AND organization_id='f1000000-0000-4000-8000-0000000000a1';

-- 4. Primeiro admin: troca corretor -> admin (o que createFirstAdmin faz depois do createUser).
DELETE FROM public.user_roles WHERE user_id='f2000000-0000-4000-8000-000000000003' AND role='corretor';
INSERT INTO public.user_roles(organization_id,user_id,role) VALUES ('f1000000-0000-4000-8000-0000000000a1','f2000000-0000-4000-8000-000000000003','admin');
INSERT INTO r SELECT '4 primeiro admin com papel admin', count(*)=1, 'roles='||string_agg(role::text,',') FROM public.user_roles WHERE user_id='f2000000-0000-4000-8000-000000000003';

-- 5. Usuário existente: mudar app_metadata depois não move de agência; atualizar login não dispara recusa.
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('organization_id', public.legacy_default_org_id()::text) WHERE id='f2000000-0000-4000-8000-000000000003';
UPDATE auth.users SET last_sign_in_at = now() WHERE id='f2000000-0000-4000-8000-000000000002';
INSERT INTO r SELECT '5 existente nao muda de agencia', (SELECT organization_id FROM public.organization_members WHERE user_id='f2000000-0000-4000-8000-000000000003')='f1000000-0000-4000-8000-0000000000a1', 'ok';

-- 6. Agência suspensa ou inexistente: recusado.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES ('f2000000-0000-4000-8000-000000000004','fix-susp@example.test','{"organization_id":"f1000000-0000-4000-8000-0000000000a2"}');
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES ('f2000000-0000-4000-8000-000000000005','fix-inex@example.test','{"organization_id":"f1000000-0000-4000-8000-0000000000ff"}');
INSERT INTO r SELECT '6 agencia suspensa/inexistente recusada', count(*)=0, 'users='||count(*) FROM auth.users WHERE id IN ('f2000000-0000-4000-8000-000000000004','f2000000-0000-4000-8000-000000000005');

-- 7. anon (sem login): nenhuma tabela de public legível; tentativa direta em sales nega.
INSERT INTO r SELECT '7 anon nao le nenhuma tabela public', count(*)=0, coalesce(string_agg(relname,','),'-')
  FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m') AND has_table_privilege('anon',oid,'SELECT');
INSERT INTO r SELECT '7b anon nao grava em nenhuma tabela public', count(*)=0, coalesce(string_agg(relname,','),'-')
  FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'
   AND (has_table_privilege('anon',oid,'INSERT') OR has_table_privilege('anon',oid,'UPDATE') OR has_table_privilege('anon',oid,'DELETE'));
SET ROLE anon;
DO $$ BEGIN PERFORM count(*) FROM public.sales; INSERT INTO r VALUES ('7c anon SELECT sales negado', false, 'leu');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES ('7c anon SELECT sales negado', true, SQLSTATE); END $$;
-- 8. Páginas públicas (/especialistas) continuam: RPCs públicas executam para anon.
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.list_public_positioning_regions();
  INSERT INTO r VALUES ('8 anon RPC list_public_positioning_regions', true, 'linhas='||n);
EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES ('8 anon RPC list_public_positioning_regions', false, SQLSTATE||' '||SQLERRM); END $$;
RESET ROLE;
INSERT INTO r SELECT '8b anon EXECUTE list_public_specialists mantido', has_function_privilege('anon', p.oid, 'EXECUTE'), p.oid::regprocedure::text
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='list_public_specialists';

-- 9. Usuário logado (admin real da agência legada) continua lendo normal.
SELECT set_config('mt_test.uid', (SELECT r2.user_id::text FROM public.user_roles r2 JOIN public.profiles p ON p.id=r2.user_id AND p.ativo
  WHERE r2.role='admin' AND r2.organization_id=public.legacy_default_org_id()
    AND NOT EXISTS (SELECT 1 FROM public.platform_admins x WHERE x.user_id=r2.user_id) LIMIT 1), false) IS NOT NULL;
SELECT set_config('request.jwt.claims', json_build_object('sub',current_setting('mt_test.uid'),'role','authenticated')::text, false) IS NOT NULL;
SET ROLE authenticated;
INSERT INTO r SELECT '9 logado le vendas', count(*)>0, 'sales='||count(*) FROM public.sales;
INSERT INTO r SELECT '9b logado le comissoes', count(*)>0, 'comissoes='||count(*) FROM public.occurrence_commissions;
INSERT INTO r SELECT '9c logado le equipes/papeis/perfis', (SELECT count(*) FROM public.teams)>0 AND (SELECT count(*) FROM public.user_roles)>0 AND (SELECT count(*) FROM public.profiles)>0, 'ok';
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false) IS NOT NULL;

-- Limpeza dos sintéticos.
DELETE FROM public.user_roles WHERE user_id::text LIKE 'f2000000-%';
DELETE FROM public.profiles WHERE id::text LIKE 'f2000000-%';
DELETE FROM auth.users WHERE id::text LIKE 'f2000000-%';
DELETE FROM public.activity_logs WHERE organization_id::text LIKE 'f1000000-%';
DELETE FROM public.organizations WHERE id::text LIKE 'f1000000-%';
INSERT INTO r SELECT '10 limpeza', (SELECT count(*) FROM auth.users WHERE id::text LIKE 'f2000000-%')=0 AND (SELECT count(*) FROM public.organizations WHERE id::text LIKE 'f1000000-%')=0, 'ok';

SELECT CASE WHEN ok THEN 'OK' ELSE 'FALHA' END||'|'||caso||'|'||coalesce(det,'') FROM r ORDER BY caso;
SELECT 'TOTAL='||count(*)||' FALHAS='||count(*) FILTER (WHERE NOT ok) FROM r;
