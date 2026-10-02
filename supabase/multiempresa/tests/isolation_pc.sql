-- Isolamento A/B na cópia local. Todos os dados fictícios/sessões são desfeitos por ROLLBACK.
-- Rodar após a migration; resultado TOTAL=n OK=n FALHAS=0, sem PII.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE SCHEMA pc_test;
CREATE TABLE pc_test.results (name text, ok boolean, detail text);
GRANT USAGE ON SCHEMA pc_test TO authenticated;
GRANT ALL ON pc_test.results TO authenticated;
CREATE FUNCTION pc_test.check(n text, ok boolean, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO pc_test.results VALUES (n,coalesce(ok,false),detail) $$;
CREATE FUNCTION pc_test.try(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int; BEGIN EXECUTE q; GET DIAGNOSTICS n=ROW_COUNT; RETURN 'ok:'||n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'try SQLSTATE %: %',SQLSTATE,SQLERRM; RETURN 'erro:'||SQLSTATE; END $$;
CREATE FUNCTION pc_test.login(u uuid, sid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated',
    'session_id',sid,'app_metadata',jsonb_build_object('organization_id',
      '00000000-0000-4000-8000-000000000001'))::text,true);
  PERFORM set_config('role','authenticated',true);
END $$;
CREATE FUNCTION pc_test.audit_exists(tab text) RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path TO '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.platform_org_context_actions a
    WHERE a.table_name=tab AND a.operation='INSERT'
      AND a.organization_id='20000000-0000-4000-8000-000000000001'::uuid
      AND a.actor_user_id='460a07d6-f223-4be5-8ff8-6efc1693d719'::uuid)
$$;
CREATE FUNCTION pc_test.history_ok() RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path TO '' AS $$
  SELECT (SELECT count(*) FROM public.platform_org_context_sessions
           WHERE auth_session_id='30000000-0000-4000-8000-000000000001'::uuid) = 2
     AND NOT EXISTS (SELECT 1 FROM public.platform_org_context_sessions
           WHERE auth_session_id='30000000-0000-4000-8000-000000000001'::uuid AND ended_at IS NULL)
     AND (SELECT count(DISTINCT a.context_session_id) FROM public.platform_org_context_actions a
           JOIN public.platform_org_context_sessions s ON s.id=a.context_session_id
           WHERE s.auth_session_id='30000000-0000-4000-8000-000000000001'::uuid AND a.operation='ENTER') = 2
     AND EXISTS (SELECT 1 FROM public.platform_org_context_actions a
           WHERE a.table_name='activity_logs' AND a.operation='INSERT')
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pc_test TO authenticated;

INSERT INTO public.organizations(id,nome,slug,status)
VALUES ('20000000-0000-4000-8000-000000000001','Agencia B Ficticia','b-ficticia-pc','ativa');
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
VALUES ('20000000-0000-4000-8000-000000000002','b.ficticia.pc@example.test','{"nome":"Corretor B Ficticio"}',
  '{"organization_id":"20000000-0000-4000-8000-000000000001"}');
INSERT INTO public.clientes(id,tipo_pessoa,nome,organization_id) VALUES
  ('20000000-0000-4000-8000-000000000003','fisica','Cliente B Ficticio','20000000-0000-4000-8000-000000000001');
INSERT INTO public.sales(id,corretor_id,imovel_id,organization_id) VALUES
  ('20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','B-FAKE-TEST','20000000-0000-4000-8000-000000000001');
INSERT INTO auth.sessions(id,user_id) VALUES
 ('30000000-0000-4000-8000-000000000001','460a07d6-f223-4be5-8ff8-6efc1693d719'),
 ('30000000-0000-4000-8000-000000000002','460a07d6-f223-4be5-8ff8-6efc1693d719'),
 ('30000000-0000-4000-8000-000000000003','0728f659-2c91-4fcb-b2e0-9d8f32bca96f');
-- Duas agências, incluindo objeto do bucket com path prefixed novo.
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('sale-documents','20000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000004/b-fake.pdf');

SELECT pc_test.login('460a07d6-f223-4be5-8ff8-6efc1693d719','30000000-0000-4000-8000-000000000001');
SELECT pc_test.check('A original sem contexto, B invisivel',
 public.current_org_id()='00000000-0000-4000-8000-000000000001'::uuid
 AND public.platform_current_org() IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.clientes WHERE id='20000000-0000-4000-8000-000000000003')
 AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '20000000%'));
SELECT pc_test.check('Claim org forjada nao altera escopo',
 public.current_org_id()='00000000-0000-4000-8000-000000000001'::uuid);
SELECT pc_test.check('RPC definer A nao ve venda B', NOT public.can_view_sale(auth.uid(),
 '20000000-0000-4000-8000-000000000004'));
SELECT pc_test.check('A nao edita cliente de B',pc_test.try($$UPDATE public.clientes SET nome='tentativa A' WHERE id='20000000-0000-4000-8000-000000000003'$$)='ok:0');
SELECT pc_test.check('A nao cria venda com corretor de B',pc_test.try($$INSERT INTO public.sales(corretor_id,imovel_id) VALUES ('20000000-0000-4000-8000-000000000002','A-forja-B')$$) LIKE 'erro:%');
SELECT pc_test.check('Entrada autorizada em B',
 (public.platform_enter_org('20000000-0000-4000-8000-000000000001')->>'organization_id')='20000000-0000-4000-8000-000000000001');
SELECT pc_test.check('Contexto B sem membership/role gravados',
 public.current_org_id()='20000000-0000-4000-8000-000000000001'::uuid
 AND public.user_org(auth.uid())=public.current_org_id()
 AND public.has_role(auth.uid(),'super_admin') AND public.has_role(auth.uid(),'admin')
 AND public.has_role(auth.uid(),'financeiro')
 AND NOT EXISTS(SELECT 1 FROM public.organization_members WHERE user_id=auth.uid() AND organization_id=public.current_org_id())
 AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND organization_id=public.current_org_id()));
SELECT pc_test.check('B visivel e A invisivel por RLS e storage',
 EXISTS(SELECT 1 FROM public.clientes WHERE id='20000000-0000-4000-8000-000000000003')
 AND NOT EXISTS(SELECT 1 FROM public.clientes WHERE organization_id='00000000-0000-4000-8000-000000000001')
 AND EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '20000000%')
 AND NOT EXISTS(SELECT 1 FROM public.sales WHERE organization_id='00000000-0000-4000-8000-000000000001'));
SELECT pc_test.check('RPC definer B le sua venda e nao a de A',
 public.can_view_sale(auth.uid(),'20000000-0000-4000-8000-000000000004')
 AND NOT public.can_view_sale(auth.uid(),(SELECT id FROM public.sales WHERE organization_id='00000000-0000-4000-8000-000000000001' LIMIT 1)));
SELECT pc_test.check('Tentativa SQL A negada por RLS no contexto B',
 pc_test.try($$UPDATE public.clientes SET nome='tentativa B' WHERE organization_id='00000000-0000-4000-8000-000000000001'$$)='ok:0');
SELECT pc_test.check('B cria cliente com org B apesar de claim forjada',
 pc_test.try($$INSERT INTO public.clientes(tipo_pessoa,nome,organization_id) VALUES ('fisica','Escrita B','00000000-0000-4000-8000-000000000001')$$)='ok:1');
SELECT pc_test.check('B cria venda com corretor B',
 pc_test.try($$INSERT INTO public.sales(corretor_id,imovel_id) VALUES ('20000000-0000-4000-8000-000000000002','B-self-sale')$$)='ok:1');
SELECT pc_test.check('B registra activity_logs com autoria rastreavel',
 pc_test.try($$INSERT INTO public.activity_logs(autor_id,sale_id,acao) VALUES ('460a07d6-f223-4be5-8ff8-6efc1693d719','20000000-0000-4000-8000-000000000004','context_test')$$)='ok:1');
SELECT pc_test.check('B registra comentario com autoria rastreavel',
 pc_test.try($$INSERT INTO public.sale_comments(autor_id,sale_id,texto) VALUES ('460a07d6-f223-4be5-8ff8-6efc1693d719','20000000-0000-4000-8000-000000000004','Teste B')$$)='ok:1');
SELECT pc_test.check('FK de autoria nao aceita usuario de A que nao e ator',
 pc_test.try($$INSERT INTO public.activity_logs(autor_id,sale_id,acao) VALUES ('0728f659-2c91-4fcb-b2e0-9d8f32bca96f','20000000-0000-4000-8000-000000000004','forged')$$)='erro:23503');
SELECT pc_test.check('Acesso definer de cancelamento fora de B negado',
 pc_test.try($$SELECT public.platform_cancel_sale((SELECT id FROM public.sales WHERE organization_id='00000000-0000-4000-8000-000000000001' AND status::text <> 'rascunho' LIMIT 1),'teste')$$) IN ('erro:42501','erro:22023'));
SELECT pc_test.check('Escritas no contexto com destino e ator auditados',
 pc_test.audit_exists('activity_logs') AND pc_test.audit_exists('sale_comments'));
SELECT pc_test.check('Outro JWT mesmo ator nao herda contexto',
 (SELECT public.platform_current_org()) IS NOT NULL);
-- Simula outra sessão JWT no mesmo comando, testando chave de cache por session_id.
DO $t$ BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub','460a07d6-f223-4be5-8ff8-6efc1693d719',
    'role','authenticated','session_id','30000000-0000-4000-8000-000000000002')::text,true);
  PERFORM pc_test.check('Outra sessao JWT nao herda contexto', public.platform_current_org() IS NULL
    AND public.current_org_id()='00000000-0000-4000-8000-000000000001'::uuid);
END $t$;
SELECT pc_test.login('460a07d6-f223-4be5-8ff8-6efc1693d719','30000000-0000-4000-8000-000000000001');
RESET ROLE;
UPDATE public.platform_org_context_sessions SET expires_at=now()-interval '1 minute',started_at=now()-interval '8 hours'
  WHERE auth_session_id='30000000-0000-4000-8000-000000000001';
SELECT pc_test.login('460a07d6-f223-4be5-8ff8-6efc1693d719','30000000-0000-4000-8000-000000000001');
SELECT pc_test.check('Sessao expirada nao ve B', public.platform_current_org() IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.clientes WHERE organization_id='20000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '20000000%'));
SELECT pc_test.check('Reentrada renova prazo ate 8h', (public.platform_enter_org('20000000-0000-4000-8000-000000000001')->>'expires_at')::timestamptz>now());
SELECT pc_test.check('Sair retorna null',public.platform_exit_org() IS NULL);
SELECT pc_test.check('Historico preservado: sessao antiga encerrada e acoes antigas mantidas',
 pc_test.history_ok());
SELECT pc_test.check('Sair volta ao A e perde B',
 public.current_org_id()='00000000-0000-4000-8000-000000000001'::uuid
 AND public.platform_current_org() IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.clientes WHERE organization_id='20000000-0000-4000-8000-000000000001'));
RESET ROLE;
-- Admin da imobiliária não vira admin da plataforma, mesmo com JWT org falsa e com sessão válida.
SELECT pc_test.login('0728f659-2c91-4fcb-b2e0-9d8f32bca96f','30000000-0000-4000-8000-000000000003');
SELECT pc_test.check('Nao-plataforma nao entra em B',
 pc_test.try($$SELECT public.platform_enter_org('20000000-0000-4000-8000-000000000001')$$)='erro:42501'
 AND public.platform_current_org() IS NULL);
RESET ROLE;
SELECT 'TOTAL='||count(*)||' OK='||count(*) FILTER(WHERE ok)||' FALHAS='||count(*) FILTER(WHERE NOT ok) FROM pc_test.results;
SELECT 'FALHA '||name||coalesce(' ('||detail||')','') FROM pc_test.results WHERE NOT ok;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pc_test.results WHERE NOT ok) THEN RAISE EXCEPTION 'pc isolation falhando'; END IF; END $$;
ROLLBACK;
