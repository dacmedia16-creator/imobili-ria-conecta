-- Documentos finais: suíte de acesso, isolamento, travas, idempotência. Tudo é fictício e revertido pelo runner.
CREATE TEMP TABLE r(ok boolean NOT NULL, msg text NOT NULL);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok boolean, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid::text, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;
INSERT INTO ids VALUES ('orgA','00000000-0000-4000-8000-000000000001'),
 ('orgB','2a000000-0000-4000-8000-0000000000b0'),
 ('c2','ebffaded-075c-493f-89e2-1d3d62901dc4'),
 ('a1','10000000-0000-4000-8000-000000000003'),
 ('ges','a742cfda-4731-4fa8-989a-374d2fdf0820'),
 ('con','b316b223-da46-4c2c-9952-25096d5ae5ff'),
 ('admB','b3144521-7e3b-4f48-a1e0-29d90fd3f536'),
 ('L', gen_random_uuid()), ('B', gen_random_uuid()), ('F', gen_random_uuid()), ('V', gen_random_uuid());
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
 (pg_temp.id('orgA'), 'locacao', true), (pg_temp.id('orgB'), 'locacao', true)
 ON CONFLICT (organization_id, module) DO UPDATE SET enabled=true;
INSERT INTO public.locacao_papeis (organization_id,user_id,papel) VALUES
 (pg_temp.id('orgA'),pg_temp.id('con'),'contratos'),
 (pg_temp.id('orgA'),pg_temp.id('ges'),'vistoria'),
 (pg_temp.id('orgA'),pg_temp.id('ges'),'gestora') ON CONFLICT DO NOTHING;
INSERT INTO public.locacoes (id,organization_id,corretor_id,etapa,candidato,ficha,assinatura,pos)
 VALUES (pg_temp.id('L'),pg_temp.id('orgA'),pg_temp.id('c2'),'assinatura',
  '{"nome":"Pessoa fictícia","telefone":"11999990000"}',
  '{"proprietario":{"telefone":"11999990001"}}',
  '{"adm":"assinado","loc":"pendente","vist":"pendente","vist_junto":true}',
  '{"vistoria_pedida":"2026-11-20"}'::jsonb),
 (pg_temp.id('B'),pg_temp.id('orgB'),pg_temp.id('admB'),'assinatura',
  '{"nome":"Pessoa fictícia"}', '{}'::jsonb, '{"loc":"pendente"}'::jsonb,'{}'::jsonb);

-- Autenticação, ACL e isolamento da leitura (a tabela nem é acessível para authenticated).
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.locacao_docs_finais'::regclass)
 AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.locacao_docs_finais_envios'::regclass)
 AND NOT has_table_privilege('authenticated','public.locacao_docs_finais','SELECT')
 AND NOT has_table_privilege('authenticated','public.locacao_docs_finais_envios','SELECT')
 AND NOT has_function_privilege('authenticated','public.locacao_final_reservar(uuid,text,text,uuid)','EXECUTE'),
 'RLS + tabelas fechadas + reserva apenas pelo servidor');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con'));
SELECT pg_temp.ok((public.locacao_final_preparar(pg_temp.id('L'),'contrato_locacao')->>'path')
 LIKE pg_temp.id('orgA')::text || '/' || pg_temp.id('L')::text || '/finais/%',
 'contratos prepara contrato na própria locação');
SELECT pg_temp.ok(left(pg_temp.err('SELECT public.locacao_contratos_acao('''||pg_temp.id('L')||''',''marcar_assinado'',''{"documento":"loc"}'')'),5)='22023',
 'não marca contrato assinado sem PDF');
SELECT pg_temp.ok(left(pg_temp.err('SELECT public.locacao_final_preparar('''||pg_temp.id('B')||''',''contrato_locacao'')'),5)='42501',
 'contratos de A não preparam PDF da imobiliária B');
SELECT pg_temp.ok(left(pg_temp.err('SELECT public.locacao_final_registrar('''||pg_temp.id('L')||''',''contrato_locacao'',''fake.pdf'',''f.pdf'','''||repeat('a',64)||''')'),5)='22023',
 'não registra caminho arbitrário ou arquivo inexistente');
SELECT pg_temp.as_user(pg_temp.id('a1'));
SELECT pg_temp.ok(left(pg_temp.err('SELECT public.locacao_final_preparar('''||pg_temp.id('L')||''',''contrato_locacao'')'),5)='42501'
 AND left(pg_temp.err('SELECT public.locacao_final_ver('''||pg_temp.id('F')||''')'),5)='42501',
 'outro corretor não anexa nem vê documento final');
SELECT pg_temp.as_user(pg_temp.id('c2'));
SELECT pg_temp.ok((public.locacao_detalhe(pg_temp.id('L'))->>'finais_pode')::boolean,
 'o corretor daquela locação pode ver documentos finais');
SELECT pg_temp.ok(left(pg_temp.err('SELECT public.locacao_final_preparar('''||pg_temp.id('L')||''',''contrato_locacao'')'),5)='42501',
 'o próprio corretor não anexa contrato assinado');
SELECT pg_temp.as_user(pg_temp.id('admB'));
SELECT pg_temp.ok(left(pg_temp.err('SELECT public.locacao_detalhe('''||pg_temp.id('L')||''')'),5)='42501',
 'outra imobiliária não vê detalhe');
RESET ROLE;

-- Simula apenas o cadastro do arquivo no banco; upload real ao Storage é testado separadamente.
INSERT INTO public.locacao_docs_finais (id,organization_id,locacao_id,tipo,storage_path,nome_arquivo,sha256,enviado_por)
 VALUES (pg_temp.id('F'),pg_temp.id('orgA'),pg_temp.id('L'),'contrato_locacao',
 pg_temp.id('orgA')||'/'||pg_temp.id('L')||'/finais/f.pdf','contrato-teste.pdf',repeat('a',64),pg_temp.id('con'));
SELECT pg_temp.ok(left(pg_temp.err('INSERT INTO public.locacao_docs_finais (organization_id,locacao_id,tipo,storage_path,nome_arquivo,sha256) VALUES ('''
 ||pg_temp.id('orgA')||''','''||pg_temp.id('L')||''',''contrato_locacao'',''outro.pdf'',''outro.pdf'','''||repeat('a',64)||''')'),5)='23505',
 'mesmo conteúdo não cria segunda versão');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2'));
SELECT pg_temp.ok(public.locacao_final_ver(pg_temp.id('F'))->>'path' LIKE '%/finais/f.pdf',
 'corretor responsável vê o PDF, por link privado');
SELECT pg_temp.as_user(pg_temp.id('a1'));
SELECT pg_temp.ok(left(pg_temp.err('SELECT public.locacao_final_ver('''||pg_temp.id('F')||''')'),5)='42501',
 'outro corretor não baixa o documento depois de anexado');
SELECT pg_temp.as_user(pg_temp.id('admB'));
SELECT pg_temp.ok(left(pg_temp.err('SELECT public.locacao_final_ver('''||pg_temp.id('F')||''')'),5)='42501',
 'outra imobiliária não baixa PDF');
SELECT pg_temp.as_user(pg_temp.id('con'));
SELECT pg_temp.ok(public.locacao_final_ver(pg_temp.id('F'))->>'path' LIKE '%/finais/f.pdf',
 'contratos da imobiliária pode ver');
SELECT pg_temp.ok((public.locacao_contratos_acao(pg_temp.id('L'),'marcar_assinado','{"documento":"loc"}') ->>'etapa')='pos_assinatura',
 'com contrato anexado conclui a assinatura');
SELECT pg_temp.as_user(pg_temp.id('ges'));
SELECT pg_temp.ok(left(pg_temp.err('SELECT public.locacao_pos_acao('''||pg_temp.id('L')||''',''laudo_assinado'',''{}'')'),5)='22023',
 'laudo registrado exige PDF antes da data');
RESET ROLE;
INSERT INTO public.locacao_docs_finais (id,organization_id,locacao_id,tipo,storage_path,nome_arquivo,sha256)
 VALUES (pg_temp.id('V'),pg_temp.id('orgA'),pg_temp.id('L'),'laudo',
 pg_temp.id('orgA')||'/'||pg_temp.id('L')||'/finais/v.pdf','laudo-teste.pdf',repeat('b',64));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ges'));
SELECT pg_temp.ok((public.locacao_pos_acao(pg_temp.id('L'),'laudo_assinado','{}')->>'etapa')='pos_assinatura',
 'vistoria registra laudo com PDF anexado');
RESET ROLE;
-- Reserva dos envios: somente service_role; idempotente por conteúdo, destinatário e origem.
SET LOCAL ROLE service_role;
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_final_reservar(pg_temp.id('F'),'auto',NULL,pg_temp.id('con')))=2,
 'reserva automática separada ao locatário e proprietário');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_final_reservar(pg_temp.id('F'),'auto',NULL,pg_temp.id('con')))=0,
 'anexar o mesmo arquivo não gera envio automático duplicado');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_docs_finais_envios WHERE doc_final_id=pg_temp.id('F') AND origem='auto')=2,
 'histórico separa cada destinatário');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_final_reservar(pg_temp.id('F'),'reenvio','locatario',pg_temp.id('c2')))=0,
 'duplo clique não reenvia enquanto o envio anterior está em andamento');
SELECT pg_temp.ok(public.locacao_final_concluir((SELECT id FROM public.locacao_docs_finais_envios
 WHERE doc_final_id=pg_temp.id('F') AND destinatario='locatario'),'enviado'),
 'conclusão registra status do envio');
RESET ROLE;
SELECT 'TOTAL=' || count(*) || ' PASS=' || count(*) FILTER (WHERE ok) || ' FAIL=' || count(*) FILTER (WHERE NOT ok) FROM r;
SELECT 'FALHA ' || msg FROM r WHERE NOT ok;
