-- Suíte do banner do Início (migration 20261121120000, cartão t_75786f5c).
-- Transação revertida, homologação ou banco local; nunca produção. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx_m', '', true) $$;
CREATE FUNCTION pg_temp.titulos() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(e->>'titulo', ',' ORDER BY ord), '') FROM jsonb_array_elements(public.home_banners_ativos()) WITH ORDINALITY t(e, ord) $$;
CREATE FUNCTION pg_temp.salvar(_id uuid, _titulo text, _path text, _link text, _ini date, _fim date, _pub text[], _ordem int)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.home_banner_salvar(_id, _titulo, _path, _link, _ini, _fim, _pub, _ordem, true) $$;
-- Leitura da tabela só para conferência (como dono da sessão de teste; o navegador não tem esse acesso).
CREATE FUNCTION pg_temp.bid(_t text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT id FROM public.home_banners WHERE titulo = _t $$;
CREATE FUNCTION pg_temp.pub(_t text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT publico FROM public.home_banners WHERE titulo = _t $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set org_b 'b0000000-0000-4000-8000-0000000000b0'
\set admin 'a0000000-0000-4000-8000-0000000000b1'
\set staff 'a0000000-0000-4000-8000-0000000000b2'
\set cor 'a0000000-0000-4000-8000-0000000000b3'
\set ges 'a0000000-0000-4000-8000-0000000000b4'
\set foto 'a0000000-0000-4000-8000-0000000000b5'
\set fin 'a0000000-0000-4000-8000-0000000000b6'
\set sadm 'a0000000-0000-4000-8000-0000000000b7'
\set adb 'b0000000-0000-4000-8000-0000000000b1'
\set corb 'b0000000-0000-4000-8000-0000000000b3'

-- Montagem ---------------------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-banner-a', 'Imobiliaria Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-banner-b', 'Imobiliaria Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'staff', :'cor', :'ges', :'foto', :'fin', :'sadm', :'adb', :'corb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id, telefone) VALUES
  (:'admin', 'Admin A', 'ba@exemplo.test', true, :'org_a', '15990000001'),
  (:'staff', 'Staff A', 'bs@exemplo.test', true, :'org_a', '15990000002'),
  (:'cor', 'Corretor A', 'bc@exemplo.test', true, :'org_a', '15990000003'),
  (:'ges', 'Gestor A', 'bg@exemplo.test', true, :'org_a', '15990000004'),
  (:'foto', 'Foto A', 'bf@exemplo.test', true, :'org_a', NULL),
  (:'fin', 'Fin A', 'bfi@exemplo.test', true, :'org_a', '15990000006'),
  (:'sadm', 'Principal A', 'bp@exemplo.test', true, :'org_a', '15990000007'),
  (:'adb', 'Admin B', 'bab@exemplo.test', true, :'org_b', '15990000008'),
  (:'corb', 'Corretor B', 'bcb@exemplo.test', true, :'org_b', '15990000009');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'staff', true), (:'org_a', :'cor', true), (:'org_a', :'ges', true),
  (:'org_a', :'foto', true), (:'org_a', :'fin', true), (:'org_a', :'sadm', true),
  (:'org_b', :'adb', true), (:'org_b', :'corb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'staff', 'staff', :'org_a'), (:'cor', 'corretor', :'org_a'),
  (:'ges', 'gestor', :'org_a'), (:'foto', 'fotografo', :'org_a'), (:'fin', 'financeiro', :'org_a'),
  (:'sadm', 'super_admin', :'org_a'), (:'adb', 'admin', :'org_b'), (:'corb', 'corretor', :'org_b');
-- Arquivos "enviados" (só o registro no catálogo; transação revertida).
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('home-banners', :'org_a' || '/11111111-1111-4111-8111-111111111111.jpg'),
  ('home-banners', :'org_a' || '/22222222-2222-4222-8222-222222222222.png'),
  ('home-banners', :'org_a' || '/33333333-3333-4333-8333-333333333333.webp'),
  ('home-banners', :'org_a' || '/44444444-4444-4444-8444-444444444444.jpg'),
  ('home-banners', :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg'),
  ('home-banners', :'org_b' || '/66666666-6666-4666-8666-666666666666.jpg');
SET LOCAL session_replication_role = origin;

SELECT pg_temp.ok((SELECT public FROM storage.buckets WHERE id = 'home-banners') IS FALSE, 'bucket home-banners e privado');
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.home_banners'::regclass), 'RLS ligada em home_banners');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.home_banners', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.home_banners', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.home_banners', 'SELECT'), 'navegador sem acesso direto a tabela');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.home_banners_ativos()', 'EXECUTE'), 'anon nao chama home_banners_ativos');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (qual LIKE '%home-banners%' OR with_check LIKE '%home-banners%')) = 0, 'nenhuma politica de storage abre o bucket ao navegador');

-- 1) Admin A cadastra -------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.home_banner_pode_gerir(), 'admin A pode gerir');
SELECT pg_temp.ok((public.home_banner_preparar_envio('png')->>'path') ~ ('^' || :'org_a' || '/[0-9a-f-]{36}[.]png$'),
  'caminho do envio fica na pasta da imobiliaria A');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.home_banner_preparar_envio('pdf')$q$) LIKE '22023%', 'envio recusa PDF');
SELECT pg_temp.salvar(NULL, 'Todos hoje', :'org_a' || '/11111111-1111-4111-8111-111111111111.jpg', '/vendas',
  current_date - 1, current_date + 5, '{}', 2);
SELECT pg_temp.salvar(NULL, 'So corretor', :'org_a' || '/22222222-2222-4222-8222-222222222222.png', 'https://exemplo.test/x',
  current_date, current_date, ARRAY['corretor'], 1);
SELECT pg_temp.salvar(NULL, 'Venceu ontem', :'org_a' || '/33333333-3333-4333-8333-333333333333.webp', NULL,
  current_date - 10, current_date - 1, '{}', 0);
SELECT pg_temp.salvar(NULL, 'Comeca amanha', :'org_a' || '/44444444-4444-4444-8444-444444444444.jpg', NULL,
  current_date + 1, current_date + 9, '{}', 0);
SELECT pg_temp.ok(jsonb_array_length(public.home_banners_lista()) = 4, 'admin A lista os 4 banners da A');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Link ruim', %L, 'javascript:alert(1)', current_date, current_date, '{}', 0)$q$,
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg')) LIKE '22023%Link%', 'link javascript: recusado');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Link ruim', %L, '//evil.test', current_date, current_date, '{}', 0)$q$,
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg')) LIKE '22023%Link%', 'link //host recusado');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Link http', %L, 'http://exemplo.test', current_date, current_date, '{}', 0)$q$,
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg')) LIKE '22023%Link%', 'link http (sem s) recusado');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Datas', %L, NULL, current_date, current_date - 1, '{}', 0)$q$,
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg')) LIKE '22023%data final%', 'fim antes do inicio recusado');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Publico', %L, NULL, current_date, current_date, ARRAY['dono'], 0)$q$,
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg')) LIKE '22023%blico%', 'papel inexistente no publico recusado');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Publico', %L, NULL, current_date, current_date, ARRAY['fotografo'], 0)$q$,
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg')) LIKE '22023%blico%', 'fotografo nao pode ser publico (nao ve o Inicio)');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Imagem B', %L, NULL, current_date, current_date, '{}', 0)$q$,
  :'org_b' || '/66666666-6666-4666-8666-666666666666.jpg')) LIKE '22023%Imagem%', 'admin A nao usa imagem da pasta da B');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Sem arquivo', %L, NULL, current_date, current_date, '{}', 0)$q$,
  :'org_a' || '/77777777-7777-4777-8777-777777777777.jpg')) LIKE '22023%Imagem%', 'imagem nao enviada recusada');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Repetida', %L, NULL, current_date, current_date, '{}', 0)$q$,
  :'org_a' || '/11111111-1111-4111-8111-111111111111.jpg')) LIKE '22023%Imagem%', 'mesma imagem em dois banners recusada');
-- Admin vê só os do público dele ("Todos hoje"); vencido e futuro não aparecem.
SELECT pg_temp.ok(pg_temp.titulos() = 'Todos hoje', 'admin A no Inicio: so "Todos hoje" (vencido/futuro/so-corretor fora) — ' || pg_temp.titulos());
RESET ROLE;

-- 2) Corretor A: vê, não cadastra --------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'cor');
SELECT pg_temp.ok(pg_temp.titulos() = 'So corretor,Todos hoje', 'corretor A ve os 2 do dia na ordem — ' || pg_temp.titulos());
SELECT pg_temp.ok(NOT public.home_banner_pode_gerir(), 'corretor nao pode gerir');
SELECT pg_temp.ok(pg_temp.err('SELECT public.home_banners_lista()') LIKE '42501%', 'corretor nao lista o cadastro');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.home_banner_preparar_envio('jpg')$q$) LIKE '42501%', 'corretor nao prepara envio');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Do corretor', %L, NULL, current_date, current_date, '{}', 0)$q$,
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg')) LIKE '42501%', 'corretor nao cadastra banner');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT public.home_banner_ativar(%L, false)$q$,
  pg_temp.bid('Todos hoje'))) LIKE '42501%', 'corretor nao desativa banner');
SELECT pg_temp.ok(pg_temp.err('SELECT 1 FROM public.home_banners') LIKE '42501%', 'corretor nao le a tabela direto');
RESET ROLE;

-- 3) Gestor e financeiro: público "todos" ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'ges');
SELECT pg_temp.ok(pg_temp.titulos() = 'Todos hoje', 'gestor A ve so o banner de todos');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Do gestor', %L, NULL, current_date, current_date, '{}', 0)$q$,
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg')) LIKE '42501%', 'gestor nao cadastra banner');
SELECT pg_temp.as_user(:'fin');
SELECT pg_temp.ok(pg_temp.err('SELECT public.home_banners_lista()') LIKE '42501%', 'financeiro nao gerencia banner');
RESET ROLE;

-- 4) Staff e Administrador principal gerenciam ------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'staff');
SELECT pg_temp.ok(public.home_banner_pode_gerir(), 'staff A pode gerir');
SELECT pg_temp.ok((public.home_banner_salvar(pg_temp.bid('So corretor'), 'So corretor e gestor',
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg', NULL, current_date, current_date,
  ARRAY['corretor', 'gestor', 'gestor', ' '], 1, true)->>'path_antigo') = :'org_a' || '/22222222-2222-4222-8222-222222222222.png',
  'staff edita: troca a imagem e devolve a antiga para apagar');
SELECT pg_temp.ok(pg_temp.pub('So corretor e gestor') = ARRAY['corretor', 'gestor'],
  'publico sem repeticao nem vazio');
SELECT pg_temp.as_user(:'sadm');
SELECT pg_temp.ok(public.home_banner_pode_gerir() AND jsonb_array_length(public.home_banners_lista()) = 4, 'administrador principal gerencia');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'ges');
SELECT pg_temp.ok(pg_temp.titulos() = 'So corretor e gestor,Todos hoje', 'gestor passa a ver o banner com gestor no publico');
RESET ROLE;

-- 5) Fotógrafo: nada ---------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok(public.home_banners_ativos() = '[]'::jsonb, 'so-fotografo nao recebe banner (nem o de todos)');
SELECT pg_temp.ok(NOT public.home_banner_pode_gerir(), 'fotografo nao gerencia');
RESET ROLE;

-- 6) Imobiliária B: não vê nem mexe na A ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'adb');
SELECT pg_temp.ok(public.home_banner_pode_gerir(), 'admin B gerencia a propria');
SELECT pg_temp.ok(public.home_banners_lista() = '[]'::jsonb, 'admin B nao lista banners da A');
SELECT pg_temp.ok(public.home_banners_ativos() = '[]'::jsonb, 'admin B nao ve banner da A no Inicio');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT public.home_banner_ativar(%L, false)$q$,
  pg_temp.bid('Todos hoje'))) LIKE 'P0002%', 'admin B nao desativa banner da A');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT public.home_banner_excluir(%L)$q$,
  pg_temp.bid('Todos hoje'))) LIKE 'P0002%', 'admin B nao exclui banner da A');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(%L, 'Sequestro', %L, NULL, current_date, current_date, '{}', 0)$q$,
  pg_temp.bid('Todos hoje'), :'org_b' || '/66666666-6666-4666-8666-666666666666.jpg')) LIKE 'P0002%',
  'admin B nao edita banner da A');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT pg_temp.salvar(NULL, 'Imagem A', %L, NULL, current_date, current_date, '{}', 0)$q$,
  :'org_a' || '/55555555-5555-4555-8555-555555555555.jpg')) LIKE '22023%Imagem%', 'admin B nao usa imagem da pasta da A');
SELECT pg_temp.salvar(NULL, 'Banner B', :'org_b' || '/66666666-6666-4666-8666-666666666666.jpg', NULL, current_date, current_date, '{}', 0);
SELECT pg_temp.ok(pg_temp.titulos() = 'Banner B', 'admin B ve so o proprio');
SELECT pg_temp.as_user(:'corb');
SELECT pg_temp.ok(pg_temp.titulos() = 'Banner B', 'corretor B ve so o banner da B');
SELECT pg_temp.as_user(:'cor');
SELECT pg_temp.ok(pg_temp.titulos() = 'So corretor e gestor,Todos hoje', 'corretor A nao ve o banner da B');
RESET ROLE;

-- 7) Desativar, inativo na agência e excluir ---------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT public.home_banner_ativar(pg_temp.bid('Todos hoje'), false);
SELECT pg_temp.as_user(:'cor');
SELECT pg_temp.ok(pg_temp.titulos() = 'So corretor e gestor', 'banner desativado sai do Inicio na hora');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok((public.home_banner_excluir(pg_temp.bid('Venceu ontem'))->>'path')
  = :'org_a' || '/33333333-3333-4333-8333-333333333333.webp', 'excluir devolve o caminho da imagem');
SELECT pg_temp.ok(jsonb_array_length(public.home_banners_lista()) = 3, 'sobram 3 na A');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET ativo = false WHERE id = :'cor';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'cor');
SELECT pg_temp.ok(public.home_banners_ativos() = '[]'::jsonb, 'usuario desativado nao recebe banner');
RESET ROLE;

-- 8) Sem login ---------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(public.home_banners_ativos() = '[]'::jsonb, 'sem usuario: lista vazia');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
