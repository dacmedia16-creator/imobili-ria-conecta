-- Suíte "acesso do MAX ao Ajuda e sugestões" (migration 20261009030000). Roda DENTRO de transação
-- revertida (run-ajuda-acesso-max.sh), depois das migrations 20261008220000 e 20261009030000.
-- Homologação: A = Única, B = agencia-b-homolog. Mesmos perfis da suíte ajuda_sugestoes.sql.
-- O papel max_suporte_bot é exercitado com SET ROLE (é o mesmo papel que a credencial usará).
-- Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, service_role, max_suporte_bot;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO max_suporte_bot;
-- Só neste teste (revertido): permite ao postgres "virar" o papel do MAX.
GRANT max_suporte_bot TO postgres WITH SET TRUE, INHERIT FALSE;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('corretor', '10000000-0000-4000-8000-000000000003'),
  ('colega', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('equipe', 'b316b223-da46-4c2c-9952-25096d5ae5ff'), ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');

-- ===== Catálogo: o papel nasce desligado e sem privilégios =======================================
SELECT pg_temp.ok((SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
  AND NOT rolcreatedb AND NOT rolinherit FROM pg_roles WHERE rolname = 'max_suporte_bot'),
  'papel max_suporte_bot existe, SEM login (desligado), sem bypass de RLS nem superpoderes');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
  JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = 'max_suporte_bot'),
  'papel do MAX não é membro de nenhum outro papel (nem authenticated nem service_role)');
SELECT pg_temp.ok(NOT pg_has_role('max_suporte_bot', 'authenticated', 'MEMBER')
  AND NOT pg_has_role('max_suporte_bot', 'service_role', 'MEMBER') AND NOT pg_has_role('max_suporte_bot', 'anon', 'MEMBER')
  AND NOT pg_has_role('max_suporte_bot', 'postgres', 'MEMBER') AND NOT pg_has_role('max_suporte_bot', 'authenticator', 'MEMBER'),
  'MAX não pode virar authenticated, anon, service_role, authenticator nem postgres');
SELECT pg_temp.ok((SELECT array_agg(nspname::text ORDER BY nspname) FROM pg_namespace n
  WHERE has_schema_privilege('max_suporte_bot', n.oid, 'USAGE') AND nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema')
  = ARRAY['max_suporte', 'public'],
  'MAX só alcança os schemas max_suporte e public (auth, storage, vault, extensions fora)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE has_schema_privilege('max_suporte_bot', n.oid, 'USAGE') AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND n.nspname NOT LIKE 'pg\_temp\_%'  -- tabelas temporárias do próprio teste (r, ids)
    AND c.relkind IN ('r','v','m','p','f','S')
    AND (has_table_privilege('max_suporte_bot', c.oid, 'SELECT') OR has_table_privilege('max_suporte_bot', c.oid, 'INSERT')
      OR has_table_privilege('max_suporte_bot', c.oid, 'UPDATE') OR has_table_privilege('max_suporte_bot', c.oid, 'DELETE'))),
  'catálogo: nenhuma tabela ou visão alcançável é legível ou gravável pelo MAX');
SELECT pg_temp.ok((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef AND p.prorettype <> 'trigger'::regtype AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND has_schema_privilege('max_suporte_bot', n.oid, 'USAGE')
    AND has_function_privilege('max_suporte_bot', p.oid, 'EXECUTE'))
  = ARRAY['chamado', 'mudar_status', 'pendentes', 'responder'],
  'catálogo: as ÚNICAS funções privilegiadas que o MAX executa são as 4 de max_suporte');
SELECT pg_temp.ok(NOT has_schema_privilege('max_suporte_bot', 'public', 'CREATE')
  AND NOT has_schema_privilege('max_suporte_bot', 'max_suporte', 'CREATE')
  AND NOT has_database_privilege('max_suporte_bot', current_database(), 'CREATE'),
  'MAX não cria objetos (nem schema, nem tabela, nem função)');
SELECT pg_temp.ok(NOT has_schema_privilege('authenticated', 'max_suporte', 'USAGE')
  AND NOT has_schema_privilege('anon', 'max_suporte', 'USAGE')
  AND NOT has_function_privilege('authenticated', 'max_suporte.responder(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'max_suporte.pendentes(timestamptz,integer)', 'EXECUTE'),
  'usuários do app, anon e service_role NÃO usam as funções do MAX');
SELECT pg_temp.ok((SELECT bool_and(has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')
  AND has_function_privilege('anon', f::regprocedure, 'EXECUTE')
  AND has_function_privilege('service_role', f::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('max_suporte_bot', f::regprocedure, 'EXECUTE'))
  FROM unnest(ARRAY['public.list_active_users()', 'public.change_sale_status(uuid,text,text)',
    'public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)']) f),
  'endurecimento: funções antigas seguem para o app (anon/authenticated/service_role), não para o MAX');

-- ===== Cenário: chamados de duas imobiliárias =====================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('corretor')::text);
INSERT INTO ids SELECT 't1', public.support_ticket_create('duvida',
  'Como gero o contrato de exclusividade? (teste fictício)', '/exclusividades/x', 'Captações › Detalhe');
INSERT INTO ids SELECT 't2', public.support_ticket_create('sugestao', 'Filtro por bairro (ideia fictícia).');
INSERT INTO ids SELECT 't3', public.support_ticket_create('erro', 'Erro fictício que vai ser resolvido.');
SELECT public.support_ticket_set_status(pg_temp.id('t3'), 'resolvido');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
INSERT INTO ids SELECT 'tb', public.support_ticket_create('erro', 'Erro fictício da imobiliária B.');
SELECT pg_temp.as_user(pg_temp.id('equipe')::text);
SELECT public.support_ticket_reply(pg_temp.id('t2'), 'Obrigado pela ideia (fictício).');
SELECT public.support_ticket_reply(pg_temp.id('tb'), 'Nota interna fictícia da equipe.', true);
RESET ROLE;
-- Tudo acima tem o mesmo now() (uma transação): espaça as horas para a ordem ficar como na vida real.
UPDATE public.support_ticket_messages SET created_at = now() - interval '10 minutes' WHERE NOT autor_equipe;
UPDATE public.support_ticket_messages SET created_at = now() - interval '5 minutes' WHERE autor_equipe;

-- ===== Como o MAX ================================================================================
-- (o teste entra no papel com SET ROLE; a sessão real fará login direto como max_suporte_bot)
SET LOCAL ROLE max_suporte_bot;

-- Leitura fora dos chamados: tudo negado.
SELECT pg_temp.ok((SELECT bool_and(pg_temp.err('SELECT 1 FROM ' || t || ' LIMIT 1') LIKE '42501%')
  FROM unnest(ARRAY['public.support_tickets', 'public.support_ticket_messages', 'public.sales', 'public.profiles',
    'public.organizations', 'public.notifications', 'public.user_roles', 'public.platform_admins',
    'public.activity_logs', 'public.occurrences', 'auth.users', 'storage.objects']) t),
  'MAX NÃO lê tabelas direto: chamados, mensagens, vendas, perfis, financeiro, auth, storage...');
SELECT pg_temp.ok(pg_temp.err(format($q$INSERT INTO public.support_ticket_messages (ticket_id, organization_id,
  autor_equipe, texto) VALUES (%L, %L, true, 'x')$q$, pg_temp.id('t1'), :'org_a')) LIKE '42501%'
  AND pg_temp.err('UPDATE public.support_tickets SET status = ''resolvido''') LIKE '42501%'
  AND pg_temp.err('DELETE FROM public.support_ticket_messages') LIKE '42501%'
  AND pg_temp.err('UPDATE public.sales SET status = status') LIKE '42501%',
  'MAX NÃO grava, edita nem apaga direto em tabela nenhuma');

-- Forjar identidade (auth.uid) de alguém da equipe não abre as RPCs do app.
SELECT pg_temp.as_user(pg_temp.id('equipe')::text);
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.support_ticket_list('todos')$q$) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.support_ticket_reply(%L, %L, true)', pg_temp.id('t1'), 'x')) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.support_ticket_set_status(%L, %L)', pg_temp.id('t1'), 'resolvido')) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.support_ticket_print_path(%L)', pg_temp.id('t1'))) LIKE '42501%',
  'MAX fingindo ser da equipe NÃO usa as RPCs do app (lista, resposta, nota interna, status, print)');
SELECT pg_temp.ok((SELECT bool_and(pg_temp.err(q) LIKE '42501%') FROM unnest(ARRAY[
  'SELECT * FROM public.list_active_users()', 'SELECT * FROM public.list_active_corretores()',
  'SELECT public.change_sale_status(gen_random_uuid(), ''x'', NULL)',
  'SELECT * FROM public.cliente_historico(gen_random_uuid(), NULL)',
  'SELECT public.criar_ocorrencia_lancamento(gen_random_uuid())',
  'SELECT public.is_platform_super_admin()', 'SELECT public.current_org_id()']) q),
  'MAX fingindo ser da equipe NÃO executa as funções antigas (vendas, clientes, usuários)');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);

-- (a) Pendentes
SELECT pg_temp.ok((SELECT array_agg(id ORDER BY numero) FROM max_suporte.pendentes())
  = ARRAY[pg_temp.id('t1'), pg_temp.id('tb')],
  'pendentes: t1 (Única) e tb (B); fora: respondido pela equipe (t2) e resolvido (t3)');
SELECT pg_temp.ok((SELECT count(*) FROM max_suporte.pendentes(now() + interval '1 minute')) = 0,
  'pendentes com marcador no futuro: nada (o verificador não acorda a IA)');
SELECT pg_temp.ok((SELECT count(*) FROM max_suporte.pendentes(NULL, 1)) = 1, 'pendentes respeita o limite');

-- (b) Ler
SELECT max_suporte.chamado(pg_temp.id('t1')) AS c1 \gset
SELECT pg_temp.ok((:'c1'::jsonb ->> 'tela_rota') = '/exclusividades/x' AND (:'c1'::jsonb ->> 'tipo') = 'duvida'
  AND jsonb_array_length(:'c1'::jsonb -> 'mensagens') = 1 AND (:'c1'::jsonb ? 'autor_primeiro_nome'),
  'MAX lê o chamado: tipo, rota da tela, conversa e só o primeiro nome do autor');
SELECT pg_temp.ok(NOT (:'c1'::jsonb ?| ARRAY['author_id','organization_id','print_path','email','telefone']),
  'chamado NÃO traz ids, caminho do print, e-mail nem telefone');
SELECT pg_temp.ok((SELECT bool_or((m ->> 'interna')::bool) FROM jsonb_array_elements(max_suporte.chamado(pg_temp.id('tb')) -> 'mensagens') m),
  'MAX vê a nota interna da equipe (para não contradizer a equipe)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT max_suporte.chamado(%L)', pg_temp.id('t3'))) LIKE '42501%',
  'chamado resolvido NÃO é lido');
SELECT pg_temp.ok(pg_temp.err(format('SELECT max_suporte.chamado(%L)', gen_random_uuid())) LIKE '42501%',
  'id inexistente: erro, sem vazar nada');

-- (c) Responder / status
SELECT pg_temp.ok(pg_temp.err(format('SELECT max_suporte.responder(%L, %L, %L)', pg_temp.id('t1'), 'x', 'resolvido')) LIKE '42501%'
  AND pg_temp.err(format('SELECT max_suporte.mudar_status(%L, %L)', pg_temp.id('t1'), 'resolvido')) LIKE '42501%'
  AND pg_temp.err(format('SELECT max_suporte.mudar_status(%L, %L)', pg_temp.id('t1'), 'recebido')) LIKE '42501%',
  'MAX NÃO fecha chamado (resolvido) nem volta para recebido');
SELECT pg_temp.ok(pg_temp.err(format('SELECT max_suporte.responder(%L, %L)', pg_temp.id('t2'), 'x')) LIKE '42501%última mensagem%',
  'MAX NÃO responde chamado cuja última mensagem já é da equipe');
SELECT pg_temp.ok(pg_temp.err(format('SELECT max_suporte.responder(%L, %L)', pg_temp.id('t3'), 'x')) LIKE '42501%',
  'MAX NÃO responde chamado resolvido');
SELECT pg_temp.ok(pg_temp.err(format('SELECT max_suporte.responder(%L, %L)', pg_temp.id('t1'), repeat('a', 3901))) IS NOT NULL,
  'texto acima de 3.900 caracteres é recusado');
SELECT pg_temp.ok(max_suporte.mudar_status(pg_temp.id('tb'), 'em_analise') = 'em_analise',
  'MAX marca Em análise (ex.: encaminhou para Denis)');
SELECT pg_temp.ok(max_suporte.responder(pg_temp.id('t1'),
  'Abra a captação e clique em Gerar contrato (resposta fictícia).') = 'respondido', 'MAX responde: vira Respondido');
SELECT pg_temp.ok(pg_temp.err(format('SELECT max_suporte.responder(%L, %L)', pg_temp.id('t1'), 'de novo')) LIKE '42501%',
  'MAX NÃO responde duas vezes seguidas (aguarda o usuário)');
SELECT pg_temp.ok((SELECT array_agg(id) FROM max_suporte.pendentes()) = ARRAY[pg_temp.id('tb')],
  'depois da resposta, t1 sai dos pendentes');
RESET ROLE;

-- ===== Conferência (como postgres) e visão do usuário ============================================
SELECT pg_temp.ok((SELECT count(*) = 1 AND bool_and(autor_equipe AND NOT interna AND author_id IS NULL
  AND texto LIKE '%— MAX') FROM public.support_ticket_messages WHERE ticket_id = pg_temp.id('t1') AND autor_equipe),
  'resposta gravada como equipe, pública, sem autor humano e assinada "— MAX"');
SELECT pg_temp.ok((SELECT status = 'em_analise' FROM public.support_tickets WHERE id = pg_temp.id('tb'))
  AND (SELECT count(*) FROM public.support_ticket_messages WHERE ticket_id = pg_temp.id('tb')) = 2,
  'mudar status não cria mensagem nem mexe na conversa');
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE support_ticket_id = pg_temp.id('t1')
  AND user_id = pg_temp.id('corretor') AND organization_id = :'org_a' AND tipo = 'suporte_resposta') = 1,
  'autor recebe 1 aviso no sino, na imobiliária dele');
UPDATE public.support_ticket_messages SET created_at = now() - interval '1 minute'
 WHERE ticket_id = pg_temp.id('t1') AND autor_equipe;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('corretor')::text);
SELECT pg_temp.ok((SELECT count(*) = 2 AND bool_or(autor_nome = 'Equipe MAX' AND texto LIKE '%— MAX')
  FROM public.support_ticket_thread(pg_temp.id('t1'))), 'autor vê a resposta como "Equipe MAX", assinada MAX');
SELECT pg_temp.ok(public.support_ticket_reply(pg_temp.id('t1'), 'Não achei o botão (fictício).') = 'em_analise',
  'autor responde de volta: volta para Em análise');
RESET ROLE;
SET LOCAL ROLE max_suporte_bot;
SELECT pg_temp.ok((SELECT count(*) FROM max_suporte.pendentes()) = 2,
  'resposta nova do usuário faz o chamado voltar aos pendentes');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) || ' de ' || count(*) FROM r;
