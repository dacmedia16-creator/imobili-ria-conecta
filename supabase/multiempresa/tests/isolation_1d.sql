-- Ensaio 1d no clone: escritas com service_role (ignora RLS) exigem/validam organization_id.
-- Tudo em transação + ROLLBACK; nenhuma linha persiste.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_1d_test;
CREATE TABLE mt_1d_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA mt_1d_test TO service_role, authenticated;
GRANT ALL ON mt_1d_test.results TO service_role, authenticated;
GRANT ALL ON SEQUENCE mt_1d_test.results_n_seq TO service_role, authenticated;
CREATE FUNCTION mt_1d_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mt_1d_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION mt_1d_test.try(query text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN EXECUTE query; GET DIAGNOSTICS n=ROW_COUNT; RETURN 'ok:'||n;
 EXCEPTION WHEN OTHERS THEN RETURN 'erro:'||SQLSTATE; END $$;
CREATE FUNCTION mt_1d_test.as_service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true); END $$;
CREATE FUNCTION mt_1d_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_1d_test TO service_role, authenticated;

-- Agência B sintética + usuários (preparação como dono do banco).
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('b0000000-0000-4000-8000-00000000000d','mt-service-b','Agencia B 1d');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('2d000000-0000-4000-8000-000000000001','svc-b-gestor@example.test','{"nome":"B Gestor"}',
  '{"organization_id":"b0000000-0000-4000-8000-00000000000d"}'),
 ('2d000000-0000-4000-8000-000000000002','svc-b-corretor@example.test','{"nome":"B Corretor"}',
  '{"organization_id":"b0000000-0000-4000-8000-00000000000d"}');
INSERT INTO public.user_roles(user_id,role) VALUES ('2d000000-0000-4000-8000-000000000001','gestor');
INSERT INTO public.sales(id,corretor_id,imovel_id,organization_id) VALUES
 ('2d500000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000002','SVC-B',
  'b0000000-0000-4000-8000-00000000000d');
INSERT INTO public.room_reservations(id,room,reserved_date,start_time,end_time,responsible_id,
  responsible_name,purpose,organization_id) VALUES
 ('2d700000-0000-4000-8000-000000000001','Barão Sala 2',current_date+5,'09:00','10:00',
  '2d000000-0000-4000-8000-000000000002','B Corretor','Reunião com cliente','b0000000-0000-4000-8000-00000000000d');

SELECT mt_1d_test.as_service();
-- Tabelas raiz: service_role precisa informar a agência.
SELECT mt_1d_test.check('service_role sem organization_id nao cria equipe',
 mt_1d_test.try($$INSERT INTO public.teams(lider_id,nome) VALUES ('2d000000-0000-4000-8000-000000000001','X')$$)='erro:23502');
SELECT mt_1d_test.check('service_role sem organization_id nao cria reserva',
 mt_1d_test.try($$INSERT INTO public.room_reservations(room,reserved_date,start_time,end_time,responsible_id,responsible_name,purpose)
  VALUES ('Barão Sala 3',current_date+5,'09:00','10:00','2d000000-0000-4000-8000-000000000002','B','Reunião com cliente')$$)='erro:23502');
SELECT mt_1d_test.check('service_role cria equipe B com organization_id explicito',
 mt_1d_test.try($$INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
  ('2da00000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','Equipe B','b0000000-0000-4000-8000-00000000000d')$$)='ok:1');
SELECT mt_1d_test.check('service_role nao cria equipe A com lider de B',
 mt_1d_test.try($$INSERT INTO public.teams(lider_id,nome,organization_id) VALUES
  ('2d000000-0000-4000-8000-000000000001','Cruzada','00000000-0000-4000-8000-000000000001')$$) LIKE 'erro:%');
-- Filhas: organização informada diferente do pai é recusada.
SELECT mt_1d_test.check('service_role nao adiciona membro com organization_id forjado',
 mt_1d_test.try($$INSERT INTO public.team_members(team_id,membro_id,organization_id) VALUES
  ('2da00000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001')$$)='erro:42501');
SELECT mt_1d_test.check('service_role adiciona membro B com org correta',
 mt_1d_test.try($$INSERT INTO public.team_members(team_id,membro_id,organization_id) VALUES
  ('2da00000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-00000000000d')$$)='ok:1');
SELECT mt_1d_test.check('service_role nao cria papel de B marcado como A',
 mt_1d_test.try($$INSERT INTO public.user_roles(user_id,role,organization_id) VALUES
  ('2d000000-0000-4000-8000-000000000002','juridico','00000000-0000-4000-8000-000000000001')$$)='erro:42501');
SELECT mt_1d_test.check('service_role nao notifica usuario B marcando agencia A',
 mt_1d_test.try($$INSERT INTO public.notifications(user_id,tipo,titulo,organization_id) VALUES
  ('2d000000-0000-4000-8000-000000000002','t','x','00000000-0000-4000-8000-000000000001')$$)='erro:42501');
SELECT mt_1d_test.check('service_role nao notifica usuario A sobre venda B',
 mt_1d_test.try($$INSERT INTO public.notifications(user_id,sale_id,tipo,titulo,organization_id) VALUES
  ('10000000-0000-4000-8000-000000000001','2d500000-0000-4000-8000-000000000001','t','x','b0000000-0000-4000-8000-00000000000d')$$) LIKE 'erro:%');
SELECT mt_1d_test.check('service_role notifica usuario B na propria agencia',
 mt_1d_test.try($$INSERT INTO public.notifications(user_id,sale_id,tipo,titulo,organization_id) VALUES
  ('2d000000-0000-4000-8000-000000000002','2d500000-0000-4000-8000-000000000001','t','x','b0000000-0000-4000-8000-00000000000d')$$)='ok:1');
SELECT mt_1d_test.check('service_role nao registra entrega de lembrete B como A',
 mt_1d_test.try($$INSERT INTO public.room_reservation_reminder_deliveries(reservation_id,recipient_id,phone,organization_id) VALUES
  ('2d700000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000002','5515999990000','00000000-0000-4000-8000-000000000001')$$)='erro:42501');
SELECT mt_1d_test.check('service_role nao registra entrega B para destinatario A',
 mt_1d_test.try($$INSERT INTO public.room_reservation_reminder_deliveries(reservation_id,recipient_id,phone,organization_id) VALUES
  ('2d700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','5515999990000','b0000000-0000-4000-8000-00000000000d')$$) LIKE 'erro:%');
SELECT mt_1d_test.check('service_role nao grava log de A sobre venda B',
 mt_1d_test.try($$INSERT INTO public.activity_logs(autor_id,sale_id,acao,organization_id) VALUES
  ('10000000-0000-4000-8000-000000000001','2d500000-0000-4000-8000-000000000001','x','00000000-0000-4000-8000-000000000001')$$) LIKE 'erro:%');
SELECT mt_1d_test.check('service_role nao abre sessao operacional A->B',
 mt_1d_test.try($$INSERT INTO public.operational_impersonation_sessions(actor_user_id,target_user_id,organization_id) VALUES
  ('10000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001')$$) LIKE 'erro:%');
SELECT mt_1d_test.check('service_role nao move reserva B para A',
 mt_1d_test.try($$UPDATE public.room_reservations SET organization_id='00000000-0000-4000-8000-000000000001'
  WHERE id='2d700000-0000-4000-8000-000000000001'$$) LIKE 'erro:%');
SELECT mt_1d_test.check('service_role nao move perfil B para A',
 mt_1d_test.try($$UPDATE public.profiles SET organization_id='00000000-0000-4000-8000-000000000001'
  WHERE id='2d000000-0000-4000-8000-000000000002'$$) LIKE 'erro:%');
SELECT mt_1d_test.check('service_role nao move equipe B para A',
 mt_1d_test.try($$UPDATE public.teams SET organization_id='00000000-0000-4000-8000-000000000001'
  WHERE id='2da00000-0000-4000-8000-000000000001'$$) LIKE 'erro:%');
SELECT mt_1d_test.check('service_role atualiza lembrete B sem trocar agencia',
 mt_1d_test.try($$UPDATE public.room_reservations SET reminder_sent_at=now()
  WHERE id='2d700000-0000-4000-8000-000000000001' AND organization_id='b0000000-0000-4000-8000-00000000000d'$$)='ok:1');
RESET ROLE;
SELECT set_config('request.jwt.claims','',true);

-- Usuário autenticado continua como antes (organização vem da sessão).
SELECT mt_1d_test.as_user('2d000000-0000-4000-8000-000000000001');
SELECT mt_1d_test.check('gestor B autenticado cria equipe sem informar org (vai para B)',
 mt_1d_test.try($$INSERT INTO public.teams(id,lider_id,nome) VALUES
  ('2da00000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','Equipe B2')$$)='ok:1');
RESET ROLE;
SELECT mt_1d_test.check('equipe criada pelo gestor B ficou em B',
 (SELECT organization_id FROM public.teams WHERE id='2da00000-0000-4000-8000-000000000002')='b0000000-0000-4000-8000-00000000000d');

-- Manutenção/migração (sem role de API nem JWT) mantém o default legado transitório.
SELECT set_config('request.jwt.claims','',true);
SELECT mt_1d_test.check('manutencao sem role de API cria equipe sem org explicita',
 mt_1d_test.try($$INSERT INTO public.teams(id,lider_id,nome) VALUES
  ('1da00000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Legado')$$)='ok:1');
SELECT mt_1d_test.check('manutencao sem role de API usa default legado',
 (SELECT organization_id FROM public.teams WHERE id='1da00000-0000-4000-8000-000000000001')='00000000-0000-4000-8000-000000000001');

SELECT n,CASE WHEN ok THEN 'ok' ELSE 'FALHOU' END,label FROM mt_1d_test.results ORDER BY n;
SELECT format('TOTAL=%s OK=%s FALHAS=%s',count(*),count(*) FILTER (WHERE ok),count(*) FILTER (WHERE NOT ok)) FROM mt_1d_test.results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM mt_1d_test.results WHERE NOT ok) THEN RAISE EXCEPTION 'Testes 1d falhando'; END IF; END $$;
ROLLBACK;
