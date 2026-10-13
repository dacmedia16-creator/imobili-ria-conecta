-- Suíte "mapa só com escritórios da própria imobiliária" (migration 20261013230000, t_d017e87f).
-- Roda DENTRO de transação revertida (run-mapa-site-so-escritorios.sh), depois do cenário
-- mapa_site_so_escritorios_setup.sql e da migration. Homologação: A = Única, B = agencia-b-homolog.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
UPDATE public.organization_modules SET enabled = true
 WHERE module = 'captacao_exclusiva' AND organization_id IN (:'org_a', :'org_b');
UPDATE public.organizations SET mapa_site_enabled = true WHERE id IN (:'org_a', :'org_b');

-- 1) Dados: 63164 (Volute) saiu da Única; I, II e III ficaram
SELECT pg_temp.ok((SELECT array_agg(office_id ORDER BY office_id) FROM public.remax_site_offices WHERE organization_id = :'org_a')
  = ARRAY[63059, 63060, 63183], 'Única fica com 63059, 63060 e 63183');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.remax_site_listings WHERE organization_id = :'org_a' AND office_id = 63164),
  'anúncios do 63164 apagados da Única');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.remax_site_agents WHERE organization_id = :'org_a' AND office_id = 63164),
  'corretores do 63164 apagados da Única (Feedback "Sem corretor" não lista a Volute)');
SELECT pg_temp.ok((SELECT count(*) FROM public.remax_site_listings WHERE organization_id = :'org_a') = 3,
  'anúncios dos escritórios da Única preservados');
SELECT pg_temp.ok((SELECT array_agg(o ORDER BY o) FROM public.remax_site_collect_targets() t, unnest(t.offices) o
  WHERE t.organization_id = :'org_a') = ARRAY[63059, 63060, 63183], 'próxima coleta da Única não busca o 63164');

-- 2) Mapa: só os 3 escritórios da Única
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.mapa_anuncios_site()) = 3, 'mapa da Única: 3 anúncios (I, II e III)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mapa_anuncios_site() WHERE code = '630699004-1'), 'mapa: nenhum anúncio da Volute');
RESET ROLE;

-- 3) Proteção na função: escritório desativado (ou que não é da imobiliária) some do mapa
UPDATE public.remax_site_offices SET ativo = false WHERE organization_id = :'org_a' AND office_id = 63183;
UPDATE public.remax_site_listings SET office_id = 99999 WHERE organization_id = :'org_a' AND code = '630699001-1';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT array_agg(code) FROM public.mapa_anuncios_site()) = ARRAY['630699002-1'],
  'mapa só devolve escritório ATIVO da própria imobiliária');
RESET ROLE;
UPDATE public.remax_site_offices SET ativo = true WHERE organization_id = :'org_a' AND office_id = 63183;

-- 4) Outra imobiliária pode configurar o 63164 (não está mais preso à Única) e A não vê o que é de B
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT public.remax_site_offices_set(ARRAY[63164]);
RESET ROLE;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.remax_site_offices WHERE organization_id = :'org_b' AND office_id = 63164 AND ativo),
  'outra imobiliária consegue configurar o 63164');
SELECT pg_temp.ok((public.remax_site_ingest(:'org_b', jsonb_build_array(jsonb_build_object('code','630699005-1','agent_id','630699005',
  'office_id',63164,'status_uid',160,'transacao','venda','lat',-23.5,'lon',-47.45)), '[]'::jsonb, now())->>'status') = 'ok', 'coleta fictícia na B');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mapa_anuncios_site() WHERE code = '630699005-1'), 'Única não vê anúncio da B');
RESET ROLE;

SELECT pg_temp.ok((SELECT provolatile FROM pg_proc WHERE proname = 'mapa_anuncios_site') = 's', 'mapa_anuncios_site segue só-leitura (STABLE)');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
