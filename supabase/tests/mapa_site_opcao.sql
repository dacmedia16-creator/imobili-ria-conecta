-- Suíte da opção "imóveis do site RE/MAX no Mapa de captações" (migration 20261013210000, t_e02a7b17).
-- Roda DENTRO de transação revertida (run-mapa-site-opcao.sh). Homologação: A = Única, B = agencia-b-homolog.
-- Dados fictícios (IDs 630699xxx).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
UPDATE public.organization_modules SET enabled = true
 WHERE module = 'captacao_exclusiva' AND organization_id IN (:'org_a', :'org_b');

-- 0) Padrão ligado em todas as imobiliárias
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.organizations WHERE mapa_site_enabled IS DISTINCT FROM true),
  'padrão: todas as imobiliárias começam LIGADAS');
SELECT pg_temp.ok((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public'
  AND table_name = 'organizations' AND column_name = 'mapa_site_enabled') = 'true', 'imobiliária nova nasce ligada');

-- Coleta fictícia na A: 2 anúncios de venda ativos com coordenada
DELETE FROM public.remax_site_listings WHERE organization_id IN (:'org_a', :'org_b');
DELETE FROM public.remax_site_runs WHERE organization_id IN (:'org_a', :'org_b');
SELECT pg_temp.ok((public.remax_site_ingest(:'org_a', jsonb_build_array(
  jsonb_build_object('code','630699001-11','agent_id','630699001','office_id',63059,'status_uid',160,'transacao','venda',
    'tipo','casa','rua','Rua Fictícia A','bairro','Jardim Teste','cidade','Sorocaba','lat',-23.50,'lon',-47.45,'preco',650000),
  jsonb_build_object('code','630699077-12','agent_id','630699077','office_id',63059,'status_uid',160,'transacao','venda',
    'tipo','apartamento','rua','Rua Fictícia B','bairro','Centro Teste','cidade','Sorocaba','lat',-23.51,'lon',-47.46,'preco',300000)
), '[]'::jsonb, now())->>'status') = 'ok', 'coleta fictícia registrada');

-- 1) Ligado: camada aparece
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 2, 'ligado: corretor vê os 2 anúncios do site');

-- 2) Corretor e gestor NÃO alteram
SELECT pg_temp.ok(pg_temp.err('SELECT public.mapa_site_set_enabled(false)') LIKE '42501%', 'corretor: não pode desligar');
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.mapa_site_set_enabled(false)') LIKE '42501%', 'gestor: não pode desligar');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.organizations SET mapa_site_enabled = false') LIKE '42501%',
  'ninguém altera a coluna direto na tabela');
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err('SELECT public.mapa_site_set_enabled(false)') LIKE '42501%', 'anon: sem permissão');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT public.mapa_site_set_enabled(false)') LIKE '42501%', 'sem login: barrado');
RESET ROLE;
SELECT pg_temp.ok((SELECT mapa_site_enabled FROM public.organizations WHERE id = :'org_a'), 'após as tentativas negadas: segue ligado');

-- 3) Admin da A desliga: servidor para de devolver; B não é afetada
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.mapa_site_set_enabled(NULL)') LIKE '22023%', 'valor nulo recusado');
SELECT pg_temp.ok(public.mapa_site_set_enabled(false) = false, 'admin da A: desliga');
SELECT pg_temp.ok((SELECT mapa_site_enabled FROM public.organizations WHERE id = :'org_a') = false, 'admin lê o estado desligado');
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 0, 'desligado: admin não recebe anúncios');
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 0, 'desligado: corretor não recebe anúncios (bloqueio no servidor)');
SELECT pg_temp.ok(public.exclusive_capture_enabled(), 'captações continuam ligadas');
RESET ROLE;
SELECT pg_temp.ok((SELECT mapa_site_enabled FROM public.organizations WHERE id = :'org_b'), 'imobiliária B segue ligada');
SET LOCAL ROLE authenticated;

-- 4) Admin da B só mexe na própria
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(public.mapa_site_set_enabled(false) = false, 'admin da B: desliga a própria');
RESET ROLE;
SELECT pg_temp.ok((SELECT mapa_site_enabled FROM public.organizations WHERE id = :'org_a') = false
  AND (SELECT mapa_site_enabled FROM public.organizations WHERE id = :'org_b') = false, 'cada admin altera só a própria imobiliária');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(public.mapa_site_set_enabled(true), 'admin da B: religa');
RESET ROLE;
SELECT pg_temp.ok((SELECT mapa_site_enabled FROM public.organizations WHERE id = :'org_a') = false, 'religar a B não mexe na A');

-- 5) Admin da A religa: camada volta
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok(public.mapa_site_set_enabled(true), 'admin da A: religa');
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 2, 'religado: anúncios voltam');
RESET ROLE;

-- 6) Usuário admin inativo não altera
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('gestor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.mapa_site_set_enabled(false)') LIKE '42501%', 'usuário inativo: barrado');
RESET ROLE;

SELECT pg_temp.ok((SELECT provolatile FROM pg_proc WHERE proname = 'mapa_anuncios_site') = 's', 'mapa_anuncios_site segue só-leitura (STABLE)');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
