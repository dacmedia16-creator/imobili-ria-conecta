-- Suíte da migration 20261008150000 (Vendas por região para todos + mapa de captações).
-- Roda DENTRO de transação revertida (ver run-vendas-regiao-todos.sh). Homologação: imobiliárias
-- A = Única (00000000-…-0001) e B = agencia-b-homolog (2a000000-…-00b0), fixture QA-MAPA.
-- Saída: linhas "ok …" / "FALHA …" e "TOTAL=<falhas>".
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE res(papel text, qtd bigint, valor numeric, regioes text, vendas_det int,
  vazou bool, cap_total int, cap_det int, cap_vazou bool, cap_b int, cap_ids text, cap_exato bool);
GRANT ALL ON r, res TO authenticated;

-- Atores (A): um usuário por papel. Os papéis que a homologação não tem são dados a corretores
-- só dentro da transação.
SELECT '10000000-0000-4000-8000-000000000003' AS a_corretor, 'cab7391a-463f-4d97-b99b-ced6e4696796' AS a_gestor,
       'b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed' AS a_fin, '7dd997f7-2021-43ea-af9c-e758b826fcfd' AS a_admin,
       '0a321807-c739-4b26-89e7-6e6fdef00297' AS a_super, 'a742cfda-4731-4fa8-989a-374d2fdf0820' AS a_tl,
       'b316b223-da46-4c2c-9952-25096d5ae5ff' AS a_jur, 'ebffaded-075c-493f-89e2-1d3d62901dc4' AS a_lanc,
       '5745cbff-22b6-4a28-a515-dd6706504b8b' AS a_staff, 'b3144521-7e3b-4f48-a1e0-29d90fd3f536' AS b_admin \gset
DELETE FROM public.user_roles WHERE user_id IN (:'a_tl', :'a_jur', :'a_lanc', :'a_staff');
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'a_tl', 'team_leader', '00000000-0000-4000-8000-000000000001'),
  (:'a_jur', 'juridico', '00000000-0000-4000-8000-000000000001'),
  (:'a_lanc', 'lancamento', '00000000-0000-4000-8000-000000000001'),
  (:'a_staff', 'staff', '00000000-0000-4000-8000-000000000001');

-- Módulo de captação ligado nas duas imobiliárias e captações fictícias com dado de proprietário
-- que NUNCA pode aparecer (nome/telefone/e-mail/CPF "SEGREDO").
UPDATE public.organization_modules SET enabled = true WHERE module = 'captacao_exclusiva'
  AND organization_id IN ('00000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-0000000000b0');
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, status, form_data, broker_name,
  organization_id, geo_lat, geo_lon, geo_key, signed_on) VALUES
 ('c0000000-0000-4000-8000-0000000000a1', :'a_corretor', :'a_corretor', 'campolim', 'aprovada',
  '{"proprietario_1":{"nome":"SEGREDO NOME","telefone_1":"SEGREDO 15999","email":"segredo@x.com","cpf":"SEGREDO-CPF"},
    "imovel":{"tipo_imovel":"Casa","endereco":"Rua Exata QA, 123","bairro":"Campolim","municipio":"Sorocaba","estado":"SP","valor_imovel":"SEGREDO-VALOR"},
    "condicoes":{"prazo_dias_numero":"180","comissao_percentual_numero":"SEGREDO-COMISSAO"}}',
  'Corretor QA A', '00000000-0000-4000-8000-000000000001', -23.512345, -47.465432, 'rua exata qa, 123|campolim|sorocaba|sp', '2026-09-01'),
 ('c0000000-0000-4000-8000-0000000000a2', :'a_admin', :'a_admin', 'campolim', 'rascunho',
  '{"proprietario_1":{"nome":"SEGREDO NOME 2"},"imovel":{"tipo_imovel":"Apartamento","endereco":"Av Exata QA, 9","bairro":"Centro","municipio":"Sorocaba"}}',
  'Admin QA A', '00000000-0000-4000-8000-000000000001', -23.498765, -47.451234, 'x', NULL),
 ('c0000000-0000-4000-8000-0000000000a3', :'a_admin', :'a_admin', 'campolim', 'rascunho',
  '{"imovel":{"tipo_imovel":"Terreno","bairro":"Descartada"}}', 'Admin QA A',
  '00000000-0000-4000-8000-000000000001', -23.4, -47.4, 'y', NULL),
 -- assinada do admin (entra no mapa) e uma em assinatura (fica fora: contrato ainda não assinado)
 ('c0000000-0000-4000-8000-0000000000a4', :'a_admin', :'a_admin', 'campolim', 'aprovada',
  '{"proprietario_1":{"nome":"SEGREDO NOME 4"},"imovel":{"tipo_imovel":"Apartamento","endereco":"Rua Assinada QA, 44","bairro":"Centro","municipio":"Sorocaba","valor_imovel":"SEGREDO-VALOR"}}',
  'Admin QA A', '00000000-0000-4000-8000-000000000001', -23.501234, -47.458765, 'w', '2026-09-15'),
 ('c0000000-0000-4000-8000-0000000000a5', :'a_admin', :'a_admin', 'campolim', 'em_assinatura',
  '{"imovel":{"tipo_imovel":"Casa","endereco":"Rua Pendente QA","bairro":"Centro","municipio":"Sorocaba"}}',
  'Admin QA A', '00000000-0000-4000-8000-000000000001', -23.45, -47.45, 'v', NULL),
 ('c0000000-0000-4000-8000-0000000000b1', :'b_admin', :'b_admin', 'campolim', 'aprovada',
  '{"imovel":{"tipo_imovel":"Casa","endereco":"Rua B QA","bairro":"Cambuí","municipio":"Campinas"}}',
  'Admin QA B', '2a000000-0000-4000-8000-0000000000b0', -22.9, -47.06, 'z', NULL);
UPDATE public.exclusive_captures SET discarded_at = now() WHERE id = 'c0000000-0000-4000-8000-0000000000a3';

-- Referência (dono, sem RLS): vendas efetivadas da A pela base canônica.
SELECT count(*) AS ref_qtd, coalesce(sum(c.valor_negociado), 0) AS ref_valor
  FROM public.vendas_comerciais_canonicas() c JOIN public.sales s ON s.id = c.sale_id
 WHERE s.organization_id = '00000000-0000-4000-8000-000000000001' \gset
SELECT count(*) AS ref_b FROM public.vendas_comerciais_canonicas() c JOIN public.sales s ON s.id = c.sale_id
 WHERE s.organization_id = '2a000000-0000-4000-8000-0000000000b0' \gset
SELECT md5(string_agg(to_jsonb(s)::text, '' ORDER BY s.id)) AS sales_md5 FROM public.sales s \gset
INSERT INTO r VALUES (:ref_qtd > 0 AND :ref_b > 0, 'fixture: A tem ' || :ref_qtd || ' vendas efetivadas, B tem ' || :ref_b);

-- Estrutura e permissões
INSERT INTO r VALUES
 (NOT has_function_privilege('anon', 'public.vendas_por_regiao_todos(date,date)', 'EXECUTE'), 'anon não executa vendas_por_regiao_todos'),
 (NOT has_function_privilege('anon', 'public.mapa_captacoes()', 'EXECUTE'), 'anon não executa mapa_captacoes'),
 (NOT has_function_privilege('anon', 'public.relatorio_regiao_permitido()', 'EXECUTE'), 'anon não executa relatorio_regiao_permitido'),
 ((SELECT bool_and(proowner::regrole::text = 'mt_1b_definer' AND prosecdef) FROM pg_proc
    WHERE proname IN ('vendas_por_regiao_todos', 'mapa_captacoes', 'relatorio_regiao_permitido')
      AND pronamespace = 'public'::regnamespace), 'funções definer com dono mt_1b_definer');

-- Coleta por papel: totais, regiões e o que vazou.
CREATE FUNCTION pg_temp.coleta(_papel text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _v jsonb; _c jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') INTO _v FROM public.vendas_por_regiao_todos() t;
  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') INTO _c FROM public.mapa_captacoes() t;
  INSERT INTO res SELECT _papel,
    (SELECT coalesce(sum((e->>'qtd')::int), 0) FROM jsonb_array_elements(_v) e WHERE e->>'tipo' IN ('venda', 'grupo')),
    (SELECT coalesce(sum((e->>'valor')::numeric), 0) FROM jsonb_array_elements(_v) e WHERE e->>'tipo' IN ('venda', 'grupo')),
    (SELECT md5(coalesce(string_agg(k || '=' || q || '/' || v, ',' ORDER BY k), '')) FROM (
       SELECT lower(coalesce(e->>'imovel_cidade', '') || '|' || coalesce(e->>'imovel_bairro', '')) k,
              sum((e->>'qtd')::int) q, sum((e->>'valor')::numeric) v
         FROM jsonb_array_elements(_v) e WHERE e->>'tipo' IN ('venda', 'grupo') GROUP BY 1) z),
    (SELECT count(*) FROM jsonb_array_elements(_v) e WHERE e->>'tipo' = 'venda'),
    -- vazamento: linha de venda que a pessoa não abre, ou agregado/pino com identificação/valor/data
    EXISTS (SELECT 1 FROM jsonb_array_elements(_v) e WHERE
       (e->>'tipo' = 'venda' AND NOT public.can_view_sale(auth.uid(), (e->>'sale_id')::uuid))
       OR (e->>'tipo' <> 'venda' AND (e->>'sale_id' IS NOT NULL OR e->>'codigo' IS NOT NULL
           OR e->>'imovel_endereco' IS NOT NULL OR e->>'data_fechamento' IS NOT NULL OR e->>'geo_key' IS NOT NULL))
       OR (e->>'tipo' = 'pino' AND ((e->>'valor' IS NOT NULL) <> coalesce(current_setting('t.pino_valor', true), 'off')::boolean
           OR (e->>'geo_lat')::numeric <> round((e->>'geo_lat')::numeric, 3)))),
    jsonb_array_length(_c),
    (SELECT count(*) FROM jsonb_array_elements(_c) e WHERE (e->>'detalhe')::boolean),
    _c::text ~* 'segredo'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(_c) e WHERE NOT (e->>'detalhe')::boolean AND (
           e->>'endereco' IS NOT NULL OR e->>'status' IS NOT NULL OR e->>'signed_on' IS NOT NULL
           OR (e->>'pode_abrir')::boolean)),
    (SELECT count(*) FROM jsonb_array_elements(_c) e WHERE e->>'id' LIKE 'c0000000-0000-4000-8000-0000000000b%'),
    (SELECT string_agg(right(e->>'id', 2), ',' ORDER BY e->>'id') FROM jsonb_array_elements(_c) e
      WHERE e->>'id' LIKE 'c0000000-0000-4000-8000-0000000000%'),
    -- ponto exato do imóvel (sem arredondar) para todos os perfis
    EXISTS (SELECT 1 FROM jsonb_array_elements(_c) e WHERE right(e->>'id', 2) = 'a1'
      AND (e->>'geo_lat')::numeric = -23.512345 AND (e->>'geo_lon')::numeric = -47.465432);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.coleta(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_corretor', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_corretor', true);
SELECT pg_temp.coleta('corretor');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_tl', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_tl', true);
SELECT pg_temp.coleta('team_leader');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_gestor', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_gestor', true);
SELECT pg_temp.coleta('gestor');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_fin', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_fin', true);
SELECT pg_temp.coleta('financeiro');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_jur', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_jur', true);
SELECT pg_temp.coleta('juridico');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_lanc', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_lanc', true);
SELECT pg_temp.coleta('lancamento');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_staff', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_staff', true);
SELECT pg_temp.coleta('staff');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_admin', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_admin', true);
SELECT pg_temp.coleta('admin');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_super', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_super', true);
SELECT pg_temp.coleta('super_admin');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'b_admin', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'b_admin', true);
SELECT pg_temp.coleta('B_admin');
-- Captações da A vistas pelo admin da B (isolamento)
INSERT INTO r SELECT count(*) = 0, 'B não vê nenhuma captação da A'
  FROM public.mapa_captacoes() m WHERE m.id::text LIKE 'c0000000-0000-4000-8000-0000000000a%';

-- Sem login: barrado
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true), set_config('request.jwt.claim.sub', '', true);
DO $$ BEGIN
  PERFORM public.vendas_por_regiao_todos();
  INSERT INTO r VALUES (false, 'sem login executou vendas_por_regiao_todos');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES (true, 'sem login: vendas_por_regiao_todos negado (42501)');
END $$;
DO $$ BEGIN
  PERFORM public.mapa_captacoes();
  INSERT INTO r VALUES (false, 'sem login executou mapa_captacoes');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES (true, 'sem login: mapa_captacoes negado (42501)');
END $$;

-- Período vai para o banco: setembro da A
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_corretor', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_corretor', true);
CREATE TEMP TABLE set_corretor AS SELECT coalesce(sum(qtd) FILTER (WHERE tipo <> 'pino'), 0) q
  FROM public.vendas_por_regiao_todos('2026-09-01', '2026-09-30');
RESET ROLE;
SELECT count(*) AS ref_set FROM public.vendas_comerciais_canonicas() c JOIN public.sales s ON s.id = c.sale_id
 WHERE s.organization_id = '00000000-0000-4000-8000-000000000001' AND c.data_fechamento BETWEEN '2026-09-01' AND '2026-09-30' \gset
INSERT INTO r SELECT q = :ref_set, 'filtro de período (set/2026) no banco: corretor ' || q || ' = referência ' || :ref_set FROM set_corretor;

-- Conferência dos papéis da A
INSERT INTO r SELECT qtd = :ref_qtd AND valor = :ref_valor,
  papel || ': ' || qtd || ' vendas / ' || valor || ' = referência ' || :ref_qtd || ' / ' || :ref_valor
  FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT count(DISTINCT regioes) = 1, 'todos os 9 papéis veem os mesmos números por cidade/bairro'
  FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT NOT vazou, papel || ': nenhuma venda de outra pessoa com código/endereço/data/valor/coordenada exata'
  FROM res;
INSERT INTO r SELECT NOT cap_vazou, papel || ': captações sem dado do proprietário, valor, comissão; sem detalhe para quem não pode'
  FROM res;
INSERT INTO r SELECT cap_total = 2 AND cap_b = 0 AND cap_ids = 'a1,a4',
  papel || ': vê só as 2 captações assinadas da A (' || coalesce(cap_ids, '-') || '; rascunho, em assinatura e descartada fora) e 0 da B'
  FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT cap_exato, papel || ': pino da captação no ponto exato do imóvel'
  FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT cap_det = CASE WHEN papel IN ('gestor', 'admin', 'super_admin') THEN 2
                                    WHEN papel = 'corretor' THEN 1 ELSE 0 END,
  papel || ': detalhe da captação em ' || cap_det || ' (gestor/admin: todas; captador: a dele; demais: nenhuma)'
  FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT vendas_det < qtd, 'corretor: só parte das vendas com detalhe (' || vendas_det || ' de ' || qtd || ')'
  FROM res WHERE papel = 'corretor';
INSERT INTO r SELECT vendas_det = qtd, papel || ': vê o detalhe de todas (' || vendas_det || '), como hoje'
  FROM res WHERE papel IN ('financeiro', 'admin', 'super_admin');
INSERT INTO r SELECT qtd = :ref_b AND cap_total = 1, 'B_admin: só as ' || :ref_b || ' vendas e 1 captação da B (0 da A)'
  FROM res WHERE papel = 'B_admin';

-- Nada além do esperado mudou
INSERT INTO r SELECT md5(string_agg(to_jsonb(s)::text, '' ORDER BY s.id)) = :'sales_md5', 'nenhuma linha de sales alterada'
  FROM public.sales s;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) FROM r;
