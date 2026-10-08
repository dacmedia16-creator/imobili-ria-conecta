-- Suíte da ficha do imóvel (migration 20261008230000). Roda DENTRO de transação revertida
-- (run-ficha-imovel.sh). Homologação: A = Única (00000000-…-0001), B = agencia-b-homolog.
-- Perfis: captador/corretor (UE Corretor), corretor da mesma equipe (QA A Corretor Um, posto na equipe
-- só aqui), gestor da equipe (UE Gestor), admin (QA A Admin) e admin da imobiliária B (papel de
-- REMAX-TESTE). Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE txt(k text PRIMARY KEY, v text);
GRANT ALL ON r, ids, txt TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.enviar(_k text) RETURNS text LANGUAGE sql AS
  $$ SELECT pg_temp.err(format($q$UPDATE public.sales SET status = 'enviada_revisao' WHERE id = %L$q$, pg_temp.id(_k))) $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('mesma', '5745cbff-22b6-4a28-a515-dd6706504b8b'), ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
UPDATE public.organization_modules SET enabled = true WHERE module = 'captacao_exclusiva' AND organization_id IN (:'org_a', :'org_b');
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
DELETE FROM public.team_members WHERE membro_id = pg_temp.id('mesma');
INSERT INTO public.team_members (membro_id, team_id, organization_id, tipo)
  SELECT pg_temp.id('mesma'), team_id, organization_id, tipo FROM public.team_members WHERE membro_id = pg_temp.id('captador');

-- 0) Conversores do banco (mesma regra do front) -------------------------------------------------
SELECT pg_temp.ok(public.ficha_area_do_texto('52,23') = 52.23 AND public.ficha_area_do_texto('250,00 metros quadrados') = 250
  AND public.ficha_area_do_texto('198.78400000 m2') = 198.78 AND public.ficha_area_do_texto('16.312,09') = 16312.09
  AND public.ficha_area_do_texto('1.250') = 1250 AND public.ficha_area_do_texto('') IS NULL
  AND public.ficha_area_do_texto('0') IS NULL AND public.ficha_area_do_texto('abc') IS NULL,
  'banco converte "52,23", "250,00 metros quadrados", "198.78400000 m2", "16.312,09", "1.250"');
SELECT pg_temp.ok(public.ficha_tipo_do_texto('Casa em condomínio') = 'Casa' AND public.ficha_tipo_do_texto('APARTAMENTO') = 'Apartamento'
  AND public.ficha_tipo_do_texto('Sala comercial') = 'Comercial' AND public.ficha_tipo_do_texto('Lote') = 'Terreno'
  AND public.ficha_tipo_do_texto('Cobertura duplex') = 'Cobertura' AND public.ficha_tipo_do_texto('Studio') = 'Studio'
  AND public.ficha_tipo_do_texto('Residencial') IS NULL, 'banco converte o tipo da captação para a lista do Estudo');

-- 1) Captação aprovada COM ficha -> Virou venda leva tudo como sugestão --------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'c', public.exclusive_create_unit(pg_temp.id('unit_a'));
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 20, geo_lat = -23.5, geo_lon = -47.45,
  form_data = form_data || jsonb_build_object(
    'imovel', jsonb_build_object('tipo_imovel', 'Apartamento', 'endereco', 'Rua das Acácias, 412',
      'bairro', 'Jardim Fictício', 'municipio', 'Sorocaba', 'estado', 'SP', 'valor_imovel', 'R$ 550.000,00'),
    'ficha', jsonb_build_object('area_util_m2', '110', 'area_construida_m2', '', 'area_terreno_m2', '480,5',
      'ano_construcao', '2015', 'quartos', '3', 'suites', '1', 'banheiros', '2', 'vagas', '2'),
    'proprietario_1', jsonb_build_object('nome_completo', 'Carlos Exemplo da Silva', 'cpf', '000.111.222-33'))
  WHERE id = pg_temp.id('c');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);
INSERT INTO ids SELECT 'v1', (public.exclusive_virar_venda(pg_temp.id('c'))->'venda'->>'id')::uuid;
RESET ROLE;
SELECT pg_temp.ok((SELECT tipo_imovel = 'Apartamento' AND area_util_m2 = 110 AND area_terreno_m2 IS NULL
  AND area_construida_m2 IS NULL AND ano_construcao = 2015 AND quartos = 3 AND suites = 1 AND banheiros = 2 AND vagas = 2
  AND area_origem = 'captacao' AND area_confirmada_em IS NULL AND area_confirmada_por IS NULL
  FROM public.sales WHERE id = pg_temp.id('v1')),
  'Virou venda: ficha da captação vira sugestão (sem confirmar; "terreno" de apartamento não vai)');

-- 2) Trava: sem confirmar não segue; completa e confirmada segue --------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);
UPDATE public.sales SET imovel_numero = '412', midia = 'Placa', valor_negociado = 500000, data_assinatura = current_date,
  percentual_comissao = 6 WHERE id = pg_temp.id('v1');
INSERT INTO public.sale_payment (sale_id, tipo_pagamento, entrada_valor) VALUES (pg_temp.id('v1'), 'vista', 500000);
UPDATE public.sale_parties SET nome = 'Comprador Fictício', cpf_cnpj = '000.777.888-99'
  WHERE sale_id = pg_temp.id('v1') AND papel = 'comprador_1';
INSERT INTO txt SELECT 'e1', pg_temp.enviar('v1');
SELECT pg_temp.ok((SELECT v FROM txt WHERE k = 'e1') LIKE '23514%Complete a ficha do imóvel (falta: Confirmar a área útil)%',
  'corretor: área não confirmada -> barrada (' || coalesce((SELECT v FROM txt WHERE k = 'e1'), 'passou') || ')');
UPDATE public.sales SET vagas = NULL WHERE id = pg_temp.id('v1');
SELECT pg_temp.ok(pg_temp.enviar('v1') LIKE '%falta: Vagas)%', 'residencial sem vagas -> barrada');
UPDATE public.sales SET vagas = 2, area_confirmada_em = now() - interval '3 days', area_confirmada_por = pg_temp.id('admin')
  WHERE id = pg_temp.id('v1');
SELECT pg_temp.ok((SELECT area_confirmada_por = pg_temp.id('mesma') AND area_confirmada_em >= now() - interval '1 minute'
  FROM public.sales WHERE id = pg_temp.id('v1')), 'confirmação grava QUEM gravou e AGORA (não aceita outro usuário/data)');
UPDATE public.sales SET area_confirmada_por = pg_temp.id('admin') WHERE id = pg_temp.id('v1');
SELECT pg_temp.ok((SELECT area_confirmada_por = pg_temp.id('mesma') FROM public.sales WHERE id = pg_temp.id('v1')),
  '"quem confirmou" não pode ser trocado por fora');
UPDATE public.sales SET area_util_m2 = 111 WHERE id = pg_temp.id('v1');
SELECT pg_temp.ok((SELECT area_confirmada_em IS NULL AND area_confirmada_por IS NULL FROM public.sales WHERE id = pg_temp.id('v1')),
  'mudou a área depois de confirmar -> confirmação desfeita');
UPDATE public.sales SET area_util_m2 = 110, area_origem = 'corretor', area_confirmada_em = now() WHERE id = pg_temp.id('v1');
INSERT INTO txt SELECT 'e2', pg_temp.enviar('v1');
SELECT pg_temp.ok((SELECT v FROM txt WHERE k = 'e2') IS NULL,
  'ficha completa e confirmada -> corretor envia ao gestor ' || coalesce((SELECT v FROM txt WHERE k = 'e2'), ''));
RESET ROLE;  -- já enviada: o corretor não edita mais; a CHECK vale para qualquer gravação
SELECT pg_temp.ok(pg_temp.err(format($q$UPDATE public.sales SET tipo_imovel = 'Mansão' WHERE id = %L$q$, pg_temp.id('v1'))) LIKE '23514%',
  'tipo fora da lista do Estudo é recusado');
SELECT pg_temp.ok(pg_temp.err(format($q$UPDATE public.sales SET area_util_m2 = -5 WHERE id = %L$q$, pg_temp.id('v1'))) LIKE '23514%',
  'área negativa é recusada');

-- 3) Terreno: só área do terreno; Comercial: sem quartos; Lançamento: sem trava ------------------
RESET ROLE;
WITH s AS (
  INSERT INTO public.sales (corretor_id, organization_id, status, modalidade, imovel_logradouro, imovel_numero,
    imovel_bairro, imovel_cidade, imovel_uf, midia, valor_negociado, data_assinatura, percentual_comissao, matricula,
    tipo_imovel, area_util_m2)
  VALUES (pg_temp.id('mesma'), :'org_a', 'rascunho', 'padrao', 'Rua Teste', '1', 'Centro', 'Sorocaba', 'SP', 'Placa',
    300000, current_date, 6, '1.234', 'Terreno', NULL) RETURNING id)
INSERT INTO ids SELECT 'v2', s.id FROM s;
INSERT INTO public.sale_payment (sale_id, tipo_pagamento, entrada_valor) VALUES (pg_temp.id('v2'), 'vista', 300000);
INSERT INTO public.sale_parties (sale_id, papel, tipo_pessoa, nome, cpf_cnpj) VALUES
  (pg_temp.id('v2'), 'vendedor_1', 'fisica', 'Vendedor Fictício', '000.111.111-11'),
  (pg_temp.id('v2'), 'comprador_1', 'fisica', 'Comprador Fictício', '000.222.222-22');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);
SELECT pg_temp.ok(pg_temp.enviar('v2') LIKE '%falta: Área do terreno)%', 'Terreno sem área do terreno -> barrada (não pede quartos)');
UPDATE public.sales SET area_terreno_m2 = 300, area_confirmada_em = now() WHERE id = pg_temp.id('v2');
INSERT INTO txt SELECT 'e3', pg_temp.enviar('v2');
SELECT pg_temp.ok((SELECT v FROM txt WHERE k = 'e3') IS NULL, 'Terreno só com área do terreno confirmada segue ' || coalesce((SELECT v FROM txt WHERE k = 'e3'), ''));
SELECT pg_temp.ok((SELECT public.ficha_imovel_faltando(s) FROM public.sales s WHERE s.id = pg_temp.id('v1')) = ARRAY[]::text[],
  'corretor calcula a pendência da ficha: venda 1 completa');
RESET ROLE;
-- Comercial: só tipo + área útil confirmada
UPDATE public.sales SET tipo_imovel = 'Comercial', quartos = NULL, banheiros = NULL, vagas = NULL WHERE id = pg_temp.id('v1');
SELECT pg_temp.ok((SELECT public.ficha_imovel_faltando(s) FROM public.sales s WHERE s.id = pg_temp.id('v1'))
  = ARRAY['Confirmar a área útil'], 'Comercial não pede quartos/banheiros/vagas; troca de tipo desfaz a confirmação');
-- Lançamento: trava não se aplica
WITH s AS (
  INSERT INTO public.sales (corretor_id, organization_id, status, modalidade)
  VALUES (pg_temp.id('mesma'), :'org_a', 'rascunho', 'lancamento') RETURNING id)
INSERT INTO ids SELECT 'v3', s.id FROM s;
INSERT INTO txt SELECT 'e4', pg_temp.err(format($q$UPDATE public.sales SET status = 'enviada_revisao' WHERE id = %L$q$, pg_temp.id('v3')));
SELECT pg_temp.ok(coalesce((SELECT v FROM txt WHERE k = 'e4'), '') NOT LIKE '%ficha do imóvel%',
  'Lançamento não é barrado pela ficha');

-- 4) Vendas por região: tipo e área na venda e no pino; pino continua anônimo --------------------
RESET ROLE;
ALTER TABLE public.sales DISABLE TRIGGER USER;
UPDATE public.sales SET status = 'contrato_assinado', tipo_imovel = 'Apartamento', area_util_m2 = 110, valor_negociado = 500000
  WHERE id = pg_temp.id('v1');
UPDATE public.sales SET status = 'contrato_assinado' WHERE id = pg_temp.id('v2');
UPDATE public.sales SET valor_total_comissao = valor_negociado * 0.06 WHERE id IN (pg_temp.id('v1'), pg_temp.id('v2'));
ALTER TABLE public.sales ENABLE TRIGGER USER;
INSERT INTO public.sale_status_history (sale_id, para, created_at)
  SELECT id, 'contrato_assinado', now() FROM public.sales WHERE id IN (pg_temp.id('v1'), pg_temp.id('v2'));
INSERT INTO public.sale_geo (sale_id, organization_id, geo_key, geo_lat, geo_lon)
  SELECT id, organization_id, 'qa-ficha|' || id, -23.512345, -47.465432 FROM public.sales WHERE id IN (pg_temp.id('v1'), pg_temp.id('v2'))
  ON CONFLICT (sale_id) DO UPDATE SET geo_lat = excluded.geo_lat, geo_lon = excluded.geo_lon;
CREATE FUNCTION pg_temp.linhas(_k text) RETURNS TABLE(tipo text, codigo text, endereco text, data date, geo_key text,
  lat double precision, tipo_imovel text, area numeric, valor numeric) LANGUAGE sql AS $$
  SELECT t.tipo, t.codigo, t.imovel_endereco, t.data_fechamento, t.geo_key, t.geo_lat, t.tipo_imovel, t.area_util_m2, t.valor
  FROM public.vendas_por_regiao_todos() t
  WHERE (t.sale_id = pg_temp.id(_k)) OR (t.tipo = 'pino' AND t.geo_lat = -23.512 AND t.geo_lon = -47.465) $$;
GRANT EXECUTE ON FUNCTION pg_temp.linhas(text) TO authenticated;
SELECT pg_temp.ok((SELECT count(*) = 2 FROM public.vendas_comerciais_canonicas() c WHERE c.sale_id IN (pg_temp.id('v1'), pg_temp.id('v2'))),
  'as duas vendas fictícias entram no VGV canônico');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);
SELECT pg_temp.ok((SELECT count(*) = 1 FROM pg_temp.linhas('v1') WHERE tipo = 'venda' AND tipo_imovel = 'Apartamento' AND area = 110),
  'corretor dono: linha "venda" com tipo e área útil');
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok((SELECT count(*) >= 1 FROM pg_temp.linhas('v1') WHERE tipo_imovel = 'Apartamento' AND area = 110), 'gestor vê tipo e área');
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok((SELECT count(*) >= 1 FROM pg_temp.linhas('v1') WHERE tipo_imovel = 'Apartamento' AND area = 110), 'admin vê tipo e área');
-- Corretor de fora (não abre a venda): pino com tipo, área e valor; sem código/endereço/data/geo_key
SELECT 'ebffaded-075c-493f-89e2-1d3d62901dc4' AS fora \gset
SELECT pg_temp.as_user(:'fora');
SELECT pg_temp.ok((SELECT count(*) >= 1 FROM pg_temp.linhas('v1') WHERE tipo = 'pino' AND tipo_imovel = 'Apartamento' AND area = 110
  AND valor = 500000 AND codigo IS NULL AND endereco IS NULL AND data IS NULL AND geo_key IS NULL AND lat = -23.512),
  'quem não abre: pino com tipo, área útil e valor, sem código/endereço/data; coordenada arredondada');
SELECT pg_temp.ok((SELECT count(*) >= 1 FROM pg_temp.linhas('v2') WHERE tipo_imovel = 'Terreno' AND area = 300),
  'Terreno: área do pino é a do terreno');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.vendas_por_regiao_todos() t WHERE t.tipo_imovel IS NOT NULL
  AND t.geo_lat = -23.512 AND t.geo_lon = -47.465), 'imobiliária B (REMAX-TESTE) não vê nada da A');
SELECT pg_temp.ok(pg_temp.err(format($q$UPDATE public.sales SET area_util_m2 = 1 WHERE id = %L$q$, pg_temp.id('v1'))) IS NULL
  AND (SELECT count(*) = 0 FROM public.sales WHERE id = pg_temp.id('v1')), 'imobiliária B não lê nem altera a venda da A');
RESET ROLE;
SELECT pg_temp.ok((SELECT area_util_m2 = 110 FROM public.sales WHERE id = pg_temp.id('v1')), 'área da A intacta');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) || ' de ' || count(*) FROM r;
