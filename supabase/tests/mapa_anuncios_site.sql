-- Suíte da camada "anúncios do site RE/MAX" no mapa (migration 20261013200000). Roda DENTRO de transação
-- revertida (run-mapa-anuncios-site.sh). Homologação: A = Única (00000000-…-0001), B = agencia-b-homolog.
-- Perfis: captador (UE Corretor), gestor (UE Gestor), corretor de outra equipe, admin e admin da B.
-- Dados fictícios (IDs 630699xxx, endereços inventados).
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
  ('outra', 'ebffaded-075c-493f-89e2-1d3d62901dc4'),
  ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
UPDATE public.organization_modules SET enabled = true
 WHERE module IN ('captacao_exclusiva', 'feedback_proprietario') AND organization_id IN (:'org_a', :'org_b');
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
UPDATE public.profiles SET remax_id = '630699001' WHERE id = pg_temp.id('captador');

-- 0) Antes de qualquer coleta: camada vazia, sem erro
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.mapa_anuncios_site()') IS NULL, 'sem coleta: a função responde sem erro');
RESET ROLE;
DELETE FROM public.remax_site_listings WHERE organization_id IN (:'org_a', :'org_b');
DELETE FROM public.remax_site_runs WHERE organization_id IN (:'org_a', :'org_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 0, 'imobiliária sem coleta boa: camada vazia');
RESET ROLE;

-- 1) Coleta fictícia: -11 ativo c/ coordenada; -12 ativo c/ coordenada (corretor sem usuário);
--    -13 ativo SEM coordenada; -14 inativo (168)
CREATE TEMP TABLE coleta AS SELECT jsonb_build_array(
  jsonb_build_object('code','630699001-11','agent_id','630699001','office_id',63059,'status_uid',160,'exclusivo',true,'transacao','venda',
    'tipo','casa','rua','Rua das Acácias Fictícias','numero','120','bairro','Jardim Teste','cidade','Sorocaba','lat',-23.50000,'lon',-47.45000,
    'area',150,'quartos',3,'preco',650000,'url','https://www.remax.com.br/pt-br/imoveis/casa/venda/sorocaba/120-rua/630699001-11'),
  jsonb_build_object('code','630699077-12','agent_id','630699077','office_id',63059,'status_uid',160,'transacao','venda',
    'tipo','apartamento','rua','Avenida Fictícia','numero','300','bairro','Centro Teste','cidade','Sorocaba','lat',-23.51,'lon',-47.46,
    'area',60,'quartos',1,'preco',300000),
  jsonb_build_object('code','630699077-15','agent_id','630699077','office_id',63059,'status_uid',160,'transacao','locacao',
    'tipo','apartamento','rua','Rua Aluguel Fictícia','numero','5','bairro','Centro Teste','cidade','Sorocaba','lat',-23.515,'lon',-47.465,
    'area',50,'quartos',1,'preco',2500),
  jsonb_build_object('code','630699001-13','agent_id','630699001','office_id',63059,'status_uid',160,'transacao','venda',
    'tipo','casa','rua','Rua Sem Mapa','numero','9','bairro','Jardim Teste'),
  jsonb_build_object('code','630699001-14','agent_id','630699001','office_id',63059,'status_uid',168,'transacao','venda',
    'tipo','casa','rua','Rua Inativa','numero','1','bairro','Jardim Teste','lat',-23.52,'lon',-47.47)
) AS l, jsonb_build_array(
  jsonb_build_object('agent_id','630699001','nome','Nome Site Captador','office_id',63059),
  jsonb_build_object('agent_id','630699077','nome','Corretor Sem Usuário','office_id',63059)
) AS a;
SELECT pg_temp.ok((public.remax_site_ingest(:'org_a', (SELECT l FROM coleta), (SELECT a FROM coleta), now())->>'status') = 'ok', 'coleta fictícia registrada');

-- Captação c1 (do captador), ligada ao -11 pelo fluxo do PR #56
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'c1', public.exclusive_create_unit(pg_temp.id('unit_a'));
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 20, geo_lat = -23.50010, geo_lon = -47.45005
 WHERE id = pg_temp.id('c1');
CREATE TEMP TABLE fp_antes AS SELECT (SELECT count(*) FROM public.exclusive_listing_links) links,
  (SELECT count(*) FROM public.remax_site_listings) anuncios, (SELECT count(*) FROM public.remax_site_runs) runs;
GRANT SELECT ON fp_antes TO authenticated;

-- 2) Corretor (captador)
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.remax_site_listings') LIKE '42501%', 'usuário segue sem ler a tabela direto (só a função)');
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 2, 'só anúncios de VENDA, ATIVOS e COM coordenada (2 de 5)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mapa_anuncios_site() WHERE code = '630699077-15'), 'locação ativa com coordenada não sai (só venda)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mapa_anuncios_site() WHERE transacao IS DISTINCT FROM 'venda'), 'toda linha devolvida é venda');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mapa_anuncios_site() WHERE code IN ('630699001-13','630699001-14')), 'sem coordenada e inativo ficam fora');
SELECT pg_temp.ok((SELECT corretor FROM public.mapa_anuncios_site() WHERE code = '630699001-11') = (SELECT nome FROM public.profiles WHERE id = pg_temp.id('captador')),
  'corretor com usuário: nome do ADM');
SELECT pg_temp.ok((SELECT corretor FROM public.mapa_anuncios_site() WHERE code = '630699077-12') = 'Corretor Sem Usuário', 'corretor sem usuário: nome do site');
SELECT pg_temp.ok((SELECT url FROM public.mapa_anuncios_site() WHERE code = '630699001-11') LIKE 'https://www.remax.com.br/%', 'link do anúncio no site');
SELECT pg_temp.ok((SELECT rua FROM public.mapa_anuncios_site() WHERE code = '630699001-11') = 'Rua das Acácias Fictícias', 'endereço: só a rua (sem número)');
SELECT pg_temp.ok((SELECT count(*) FROM information_schema.routines rt JOIN information_schema.parameters pa
   ON pa.specific_name = rt.specific_name WHERE rt.routine_name = 'mapa_anuncios_site' AND pa.parameter_mode = 'OUT'
   AND pa.parameter_name ~ '(numero|tel|fone|mail|cep|agent_id|propriet)') = 0, 'nunca sai número, telefone, e-mail, CEP ou ID do corretor');
SELECT pg_temp.ok((SELECT capture_id FROM public.mapa_anuncios_site() WHERE code = '630699001-11') IS NULL, 'sem ligação: anúncio aparece sozinho');
SELECT pg_temp.ok(public.exclusive_listing_link(pg_temp.id('c1'), '630699001-11') = 'ativo', 'liga c1 ao -11 (fluxo do PR #56)');
SELECT pg_temp.ok((SELECT capture_id FROM public.mapa_anuncios_site() WHERE code = '630699001-11') = pg_temp.id('c1'), 'ligação ativa: devolve a captação (um marcador só na tela)');
SELECT pg_temp.ok((SELECT capture_id FROM public.mapa_anuncios_site() WHERE code = '630699077-12') IS NULL, 'anúncio de outro corretor segue solto');
-- Ligação 'aguardando_gestor' (anúncio de outro ID, sinalizado no Feedback) também junta o marcador
INSERT INTO ids SELECT 'c2', public.exclusive_create_unit(pg_temp.id('unit_a'));
RESET ROLE;
INSERT INTO public.exclusive_listing_links (organization_id, capture_id, listing_code, status, outro_id, linked_by)
  VALUES (:'org_a', pg_temp.id('c2'), '630699077-12', 'aguardando_gestor', true, pg_temp.id('captador'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT capture_id FROM public.mapa_anuncios_site() WHERE code = '630699077-12') = pg_temp.id('c2'),
  'ligação aguardando_gestor: devolve a captação (um marcador só)');
RESET ROLE;
UPDATE public.exclusive_listing_links SET status = 'recusado' WHERE capture_id = pg_temp.id('c2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT capture_id FROM public.mapa_anuncios_site() WHERE code = '630699077-12') IS NULL, 'ligação recusada: não junta');
RESET ROLE;
UPDATE public.exclusive_listing_links SET status = 'aguardando_gestor' WHERE capture_id = pg_temp.id('c2');
SET LOCAL ROLE authenticated;

-- 3) Gestor da equipe vê a ligação; corretor de outra equipe vê o anúncio, mas não a captação
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok((SELECT capture_id FROM public.mapa_anuncios_site() WHERE code = '630699001-11') = pg_temp.id('c1'), 'gestor: vê a ligação');
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 2, 'outra equipe: vê os anúncios públicos');
SELECT pg_temp.ok((SELECT capture_id FROM public.mapa_anuncios_site() WHERE code = '630699001-11') IS NULL, 'outra equipe: não recebe o ID da captação que não pode abrir');

-- 4) Imobiliária B não vê nada da A; usuário sem login e inativo barrados
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 0, 'imobiliária B: nenhum anúncio da A');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.mapa_anuncios_site()') LIKE '42501%', 'sem login: barrado');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('admin')::text);  -- trava existente: só admin desativa usuário
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('outra');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.mapa_anuncios_site()') LIKE '42501%', 'usuário inativo: barrado');
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.mapa_anuncios_site()') LIKE '42501%', 'anon: sem permissão de executar');
RESET ROLE;

-- 5) Captação arquivada/descartada desfaz a junção; módulo desligado esconde a camada
UPDATE public.exclusive_captures SET archived_at = now() WHERE id = pg_temp.id('c1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT capture_id FROM public.mapa_anuncios_site() WHERE code = '630699001-11') IS NULL, 'captação arquivada: anúncio volta a aparecer sozinho');
RESET ROLE;
UPDATE public.exclusive_captures SET archived_at = NULL WHERE id = pg_temp.id('c1');

-- 6) Coleta falha/suspeita: o mapa continua com a última coleta boa
SELECT public.remax_site_mark_failed(:'org_a', 'HTTP 500 no site', now());
SELECT public.remax_site_ingest(:'org_a', '[]'::jsonb, '[]'::jsonb, now());
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 2, 'falha/suspeita: camada mantém a última coleta boa');
RESET ROLE;
-- Anúncio que saiu do site some na coleta seguinte
SELECT public.remax_site_ingest(:'org_a', (SELECT jsonb_agg(e) FROM jsonb_array_elements((SELECT l FROM coleta)) e WHERE e->>'code' <> '630699077-12'), '[]'::jsonb, now());
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mapa_anuncios_site() WHERE code = '630699077-12'), 'anúncio que saiu do site some do mapa');
RESET ROLE;

UPDATE public.organization_modules SET enabled = false WHERE module = 'captacao_exclusiva' AND organization_id = :'org_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 0, 'módulo de captação desligado: sem camada');
RESET ROLE;

-- 7) Só leitura: nada gravado pela função
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_listing_links) = (SELECT links FROM fp_antes) + 2, 'ligações: só as 2 criadas pelo teste (função não liga nada)');
SELECT pg_temp.ok((SELECT provolatile FROM pg_proc WHERE proname = 'mapa_anuncios_site') = 's', 'função declarada só-leitura (STABLE)');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
