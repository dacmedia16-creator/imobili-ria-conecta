-- Ensaio A↔B no clone; não persiste nenhuma linha/objeto. Simula chamadas SQL sob role/JWT.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_1c_test;
CREATE TABLE mt_1c_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA mt_1c_test TO authenticated;
GRANT ALL ON mt_1c_test.results TO authenticated;
GRANT ALL ON SEQUENCE mt_1c_test.results_n_seq TO authenticated;
CREATE FUNCTION mt_1c_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mt_1c_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION mt_1c_test.cnt(query text) RETURNS bigint LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN EXECUTE 'SELECT count(*) FROM ('||query||') x' INTO n; RETURN n; END $$;
CREATE FUNCTION mt_1c_test.try(query text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN EXECUTE query; GET DIAGNOSTICS n=ROW_COUNT; RETURN 'ok:'||n;
 EXCEPTION WHEN OTHERS THEN RETURN 'erro:'||SQLSTATE||':'||SQLERRM; END $$;
CREATE FUNCTION mt_1c_test.login(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 -- Supabase hospedado: storage.protect_delete só aceita DELETE vindo da Storage API, que liga
 -- esta flag na transação. Simula a API; RLS continua decidindo o que pode ser excluído.
 PERFORM set_config('storage.allow_delete_query','true',true); END $$;
CREATE FUNCTION mt_1c_test.logout() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims','',true); END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_1c_test TO authenticated;
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('b0000000-0000-4000-8000-000000000001','mt-storage-b','Agencia B Teste');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('20000000-0000-4000-8000-000000000001','storage-b@example.test','{"nome":"B"}',
 '{"organization_id":"b0000000-0000-4000-8000-000000000001"}');
INSERT INTO public.user_roles(user_id,role) VALUES ('20000000-0000-4000-8000-000000000001','admin');
INSERT INTO public.sales(id,corretor_id,imovel_id,organization_id) VALUES
 ('25000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 'STORAGE-B','b0000000-0000-4000-8000-000000000001');
INSERT INTO public.exclusive_capture_settings(organization_id,id,enabled) VALUES
 ('00000000-0000-4000-8000-000000000001',true,true),
 ('b0000000-0000-4000-8000-000000000001',true,true);
INSERT INTO public.exclusive_captures(id,captor_id,created_by,template) VALUES
 ('1f000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','campolim'),
 ('2f000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','campolim');
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('sale-documents','15000000-0000-4000-8000-000000000001/outros/legado.pdf'),
 ('sale-documents','b0000000-0000-4000-8000-000000000001/25000000-0000-4000-8000-000000000001/outros/b.pdf'),
 ('avatars','10000000-0000-4000-8000-000000000001/avatar'),
 ('avatars','b0000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/avatar'),
 ('exclusive-captures','1f000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.pdf'),
 ('exclusive-captures','b0000000-0000-4000-8000-000000000001/2f000000-0000-4000-8000-000000000001/22222222-2222-4222-8222-222222222222.pdf'),
 ('exclusive-templates','campolim.pdf'),
 ('exclusive-templates','b0000000-0000-4000-8000-000000000001/campolim.pdf');
INSERT INTO public.exclusive_documents(capture_id,kind,owner_index,storage_path,file_name,uploaded_by) VALUES
 ('1f000000-0000-4000-8000-000000000001','gerado',0,'1f000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.pdf','legado.pdf','10000000-0000-4000-8000-000000000001'),
 ('2f000000-0000-4000-8000-000000000001','gerado',0,'b0000000-0000-4000-8000-000000000001/2f000000-0000-4000-8000-000000000001/22222222-2222-4222-8222-222222222222.pdf','b.pdf','20000000-0000-4000-8000-000000000001');
SELECT mt_1c_test.check('17 permissivas preservadas, acesso RPC pendente e 4 gates restritivos',
 (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND permissive='RESTRICTIVE')=4
 AND (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND permissive='PERMISSIVE')=18);
SELECT mt_1c_test.check('buckets de documentos privados',
 (SELECT count(*) FROM storage.buckets WHERE id IN ('sale-documents','exclusive-captures','exclusive-templates') AND public=false)=3);
SELECT mt_1c_test.login('10000000-0000-4000-8000-000000000001');
SELECT mt_1c_test.check('A le objeto legado proprio',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE bucket_id='sale-documents' AND name LIKE '15000000%legado.pdf'$$)=1);
SELECT mt_1c_test.check('A nao lista nem le documento B',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE bucket_id='sale-documents' AND name LIKE 'b0000000%'$$)=0);
SELECT mt_1c_test.check('A nao lista nem le avatar B',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE bucket_id='avatars' AND name LIKE 'b0000000%'$$)=0);
SELECT mt_1c_test.check('A le captação legada e template da propria agencia',
 mt_1c_test.cnt($$SELECT 1 FROM storage.objects WHERE bucket_id='exclusive-captures' AND name LIKE '1f000000%'$$)=1
 AND mt_1c_test.cnt($$SELECT 1 FROM storage.objects WHERE bucket_id='exclusive-templates' AND name='campolim.pdf'$$)=1);
SELECT mt_1c_test.check('A nao le captação nem template B',
 mt_1c_test.cnt($$SELECT 1 FROM storage.objects WHERE bucket_id IN ('exclusive-captures','exclusive-templates') AND name LIKE 'b0000000%'$$)=0);
SELECT mt_1c_test.check('A nao insere captação B',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('exclusive-captures','00000000-0000-4000-8000-000000000001/2f000000-0000-4000-8000-000000000001/33333333-3333-4333-8333-333333333333.pdf')$$) LIKE 'erro:%');
SELECT mt_1c_test.check('A nao insere venda B no prefixo A',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('sale-documents','00000000-0000-4000-8000-000000000001/25000000-0000-4000-8000-000000000001/outros/x.pdf')$$) LIKE 'erro:%');
SELECT mt_1c_test.check('A nao insere no prefixo B',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars','b0000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/avatar')$$) LIKE 'erro:%');
SELECT mt_1c_test.check('A nao insere sem prefixo',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars','10000000-0000-4000-8000-000000000001/novo')$$) LIKE 'erro:%');
SELECT mt_1c_test.check('A pode inserir avatar prefixado proprio',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars','00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/avatar')$$)='ok:1');
SELECT mt_1c_test.check('A atualiza avatar novo proprio',mt_1c_test.try(
 $$UPDATE storage.objects SET metadata='{}' WHERE bucket_id='avatars' AND name='00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/avatar'$$)='ok:1');
SELECT mt_1c_test.check('A consegue escrever documento prefixado da propria venda',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('sale-documents','00000000-0000-4000-8000-000000000001/15000000-0000-4000-8000-000000000001/outros/novo.pdf')$$)='ok:1');
SELECT mt_1c_test.check('A le documento novo proprio',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE name='00000000-0000-4000-8000-000000000001/15000000-0000-4000-8000-000000000001/outros/novo.pdf'$$)=1);
SELECT mt_1c_test.check('A exclui documento novo proprio',mt_1c_test.try(
 $$DELETE FROM storage.objects WHERE name='00000000-0000-4000-8000-000000000001/15000000-0000-4000-8000-000000000001/outros/novo.pdf'$$)='ok:1');
SELECT mt_1c_test.check('A nao pode atualizar objeto B',mt_1c_test.try(
 $$UPDATE storage.objects SET metadata='{}' WHERE bucket_id='sale-documents' AND name LIKE 'b0000000%'$$)='ok:0');
SELECT mt_1c_test.check('A nao pode excluir objeto B',mt_1c_test.try(
 $$DELETE FROM storage.objects WHERE bucket_id='sale-documents' AND name LIKE 'b0000000%'$$)='ok:0');
SELECT mt_1c_test.check('A nao atualiza legado (somente leitura/remocao)',mt_1c_test.try(
 $$UPDATE storage.objects SET metadata='{}' WHERE name LIKE '15000000%legado.pdf'$$)='ok:0');
SELECT mt_1c_test.check('A nao registra caminho B por RPC',mt_1c_test.try(
 $$SELECT public.insert_sale_document('15000000-0000-4000-8000-000000000001','rg','outros','b0000000-0000-4000-8000-000000000001/25000000-0000-4000-8000-000000000001/outros/b.pdf','b.pdf')$$) LIKE 'erro:%');
SELECT mt_1c_test.logout(); RESET ROLE;
SELECT mt_1c_test.login('20000000-0000-4000-8000-000000000001');
SELECT mt_1c_test.check('B le proprio documento',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE bucket_id='sale-documents' AND name LIKE 'b0000000%'$$)=1);
SELECT mt_1c_test.check('B nao le legado A',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE bucket_id='sale-documents' AND name LIKE '15000000%'$$)=0);
SELECT mt_1c_test.check('B nao lista avatar legado A',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE bucket_id='avatars' AND name LIKE '10000000%'$$)=0);
SELECT mt_1c_test.check('B nao le template legado A',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE bucket_id='exclusive-templates' AND name='campolim.pdf'$$)=0);
SELECT mt_1c_test.check('B le captação e template B',
 mt_1c_test.cnt($$SELECT 1 FROM storage.objects WHERE bucket_id='exclusive-captures' AND name LIKE 'b0000000%'$$)=1
 AND mt_1c_test.cnt($$SELECT 1 FROM storage.objects WHERE bucket_id='exclusive-templates' AND name LIKE 'b0000000%'$$)=1);
SELECT mt_1c_test.check('B nao le captação legada A',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE bucket_id='exclusive-captures' AND name LIKE '1f000000%'$$)=0);
SELECT mt_1c_test.check('B escreve documento da propria venda',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('sale-documents','b0000000-0000-4000-8000-000000000001/25000000-0000-4000-8000-000000000001/outros/novo.pdf')$$)='ok:1');
SELECT mt_1c_test.check('B escreve captação própria',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('exclusive-captures','b0000000-0000-4000-8000-000000000001/2f000000-0000-4000-8000-000000000001/33333333-3333-4333-8333-333333333333.pdf','{"mimetype":"application/pdf"}')$$)='ok:1');

SELECT mt_1c_test.check('B registra documento exclusivo com prefixo',mt_1c_test.try(
 $$SELECT public.exclusive_register_document('2f000000-0000-4000-8000-000000000001','rg',1,'b0000000-0000-4000-8000-000000000001/2f000000-0000-4000-8000-000000000001/33333333-3333-4333-8333-333333333333.pdf','doc.pdf')$$)='ok:1');
SELECT mt_1c_test.check('B nao escreve captação A',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('exclusive-captures','b0000000-0000-4000-8000-000000000001/1f000000-0000-4000-8000-000000000001/44444444-4444-4444-8444-444444444444.pdf')$$) LIKE 'erro:%');
SELECT mt_1c_test.check('B insere proprio avatar',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars','b0000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/novo')$$)='ok:1');
SELECT mt_1c_test.check('B nao move avatar para A',mt_1c_test.try(
 $$UPDATE storage.objects SET name='00000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/avatar' WHERE bucket_id='avatars' AND name='b0000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/avatar'$$) LIKE 'erro:%');
SELECT mt_1c_test.check('B nao exclui documento A',mt_1c_test.try(
 $$DELETE FROM storage.objects WHERE bucket_id='sale-documents' AND name LIKE '15000000%'$$)='ok:0');
SELECT mt_1c_test.check('B nao registra documento A por RPC',mt_1c_test.try(
 $$SELECT public.insert_sale_document('15000000-0000-4000-8000-000000000001','rg','outros','00000000-0000-4000-8000-000000000001/15000000-0000-4000-8000-000000000001/outros/x.pdf','x.pdf')$$) LIKE 'erro:%');
SELECT mt_1c_test.logout(); RESET ROLE;
UPDATE public.organizations SET status='suspensa' WHERE id='b0000000-0000-4000-8000-000000000001';
SELECT mt_1c_test.login('20000000-0000-4000-8000-000000000001');
SELECT mt_1c_test.check('agencia suspensa nao lista arquivos',mt_1c_test.cnt(
 $$SELECT 1 FROM storage.objects WHERE bucket_id IN ('sale-documents','exclusive-captures','avatars')$$)=0);
SELECT mt_1c_test.check('agencia suspensa nao envia arquivo',mt_1c_test.try(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars','b0000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/suspenso')$$) LIKE 'erro:%');
SELECT mt_1c_test.logout(); RESET ROLE;
SELECT n,CASE WHEN ok THEN 'ok' ELSE 'FALHOU' END,label FROM mt_1c_test.results ORDER BY n;
SELECT format('TOTAL=%s OK=%s FALHAS=%s',count(*),count(*) FILTER (WHERE ok),count(*) FILTER (WHERE NOT ok)) FROM mt_1c_test.results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM mt_1c_test.results WHERE NOT ok) THEN RAISE EXCEPTION 'Testes 1c falhando'; END IF; END $$;
ROLLBACK;
