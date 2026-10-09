-- Suíte da sugestão do anúncio do site RE/MAX (migration 20261009040000). Roda DENTRO de transação revertida
-- (run-remax-site-sugestao.sh). Homologação: A = Única (00000000-…-0001), B = agencia-b-homolog.
-- Perfis: captador (UE Corretor), gestor da equipe (UE Gestor), corretor de outra equipe (QA A Corretor Dois),
-- admin (QA A Admin) e admin da imobiliária B. Dados fictícios (IDs 630699xxx, endereços inventados).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.sug(_cap text) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT public.exclusive_site_suggestions(pg_temp.id(_cap)) $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('dono2', '5745cbff-22b6-4a28-a515-dd6706504b8b'), ('outra', 'ebffaded-075c-493f-89e2-1d3d62901dc4'),
  ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
UPDATE public.organization_modules SET enabled = true
 WHERE module IN ('captacao_exclusiva', 'feedback_proprietario') AND organization_id IN (:'org_a', :'org_b');
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
UPDATE public.profiles SET remax_id = '630699001' WHERE id = pg_temp.id('captador');
UPDATE public.profiles SET remax_id = '630699002' WHERE id = pg_temp.id('dono2');

-- 0) Funções puras
SELECT pg_temp.ok(public.remax_norm_rua('R. Dr. João de Barros') = public.remax_norm_rua('RUA JOAO BARROS'), 'rua: sem tipo, título, acento e preposição');
SELECT pg_temp.ok(public.remax_endereco_numero('Rua Fictícia, 0581 - apto 12') = '581', 'número: primeiro número depois da vírgula');
SELECT pg_temp.ok(public.remax_endereco_rua('Rua Fictícia, 581 - apto 12') = 'Rua Fictícia', 'rua: tira o número');
SELECT pg_temp.ok(public.remax_valor('R$ 480.000,00') = 480000 AND public.remax_valor('480.000') = 480000 AND public.remax_valor('') IS NULL, 'valor em reais');
SELECT pg_temp.ok(public.remax_tipo_grupo('casa-de-condominio') = 'casa' AND public.remax_tipo_grupo('APARTAMENTO') = 'apartamento', 'tipo: site x captação');
SELECT pg_temp.ok(round(public.remax_dist_m(-23.5, -47.45, -23.5009, -47.45)) BETWEEN 95 AND 105, 'distância em metros');

-- 1) Configuração por imobiliária: a Única já vem configurada; B não
SELECT pg_temp.ok((SELECT count(*) FROM public.remax_site_offices WHERE organization_id = :'org_a') = 4
  AND (SELECT count(*) FROM public.remax_site_offices WHERE organization_id = :'org_b') = 0, 'escritórios: 4 na Única, nenhum na B');

-- 2) Coleta fictícia (como o servidor faz; só service_role pode chamar)
CREATE TEMP TABLE coleta AS SELECT jsonb_build_array(
  jsonb_build_object('code','630699001-11','agent_id','630699001','office_id',63059,'status_uid',160,'exclusivo',true,'transacao','venda',
    'tipo','casa','rua','Rua das Acácias Fictícias','numero','120','bairro','Jardim Teste','cidade','Sorocaba','lat',-23.50000,'lon',-47.45000,
    'area',150,'quartos',3,'preco',650000,'url','https://www.remax.com.br/pt-br/imoveis/casa/venda/sorocaba/120-rua/630699001-11'),
  jsonb_build_object('code','630699001-12','agent_id','630699001','office_id',63059,'status_uid',160,'transacao','venda',
    'tipo','casa','rua','Rua das Acácias Fictícias','numero','300','bairro','Jardim Teste','cidade','Sorocaba','lat',-23.50150,'lon',-47.45000,
    'area',90,'quartos',2,'preco',380000),
  jsonb_build_object('code','630699001-13','agent_id','630699001','office_id',63059,'status_uid',160,'transacao','locacao',
    'tipo','apartamento','rua','Avenida Longe Daqui','numero','9','bairro','Centro Fictício','cidade','Sorocaba','lat',-23.60,'lon',-47.55,
    'area',60,'quartos',1,'preco',2500),
  jsonb_build_object('code','630699001-14','agent_id','630699001','office_id',63059,'status_uid',168,'transacao','venda',
    'tipo','casa','rua','Rua das Acácias Fictícias','numero','120','bairro','Jardim Teste','lat',-23.50000,'lon',-47.45000),
  jsonb_build_object('code','630699002-21','agent_id','630699002','office_id',63059,'status_uid',160,'transacao','venda',
    'tipo','casa','rua','Rua das Acácias Fictícias','numero','120','bairro','Jardim Teste','lat',-23.50000,'lon',-47.45000),
  jsonb_build_object('code','630699009-31','agent_id','630699009','office_id',99999,'status_uid',160,'rua','Rua Fora')
) AS l, jsonb_build_array(
  jsonb_build_object('agent_id','630699001','nome','Nome Site Captador','office_id',63059),
  jsonb_build_object('agent_id','630699077','nome','Corretor Sem Usuário','office_id',63059,'telefone','15999999999','email','x@y.z')
) AS a;
GRANT SELECT ON coleta TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.remax_site_ingest(%L, %L, %L, now())', :'org_a', (SELECT l FROM coleta), (SELECT a FROM coleta))) LIKE '42501%', 'usuário não chama a coleta (só o servidor)');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.remax_site_listings') LIKE '42501%', 'usuário não lê a tabela direto (só RPC)');
RESET ROLE;
SELECT pg_temp.ok((public.remax_site_ingest(:'org_a', (SELECT l FROM coleta), (SELECT a FROM coleta), now())->>'ativos')::int = 4, 'coleta: 4 ativos (escritório fora da configuração é ignorado)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.remax_site_listings WHERE code = '630699009-31'), 'coleta: escritório não configurado não entra');
SELECT pg_temp.ok((SELECT count(*) FROM information_schema.columns WHERE table_name = 'remax_site_agents' AND column_name ~ '(tel|fone|mail)') = 0
  AND (SELECT count(*) FROM public.remax_site_agents WHERE organization_id = :'org_a' AND agent_id IN ('630699001','630699077')) = 2, 'corretores: só ID, nome e escritório (sem telefone/e-mail)');

-- Captações do captador (aprovadas): c1 = mesmo imóvel do -11; c2 = sem geolocalização; c3 = rascunho
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'c' || g, public.exclusive_create_unit(pg_temp.id('unit_a')) FROM generate_series(1, 3) g;
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 20, geo_lat = -23.50010, geo_lon = -47.45005,
  form_data = form_data || jsonb_build_object('imovel', jsonb_build_object('tipo_imovel', 'Casa', 'bairro', 'Jardim Teste',
    'endereco', 'RUA DAS ACACIAS FICTICIAS, 120', 'valor_imovel', 'R$ 640.000,00'),
    'ficha', jsonb_build_object('tipo', 'Casa', 'area_util_m2', 148, 'quartos', 3))
 WHERE id = pg_temp.id('c1');
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 20,
  form_data = form_data || jsonb_build_object('imovel', jsonb_build_object('tipo_imovel', 'Casa', 'bairro', 'Outro Bairro',
    'endereco', 'Rua Inexistente, 5'))
 WHERE id = pg_temp.id('c2');
INSERT INTO public.exclusive_history (capture_id, actor_id, action, created_at)
  SELECT v, pg_temp.id('gestor'), 'aprovar', now() - interval '20 days' FROM ids WHERE k IN ('c1','c2');
CREATE TEMP TABLE fp_antes AS SELECT (SELECT count(*) FROM public.exclusive_listing_links) links,
  (SELECT count(*) FROM public.exclusive_history) hist, (SELECT count(*) FROM public.portal_listing_snapshots) snaps;
GRANT SELECT ON fp_antes TO authenticated;

-- 3) Corretor (captador)
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.sug('c1')->'items'->0->>'code' = '630699001-11', 'sugestão nº 1 = anúncio do mesmo endereço');
SELECT pg_temp.ok(pg_temp.sug('c1')->'items'->0->>'confianca' = 'alta', 'confiança alta (endereço, número, área, quartos e preço batem)');
SELECT pg_temp.ok((pg_temp.sug('c1')->'items'->0->'motivos') ? 'mesmo número', 'motivos mostrados ao corretor');
SELECT pg_temp.ok(jsonb_array_length(pg_temp.sug('c1')->'items') BETWEEN 1 AND 3, 'no máximo 3 sugestões');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.sug('c1')->'items') i WHERE i->>'code' IN ('630699002-21','630699001-14','630699001-13')),
  'só anúncio ATIVO do MESMO ID (nem outro ID, nem inativo, nem longe)');
SELECT pg_temp.ok(jsonb_array_length(pg_temp.sug('c2')->'items') = 0, 'captação sem endereço parecido: nenhuma sugestão');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_listing_links) = (SELECT links FROM fp_antes)
  AND (SELECT count(*) FROM public.exclusive_history) = (SELECT hist FROM fp_antes), 'sugerir NÃO liga nada sozinho (sem gravar)');
-- O clique usa a RPC do PR #56: liga e a sugestão some das outras captações
SELECT pg_temp.ok(public.exclusive_listing_link(pg_temp.id('c1'), pg_temp.sug('c1')->'items'->0->>'code') = 'ativo', 'confirmar a sugestão liga pelo fluxo do PR #56');
SELECT pg_temp.ok(jsonb_array_length(pg_temp.sug('c1')->'items') >= 1, 'captação já ligada ainda mostra sua sugestão (não some a dela)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.sug('c2')->'items') i WHERE i->>'code' = '630699001-11'), 'anúncio ligado não é sugerido para outra captação');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_listing_link(%L, %L)', pg_temp.id('c2'), '630699001-11')) LIKE '%outra captação%', 'regra do #56 mantida: código único por captação');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.exclusive_site_provaveis()') LIKE '42501%', 'corretor não abre o painel do gestor');
SELECT pg_temp.ok((SELECT count(*) FROM public.remax_site_agent_names()) = 0, 'corretor não vê nomes do site');
SELECT pg_temp.ok(pg_temp.err('SELECT public.remax_site_offices_get()') LIKE '42501%', 'corretor não vê a configuração');

-- 4) Corretor de outra equipe e imobiliária B
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_site_suggestions(%L)', pg_temp.id('c1'))) LIKE '42501%', 'outra equipe: não vê sugestões da captação');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_site_suggestions(%L)', pg_temp.id('c1'))) LIKE '42501%', 'imobiliária B: não vê sugestões da A');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_site_provaveis()) = 0, 'imobiliária B: painel sem dados da A');
SELECT pg_temp.ok((SELECT count(*) FROM public.remax_site_agent_names()) = 0, 'imobiliária B: nenhum nome da A');
SELECT pg_temp.ok((public.remax_site_offices_get()->'offices') = '[]'::jsonb, 'imobiliária B: não vê os escritórios da A');
SELECT pg_temp.ok(pg_temp.err('SELECT public.remax_site_offices_set(ARRAY[63059])') LIKE '%outra imobiliária%', 'imobiliária B: não toma escritório da A');

-- 5) Gestor: provável anúncio no painel (c2 sem; c1 já ligada não aparece)
RESET ROLE;
-- nova captação do captador no mesmo endereço do -12, aprovada e sem anúncio
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'c4', public.exclusive_create_unit(pg_temp.id('unit_a'));
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 20, geo_lat = -23.50150, geo_lon = -47.45001,
  form_data = form_data || jsonb_build_object('imovel', jsonb_build_object('tipo_imovel', 'Casa', 'bairro', 'Jardim Teste',
    'endereco', 'Rua das Acacias Ficticias, 300'))
 WHERE id = pg_temp.id('c4');
INSERT INTO public.exclusive_history (capture_id, actor_id, action, created_at) VALUES (pg_temp.id('c4'), pg_temp.id('gestor'), 'aprovar', now() - interval '20 days');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok((SELECT code FROM public.exclusive_site_provaveis() WHERE capture_id = pg_temp.id('c4')) = '630699001-12', 'painel: "provável anúncio encontrado" na aprovada sem anúncio');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_site_provaveis() WHERE capture_id IN (pg_temp.id('c1'), pg_temp.id('c2'))), 'painel: ligada ou sem candidato não aparece');
SELECT pg_temp.ok((SELECT count(*) FROM public.remax_site_agent_names()) = 0, 'gestor: nomes do site só para admin (quem vê "Sem corretor" hoje)');

-- 6) Admin: nomes do "Sem corretor" e configuração
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok((SELECT nome FROM public.remax_site_agent_names() WHERE agent_id = '630699077') = 'Corretor Sem Usuário', 'admin: nome do site para ID sem usuário');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.remax_site_agent_names() WHERE agent_id = '630699001'), 'admin: ID que já tem usuário não é renomeado');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_site_provaveis() WHERE capture_id = pg_temp.id('c4')) = 1, 'admin vê o painel da imobiliária');
SELECT pg_temp.ok(jsonb_array_length(public.remax_site_offices_get()->'offices') = 4 AND public.remax_site_offices_get()->'ultima'->>'status' = 'ok', 'admin vê escritórios e a última coleta');
SELECT pg_temp.ok(pg_temp.err('SELECT public.remax_site_offices_set(ARRAY[63059, 63060, 63183, 63164])') IS NULL, 'admin ajusta os escritórios da própria imobiliária');

-- 7) Site mudou / falhou: nada é apagado
RESET ROLE;
SELECT public.remax_site_mark_failed(:'org_a', 'HTTP 500 no site', now());
SELECT pg_temp.ok((SELECT count(*) FROM public.remax_site_listings WHERE organization_id = :'org_a' AND last_run = (public.remax_site_last_ok(:'org_a')).id) = 4, 'falha: dados da coleta anterior continuam valendo');
SELECT pg_temp.ok(public.remax_site_ingest(:'org_a', '[]'::jsonb, '[]'::jsonb, now())->>'status' = 'suspeito', 'coleta vazia (site mudou): marcada suspeita');
SELECT pg_temp.ok((SELECT count(*) FROM public.remax_site_listings WHERE organization_id = :'org_a' AND last_run = (public.remax_site_last_ok(:'org_a')).id) = 4, 'coleta suspeita não apaga nem substitui');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT code FROM public.exclusive_site_provaveis() LIMIT 0) IS NULL AND jsonb_array_length(pg_temp.sug('c4')->'items') >= 1, 'depois da falha a sugestão continua com a coleta boa');
RESET ROLE;
-- Anúncio que saiu do site deixa de ser sugerido na coleta seguinte
SELECT public.remax_site_ingest(:'org_a', (SELECT jsonb_agg(e) FROM jsonb_array_elements((SELECT l FROM coleta)) e WHERE e->>'code' <> '630699001-12'), '[]'::jsonb, now());
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.sug('c4')->'items') i WHERE i->>'code' = '630699001-12'), 'anúncio que saiu do site não é mais sugerido');
RESET ROLE;

-- 8) Nada muda em Feedback/portais/vendas
SELECT pg_temp.ok((SELECT count(*) FROM public.portal_listing_snapshots) = (SELECT snaps FROM fp_antes), 'Feedback/portais: contagem de anúncios inalterada');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
