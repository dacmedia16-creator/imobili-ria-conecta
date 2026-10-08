-- Suíte "Ajuda e sugestões" (migration 20261008220000). Roda DENTRO de transação revertida
-- (run-ajuda-sugestoes.sh). Homologação: A = Única (00000000-…-0001), B = agencia-b-homolog (faz o
-- papel da REMAX-TESTE). Perfis: corretor A (UE Corretor), outro corretor A (QA A Corretor Tres),
-- admin A (QA A Admin), equipe MAX (QA A Dono Plataforma, em platform_admins) e admin B (QA B Admin).
-- Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.n_list(_escopo text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM public.support_ticket_list(_escopo) $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('corretor', '10000000-0000-4000-8000-000000000003'),
  ('colega', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('equipe', 'b316b223-da46-4c2c-9952-25096d5ae5ff'), ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.platform_admins WHERE user_id = pg_temp.id('equipe')),
  'pré: equipe MAX está em platform_admins');
SELECT pg_temp.ok((SELECT public FROM storage.buckets WHERE id = 'support-attachments') IS FALSE,
  'bucket support-attachments existe e é PRIVADO');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.support_tickets', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.support_ticket_messages', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.support_tickets', 'SELECT'),
  'tabelas: sem INSERT/UPDATE direto para authenticated e nada para anon');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.support_ticket_create(text,text,text,text,text,text)', 'EXECUTE'),
  'RPC de abrir chamado não executa como anon');

-- ===== Print: o navegador não acessa o bucket; o servidor envia com service_role =================
INSERT INTO ids VALUES ('print', gen_random_uuid());
SELECT (:'org_a' || '/' || pg_temp.id('corretor') || '/' || pg_temp.id('print') || '.png') AS print_path \gset
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('corretor')::text);
SELECT pg_temp.ok(pg_temp.err(format($q$INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('support-attachments', %L, %L)$q$, :'org_a' || '/' || pg_temp.id('corretor') || '/' || gen_random_uuid() || '.png',
  pg_temp.id('corretor'))) LIKE '42501%', 'navegador NÃO grava direto no bucket (nem na própria pasta)');
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true), set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format($q$INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('support-attachments', %L, '{"mimetype":"image/png"}')$q$, :'print_path')) IS NULL,
  'servidor grava o print do corretor na pasta dele');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('corretor')::text);
SELECT pg_temp.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'support-attachments') = 0,
  'nem o autor lista o bucket direto (link só pelo servidor)');

-- ===== Abrir chamados =========================================================================
INSERT INTO ids SELECT 't1', public.support_ticket_create('erro',
  'Cliquei em Gerar contrato e a tela ficou carregando (teste fictício).', '/exclusividades/x',
  'Captações exclusivas › Detalhe', 'Mozilla/5.0 teste', :'print_path');
SELECT pg_temp.ok(pg_temp.id('t1') IS NOT NULL, 'corretor abre chamado (Erro) com print e tela');
SELECT pg_temp.ok(public.support_ticket_print_path(pg_temp.id('t1')) = :'print_path',
  'autor obtém o caminho do próprio print (para o link assinado)');
INSERT INTO ids SELECT 't2', public.support_ticket_create('sugestao', 'Filtro por bairro nas captações (ideia fictícia).');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.support_ticket_create('outro', 'texto qualquer')$q$) IS NOT NULL,
  'tipo inválido é recusado');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.support_ticket_create('duvida', 'oi')$q$) LIKE '%5 caracteres%',
  'texto curto demais é recusado');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT public.support_ticket_create('erro', 'reusando o print de novo', NULL, NULL, NULL, %L)$q$,
  :'print_path')) LIKE '%Print inválido%', 'o mesmo print não entra em dois chamados');
SELECT pg_temp.ok((SELECT status = 'recebido' AND organization_id = :'org_a' AND author_id = pg_temp.id('corretor')
  FROM public.support_tickets WHERE id = pg_temp.id('t1')), 'chamado nasce Recebido, na imobiliária e no autor certos');

SELECT pg_temp.as_user(pg_temp.id('colega')::text);
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT public.support_ticket_create('erro', 'print de outro usuário', NULL, NULL, NULL, %L)$q$,
  :'print_path')) LIKE '%Print inválido%', 'colega NÃO anexa o print de outro usuário');

SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
INSERT INTO ids SELECT 'tb', public.support_ticket_create('duvida', 'Dúvida fictícia da imobiliária B.');
SELECT pg_temp.ok((SELECT organization_id = :'org_b' FROM public.support_tickets WHERE id = pg_temp.id('tb')),
  'admin B abre chamado na imobiliária B');

-- ===== Leituras por perfil =====================================================================
SELECT pg_temp.as_user(pg_temp.id('corretor')::text);
SELECT pg_temp.ok(pg_temp.n_list('meus') = 2, 'corretor: Meus chamados = 2');
SELECT pg_temp.ok(pg_temp.err($q$SELECT pg_temp.n_list('org')$q$) LIKE '42501%', 'corretor NÃO vê a lista da imobiliária');
SELECT pg_temp.ok(pg_temp.err($q$SELECT pg_temp.n_list('todos')$q$) LIKE '42501%', 'corretor NÃO vê a central da equipe MAX');
SELECT pg_temp.ok((SELECT count(*) FROM public.support_tickets) = 2, 'corretor: SELECT direto mostra só os 2 dele');

SELECT pg_temp.as_user(pg_temp.id('colega')::text);
SELECT pg_temp.ok(pg_temp.n_list('meus') = 0 AND (SELECT count(*) FROM public.support_tickets) = 0,
  'outro corretor da mesma imobiliária: 0 chamados alheios');
SELECT pg_temp.ok((SELECT count(*) FROM public.support_ticket_thread(pg_temp.id('t1'))) = 0,
  'outro corretor: conversa alheia vazia');
SELECT pg_temp.ok(public.support_ticket_print_path(pg_temp.id('t1')) IS NULL,
  'outro corretor NÃO lê o print (nem gera link assinado)');

SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok(pg_temp.n_list('org') = 2, 'admin da Única: vê os 2 chamados da própria imobiliária');
SELECT pg_temp.ok((SELECT bool_and(print_path IS NULL) AND bool_or(tem_print) FROM public.support_ticket_list('org')),
  'admin da Única: sabe que há print, mas não recebe o caminho');
SELECT pg_temp.ok(public.support_ticket_print_path(pg_temp.id('t1')) IS NULL,
  'admin da Única NÃO lê o print');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.support_ticket_reply(%L, %L)', pg_temp.id('t1'), 'tentando responder'))
  LIKE '42501%Somente leitura%', 'admin da Única NÃO responde (só leitura)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.support_ticket_set_status(%L, %L)', pg_temp.id('t1'), 'resolvido'))
  LIKE '42501%', 'admin da Única NÃO muda status');
SELECT pg_temp.ok(pg_temp.err($q$SELECT pg_temp.n_list('todos')$q$) LIKE '42501%', 'admin da Única NÃO vê a central');

SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(pg_temp.n_list('org') = 1 AND NOT EXISTS (
  SELECT 1 FROM public.support_ticket_list('org') WHERE organization_id = :'org_a'),
  'REMAX-TESTE (admin B): vê 0 chamados da Única (só o seu)');
SELECT pg_temp.ok((SELECT count(*) FROM public.support_tickets WHERE organization_id = :'org_a') = 0
  AND (SELECT count(*) FROM public.support_ticket_messages WHERE organization_id = :'org_a') = 0,
  'REMAX-TESTE: SELECT direto não alcança chamados/mensagens da Única');
SELECT pg_temp.ok((SELECT count(*) FROM public.support_ticket_thread(pg_temp.id('t1'))) = 0,
  'REMAX-TESTE: conversa da Única vazia');
SELECT pg_temp.ok(public.support_ticket_print_path(pg_temp.id('t1')) IS NULL,
  'REMAX-TESTE NÃO lê o print da Única');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.support_ticket_reply(%L, %L)', pg_temp.id('t1'), 'x')) LIKE '42501%',
  'REMAX-TESTE NÃO responde chamado da Única');

-- ===== Equipe MAX ==============================================================================
SELECT pg_temp.as_user(pg_temp.id('equipe')::text);
SELECT pg_temp.ok(pg_temp.n_list('todos') >= 3 AND (SELECT count(DISTINCT organization_id) >= 2 FROM public.support_ticket_list('todos')),
  'equipe MAX: central com chamados de todas as imobiliárias');
SELECT pg_temp.ok(public.support_ticket_print_path(pg_temp.id('t1')) = :'print_path',
  'equipe MAX lê o print ligado ao chamado (link assinado)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.support_ticket_set_status(%L, %L)', pg_temp.id('t1'), 'em_analise')) IS NULL,
  'equipe MAX muda o status sem erro');
SELECT pg_temp.ok((SELECT status FROM public.support_tickets WHERE id = pg_temp.id('t1')) = 'em_analise',
  'equipe MAX muda para Em análise');
SELECT pg_temp.ok(public.support_ticket_reply(pg_temp.id('t1'), 'Reproduzido: falta CEP (nota interna fictícia).', true) = 'em_analise',
  'nota interna não muda o status');
SELECT pg_temp.ok(public.support_ticket_reply(pg_temp.id('t1'), 'Preencha o CEP e gere de novo (resposta fictícia).') = 'respondido',
  'resposta da equipe MAX vira Respondido');
SELECT pg_temp.ok((SELECT count(*) FROM public.support_ticket_thread(pg_temp.id('t1'))) = 3,
  'equipe MAX vê a conversa completa (inclusive a nota interna)');

SELECT pg_temp.as_user(pg_temp.id('corretor')::text);
SELECT pg_temp.ok((SELECT count(*) = 2 AND NOT bool_or(interna) AND bool_or(autor_nome = 'Equipe MAX')
  FROM public.support_ticket_thread(pg_temp.id('t1'))), 'autor vê a resposta e NÃO vê a nota interna');
SELECT pg_temp.ok((SELECT count(*) FROM public.support_ticket_messages WHERE interna) = 0,
  'autor: SELECT direto também esconde a nota interna');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.support_ticket_reply(%L, %L, true)', pg_temp.id('t1'), 'x')) LIKE '42501%',
  'autor NÃO escreve nota interna');
SELECT pg_temp.ok(public.support_ticket_reply(pg_temp.id('t1'), 'Ainda não deu certo (fictício).') = 'em_analise',
  'autor responde: volta para Em análise');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.support_ticket_set_status(%L, %L)', pg_temp.id('t1'), 'recebido')) LIKE '42501%',
  'autor só pode marcar Resolvido');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.support_ticket_set_status(%L, %L)', pg_temp.id('t1'), 'resolvido')) IS NULL,
  'autor marca Resolvido sem erro');
SELECT pg_temp.ok((SELECT status = 'resolvido' AND resolved_at IS NOT NULL FROM public.support_tickets WHERE id = pg_temp.id('t1')),
  'autor marca Resolvido');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.support_ticket_reply(%L, %L)', pg_temp.id('t1'), 'x')) LIKE '%resolvido%',
  'chamado resolvido não recebe nova resposta do autor');

SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok((SELECT count(*) = 3 AND NOT bool_or(interna) FROM public.support_ticket_thread(pg_temp.id('t1'))),
  'admin da Única lê a conversa sem a nota interna');

-- ===== Sino (como o servidor grava) ============================================================
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true), set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE service_role;
INSERT INTO r SELECT e IS NULL, 'sino: servidor avisa a equipe MAX com link do chamado de outra imobiliária ' || coalesce(e, '')
  FROM pg_temp.err(format($q$INSERT INTO public.notifications (user_id, tipo, titulo, mensagem, support_ticket_id)
  VALUES (%L, 'suporte_novo', 't', 'm', %L)$q$, pg_temp.id('equipe'), pg_temp.id('tb'))) e;
INSERT INTO r SELECT e IS NULL, 'sino: servidor avisa o autor da resposta ' || coalesce(e, '')
  FROM pg_temp.err(format($q$INSERT INTO public.notifications (user_id, tipo, titulo, mensagem, support_ticket_id)
  VALUES (%L, 'suporte_resposta', 't', 'm', %L)$q$, pg_temp.id('corretor'), pg_temp.id('t1'))) e;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE support_ticket_id IS NOT NULL) = 0,
  'REMAX-TESTE não vê avisos de chamado de outros');
SELECT pg_temp.as_user(pg_temp.id('corretor')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE support_ticket_id = pg_temp.id('t1')) = 1,
  'autor vê o aviso de resposta no sino');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) || ' de ' || count(*) FROM r;
