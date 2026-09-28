-- Testes sintéticos A↔B do marco 1b; só clone local, tudo em transação desfeita.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_test;
CREATE TABLE mt_test.results(n serial, name text, ok boolean, detail text);
GRANT USAGE ON SCHEMA mt_test TO authenticated;
GRANT ALL ON mt_test.results TO authenticated;
GRANT ALL ON SEQUENCE mt_test.results_n_seq TO authenticated;
CREATE FUNCTION mt_test.check(_name text, _ok boolean, _detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO mt_test.results(name,ok,detail) VALUES (_name,coalesce(_ok,false),_detail) $$;
CREATE FUNCTION mt_test.cnt(_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE 'SELECT count(*) FROM ('||_sql||') s' INTO n; RETURN n; END $$;
CREATE FUNCTION mt_test.try(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN EXECUTE _sql; GET DIAGNOSTICS n=ROW_COUNT; RETURN 'ok:'||n;
EXCEPTION WHEN OTHERS THEN RETURN 'erro:'||SQLSTATE; END $$;
CREATE FUNCTION mt_test.login(_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',json_build_object('sub',_user,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
END $$;
CREATE FUNCTION mt_test.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims','',true); END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_test TO authenticated;

-- Seed: legado A já existe em seed_legacy.sql; B existe apenas nesta transação.
INSERT INTO public.organizations(id,slug,nome) VALUES('b0000000-0000-4000-8000-000000000001','mt-agencia-b','Agencia B Sintetica');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('20000000-0000-4000-8000-000000000001','b.admin@example.test','{"nome":"Admin B"}','{"organization_id":"b0000000-0000-4000-8000-000000000001"}'),
 ('20000000-0000-4000-8000-000000000002','b.gestor@example.test','{"nome":"Gestor B"}','{"organization_id":"b0000000-0000-4000-8000-000000000001"}'),
 ('20000000-0000-4000-8000-000000000003','b.corretor@example.test','{"nome":"Corretor B"}','{"organization_id":"b0000000-0000-4000-8000-000000000001"}');
INSERT INTO public.user_roles (user_id,role) VALUES
 ('20000000-0000-4000-8000-000000000001','admin'),
 ('20000000-0000-4000-8000-000000000002','gestor');
INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
 ('2a000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Equipe B','b0000000-0000-4000-8000-000000000001');
INSERT INTO public.team_members(membro_id,team_id,tipo) VALUES
 ('20000000-0000-4000-8000-000000000003','2a000000-0000-4000-8000-000000000001','corretor');
INSERT INTO public.sales(id,corretor_id,imovel_id,organization_id) VALUES
 ('25000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','B-1','b0000000-0000-4000-8000-000000000001');
INSERT INTO public.sale_documents(sale_id,tipo,parte) VALUES
 ('25000000-0000-4000-8000-000000000001','rg','comprador_1');
INSERT INTO public.occurrences(sale_id) VALUES ('25000000-0000-4000-8000-000000000001');
INSERT INTO public.clientes(id,tipo_pessoa,nome,organization_id) VALUES
 ('2c000000-0000-4000-8000-000000000001','fisica','Cliente B','b0000000-0000-4000-8000-000000000001');
INSERT INTO public.room_reservations(id,room,reserved_date,start_time,end_time,responsible_id,responsible_name,purpose,organization_id) VALUES
 ('2d000000-0000-4000-8000-000000000001','Barão Sala 1',current_date+10,'10:00','11:00','20000000-0000-4000-8000-000000000003','Corretor B','Reunião com cliente','b0000000-0000-4000-8000-000000000001');
INSERT INTO public.room_reservation_reminder_deliveries(reservation_id,recipient_id,phone) VALUES
 ('2d000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','11999999999');
INSERT INTO public.notifications(user_id,tipo,titulo,sale_id) VALUES
 ('20000000-0000-4000-8000-000000000003','teste','Teste B','25000000-0000-4000-8000-000000000001');
INSERT INTO public.activity_logs(autor_id,sale_id,acao) VALUES
 ('20000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','teste_b');
INSERT INTO public.metas(tipo,corretor_id,mes,meta_comissao) VALUES
 ('corretor','10000000-0000-4000-8000-000000000003',date_trunc('month',current_date)::date,100),
 ('corretor','20000000-0000-4000-8000-000000000003',date_trunc('month',current_date)::date,200);
INSERT INTO public.sale_comments(sale_id,autor_id,texto) VALUES
 ('25000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Teste B');
INSERT INTO public.exclusive_capture_settings(organization_id,id,enabled) VALUES
 ('b0000000-0000-4000-8000-000000000001',true,true);
INSERT INTO public.exclusive_captures(id,captor_id,created_by,template) VALUES
 ('2f000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','campolim');

-- 26 tabelas de agência do marco 1b têm coluna não nula, índice e gate restritivo.
SELECT mt_test.check('26 tabelas de agencia com organizacao NOT NULL e gate',
 (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND a.attname='organization_id' AND a.attnotnull)=40
 AND (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname='org_isolation' AND permissive='RESTRICTIVE')=39);
SELECT mt_test.check('2 tabelas globais Conta MAX sem org e sem RLS publica',
 (SELECT count(*) FROM pg_class c WHERE c.oid IN ('public.conta_max_identity_links'::regclass,'public.conta_max_ticket_uses'::regclass)
 AND c.relrowsecurity)=2
 AND NOT has_table_privilege('authenticated','public.conta_max_identity_links','SELECT'));
SELECT mt_test.check('novo grant de funcao usa dono nao BYPASSRLS',
 (SELECT rolbypassrls FROM pg_roles WHERE rolname='mt_1b_definer')=false
 AND (SELECT proowner::regrole::text FROM pg_proc WHERE oid='public.list_active_users()'::regprocedure)='mt_1b_definer');
SELECT mt_test.check('dono de RPC nao le backup nem identidade global',
 NOT has_table_privilege('mt_1b_definer','public.mt_1b_function_backup','SELECT')
 AND NOT has_table_privilege('mt_1b_definer','public.conta_max_identity_links','SELECT')
 AND NOT has_table_privilege('mt_1b_definer','public.conta_max_ticket_uses','SELECT'));
SELECT mt_test.check('conta max global permanece fechada para anon e autenticado',
 NOT has_table_privilege('anon','public.conta_max_identity_links','SELECT')
 AND NOT has_table_privilege('authenticated','public.conta_max_ticket_uses','SELECT'));
SELECT mt_test.check('metas com corretor de B herdam B',
 (SELECT organization_id FROM public.metas WHERE corretor_id='20000000-0000-4000-8000-000000000003')='b0000000-0000-4000-8000-000000000001');
SELECT mt_test.check('mesma meta/mes nos dois tenants aceita', (SELECT count(*) FROM public.metas)=2);
SELECT mt_test.check('notificacao para B e venda A rejeitada por FK composta',
 mt_test.try($$INSERT INTO public.notifications(user_id,tipo,titulo,sale_id) VALUES ('20000000-0000-4000-8000-000000000003','teste','X','15000000-0000-4000-8000-000000000001')$$)='erro:23503');
SELECT mt_test.check('document extraction para venda B e documento A rejeitada',
 mt_test.try($$INSERT INTO public.document_extractions(sale_id,document_id) SELECT '25000000-0000-4000-8000-000000000001',id FROM public.sale_documents WHERE sale_id='15000000-0000-4000-8000-000000000001' LIMIT 1$$) LIKE 'erro:%');
SELECT mt_test.check('reminder B para usuario A rejeitado',
 mt_test.try($$INSERT INTO public.room_reservation_reminder_deliveries(reservation_id,recipient_id,phone) VALUES ('2d000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','11999999999')$$)='erro:23503');
SELECT mt_test.check('meta B corretor + equipe A rejeitada pela regra de tipo',
 mt_test.try($$INSERT INTO public.metas(tipo,corretor_id,team_id,mes,meta_comissao) VALUES ('corretor','20000000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-000000000001','2026-09-01',100)$$) LIKE 'erro:%');

-- Testar leitura, escrita e funções privilegiadas como papel real authenticated.
SELECT mt_test.login('10000000-0000-4000-8000-000000000001');
SELECT mt_test.check('A admin ve 0 notificacoes de B',mt_test.cnt($$SELECT 1 FROM public.notifications WHERE organization_id='b0000000-0000-4000-8000-000000000001'$$)=0);
SELECT mt_test.check('A admin ve 0 logs de B',mt_test.cnt($$SELECT 1 FROM public.activity_logs WHERE organization_id='b0000000-0000-4000-8000-000000000001'$$)=0);
SELECT mt_test.check('A admin ve 0 metas de B',mt_test.cnt($$SELECT 1 FROM public.metas WHERE organization_id='b0000000-0000-4000-8000-000000000001'$$)=0);
SELECT mt_test.check('A admin ve 0 comentarios de B',mt_test.cnt($$SELECT 1 FROM public.sale_comments WHERE organization_id='b0000000-0000-4000-8000-000000000001'$$)=0);
SELECT mt_test.check('A admin nao altera notificacao B',mt_test.try($$UPDATE public.notifications SET titulo='Invadido' WHERE user_id='20000000-0000-4000-8000-000000000003'$$)='ok:0');
SELECT mt_test.check('A admin nao insere notificacao B',mt_test.try($$INSERT INTO public.notifications(user_id,tipo,titulo) VALUES ('20000000-0000-4000-8000-000000000003','teste','Invadido')$$) LIKE 'erro:%');
SELECT mt_test.check('A admin nao pode consultar papel de B por RPC',NOT public.has_role('20000000-0000-4000-8000-000000000001','admin'));
SELECT mt_test.check('A admin nao pode consultar activity via can_view_sale de B',NOT public.can_view_sale('20000000-0000-4000-8000-000000000003','25000000-0000-4000-8000-000000000001'));
SELECT mt_test.check('A admin lista usuarios sem B via SD',mt_test.cnt($$SELECT 1 FROM public.list_active_users() WHERE id='20000000-0000-4000-8000-000000000001'$$)=0);
SELECT mt_test.check('A admin lista usuarios proprios via SD',mt_test.cnt($$SELECT 1 FROM public.list_active_users() WHERE id='10000000-0000-4000-8000-000000000001'$$)=1);
SELECT mt_test.check('A admin lista regioes sem B via SD',mt_test.cnt($$SELECT 1 FROM public.list_public_positioning_regions()$$)=1);
SELECT mt_test.check('A admin le 0 exclusive_captures B',mt_test.cnt($$SELECT 1 FROM public.exclusive_captures WHERE id='2f000000-0000-4000-8000-000000000001'$$)=0);
SELECT mt_test.check('A admin nao acessa exclusive B via RPC',NOT public.exclusive_can_view('2f000000-0000-4000-8000-000000000001',auth.uid()));
SELECT mt_test.check('A admin nao cancela reserva B via RPC',mt_test.try($$SELECT public.cancel_room_reservation('2d000000-0000-4000-8000-000000000001')$$) LIKE 'erro:%');
SELECT mt_test.logout(); RESET ROLE;
SELECT mt_test.login('20000000-0000-4000-8000-000000000001');
SELECT mt_test.check('B admin lista apenas usuarios B via SD',mt_test.cnt($$SELECT 1 FROM public.list_active_users() WHERE id='10000000-0000-4000-8000-000000000001'$$)=0 AND mt_test.cnt($$SELECT 1 FROM public.list_active_users() WHERE id='20000000-0000-4000-8000-000000000001'$$)=1);
SELECT mt_test.check('B admin nao acessa cliente_historico A via SD',mt_test.cnt($$SELECT 1 FROM public.cliente_historico('1c000000-0000-4000-8000-000000000001')$$)=0);
SELECT mt_test.check('B admin ve configuracao exclusiva propria',public.exclusive_capture_enabled());
SELECT mt_test.check('B admin nao altera sale_comment A',mt_test.try($$UPDATE public.sale_comments SET texto='hack' WHERE sale_id='15000000-0000-4000-8000-000000000001'$$)='ok:0');
SELECT mt_test.logout(); RESET ROLE;
SELECT mt_test.login('20000000-0000-4000-8000-000000000001');
UPDATE public.profiles SET ativo=false WHERE id='20000000-0000-4000-8000-000000000001';
SELECT mt_test.logout(); RESET ROLE;
SELECT mt_test.login('20000000-0000-4000-8000-000000000001');
SELECT mt_test.check('usuario inativo B nao le metas B',mt_test.cnt('SELECT 1 FROM public.metas')=0);
SELECT mt_test.check('usuario inativo B nao lista usuarios via RPC SD',mt_test.cnt('SELECT 1 FROM public.list_active_users()')=0);
SELECT mt_test.logout(); RESET ROLE;
SELECT n,CASE WHEN ok THEN 'ok' ELSE 'FALHOU' END,name,coalesce(detail,'') FROM mt_test.results ORDER BY n;
SELECT format('TOTAL=%s OK=%s FALHAS=%s',count(*),count(*) FILTER (WHERE ok),count(*) FILTER (WHERE NOT ok)) FROM mt_test.results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM mt_test.results WHERE NOT ok) THEN RAISE EXCEPTION 'Testes 1b falhando'; END IF; END $$;
ROLLBACK;
