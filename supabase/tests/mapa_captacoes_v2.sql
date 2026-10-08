-- Suíte da migration 20261008170000 (mapa_captacoes_v2: preço para todos + contato do captador).
-- Roda DENTRO de transação revertida (ver run-mapa-captacoes-v2.sh). Homologação: imobiliárias
-- A = Única (00000000-…-0001) e B = agencia-b-homolog (2a000000-…-00b0).
-- Saída: linhas "ok …" / "FALHA …" e "TOTAL=<falhas>".
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE res(papel text, total int, ids text, det int, preco_todos bool, contato_ok bool,
  equipe_ok bool, vazou bool, cap_b int);
GRANT ALL ON r, res TO authenticated;

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

-- Contato fictício do corretor captador (o que DEVE aparecer) e equipe dele.
UPDATE public.profiles SET telefone = '(15) 90000-0001', email = 'captador.qa@example.test', ativo = true
 WHERE id = :'a_corretor';
SELECT coalesce((SELECT t.nome FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
  WHERE tm.membro_id = :'a_corretor' LIMIT 1), '') AS equipe_ref \gset

UPDATE public.organization_modules SET enabled = true WHERE module = 'captacao_exclusiva'
  AND organization_id IN ('00000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-0000000000b0');
-- Dados do proprietário, testemunha e comissão com marcador SEGREDO: nunca podem sair.
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, status, form_data, broker_name,
  organization_id, geo_lat, geo_lon, geo_key, signed_on) VALUES
 ('c0000000-0000-4000-8000-0000000000a1', :'a_corretor', :'a_corretor', 'campolim', 'aprovada',
  '{"proprietario_1":{"nome_completo":"SEGREDO NOME","telefone_1":"SEGREDO 15999","email":"segredo@x.com","cpf":"SEGREDO-CPF"},
    "testemunha_1":{"nome":"SEGREDO TESTEMUNHA"},
    "imovel":{"tipo_imovel":"Casa","endereco":"Rua Exata QA, 123","bairro":"Campolim","municipio":"Sorocaba","estado":"SP","valor_imovel":"R$ 850.000,00"},
    "condicoes":{"prazo_dias_numero":"180","comissao_percentual_numero":"SEGREDO-COMISSAO"}}',
  'Corretor QA A', '00000000-0000-4000-8000-000000000001', -23.512345, -47.465432, 'k1', '2026-09-01'),
 ('c0000000-0000-4000-8000-0000000000a2', :'a_admin', :'a_admin', 'campolim', 'rascunho',
  '{"imovel":{"tipo_imovel":"Apartamento","bairro":"Centro","municipio":"Sorocaba","valor_imovel":"R$ 1,00"}}',
  'Admin QA A', '00000000-0000-4000-8000-000000000001', -23.49, -47.45, 'k2', NULL),
 ('c0000000-0000-4000-8000-0000000000a4', :'a_admin', :'a_admin', 'campolim', 'aprovada',
  '{"proprietario_1":{"nome_completo":"SEGREDO NOME 4"},"imovel":{"tipo_imovel":"Apartamento","endereco":"Rua Assinada QA, 44","bairro":"Centro","municipio":"Sorocaba","valor_imovel":"R$ 420.000,00"}}',
  'Admin QA A', '00000000-0000-4000-8000-000000000001', -23.501234, -47.458765, 'k4', '2026-09-15'),
 ('c0000000-0000-4000-8000-0000000000b1', :'b_admin', :'b_admin', 'campolim', 'aprovada',
  '{"imovel":{"tipo_imovel":"Casa","bairro":"Cambuí","municipio":"Campinas","valor_imovel":"R$ 999.000,00"}}',
  'Admin QA B', '2a000000-0000-4000-8000-0000000000b0', -22.9, -47.06, 'kb', '2026-09-20');

INSERT INTO r VALUES
 (NOT has_function_privilege('anon', 'public.mapa_captacoes_v2()', 'EXECUTE'), 'anon não executa mapa_captacoes_v2'),
 (has_function_privilege('authenticated', 'public.mapa_captacoes_v2()', 'EXECUTE'), 'authenticated executa mapa_captacoes_v2'),
 ((SELECT proowner::regrole::text = 'mt_1b_definer' AND prosecdef AND array_to_string(proconfig, ',') IN ('search_path=""', 'search_path=')
     FROM pg_proc WHERE oid = 'public.mapa_captacoes_v2()'::regprocedure), 'definer, dono mt_1b_definer, search_path vazio'),
 ((SELECT count(*) FROM pg_proc WHERE oid = 'public.mapa_captacoes()'::regprocedure) = 1, 'mapa_captacoes() antiga continua existindo');

CREATE FUNCTION pg_temp.coleta(_papel text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _c jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') INTO _c FROM public.mapa_captacoes_v2() t;
  INSERT INTO res SELECT _papel,
    (SELECT count(*) FROM jsonb_array_elements(_c) e WHERE e->>'id' LIKE 'c0000000-0000-4000-8000-0000000000%'),
    (SELECT string_agg(right(e->>'id', 2), ',' ORDER BY e->>'id') FROM jsonb_array_elements(_c) e
      WHERE e->>'id' LIKE 'c0000000-0000-4000-8000-0000000000%'),
    (SELECT count(*) FROM jsonb_array_elements(_c) e WHERE e->>'id' LIKE 'c0000000-%' AND (e->>'detalhe')::boolean),
    -- preço para todos os perfis
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_c) e WHERE e->>'id' LIKE 'c0000000-%' AND e->>'valor_imovel' IS NULL)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(_c) e WHERE right(e->>'id', 2) = 'a1' AND e->>'valor_imovel' = 'R$ 850.000,00'),
    -- contato do corretor captador
    EXISTS (SELECT 1 FROM jsonb_array_elements(_c) e WHERE right(e->>'id', 2) = 'a1'
      AND e->>'captador_telefone' = '(15) 90000-0001' AND e->>'captador_email' = 'captador.qa@example.test'),
    EXISTS (SELECT 1 FROM jsonb_array_elements(_c) e WHERE right(e->>'id', 2) = 'a1'
      AND coalesce(e->>'equipe', '') = current_setting('qa.equipe_ref')),
    -- vazamento: proprietário/testemunha/comissão, ou detalhe para quem não pode
    _c::text ~* 'segredo'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(_c) e WHERE NOT (e->>'detalhe')::boolean AND (
           e->>'endereco' IS NOT NULL OR e->>'status' IS NOT NULL OR e->>'signed_on' IS NOT NULL
           OR (e->>'pode_abrir')::boolean)),
    (SELECT count(*) FROM jsonb_array_elements(_c) e WHERE e->>'id' LIKE 'c0000000-0000-4000-8000-0000000000b%');
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.coleta(text) TO authenticated;
SELECT set_config('qa.equipe_ref', :'equipe_ref', true);

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

SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true), set_config('request.jwt.claim.sub', '', true);
DO $$ BEGIN
  PERFORM public.mapa_captacoes_v2();
  INSERT INTO r VALUES (false, 'sem login executou mapa_captacoes_v2');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES (true, 'sem login: mapa_captacoes_v2 negado (42501)');
END $$;
RESET ROLE;

INSERT INTO r SELECT total = 2 AND ids = 'a1,a4' AND cap_b = 0,
  papel || ': vê só as 2 assinadas da A (' || coalesce(ids, '-') || '; rascunho fora) e 0 da B' FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT preco_todos, papel || ': preço do imóvel visível' FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT contato_ok, papel || ': telefone e e-mail do corretor captador' FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT equipe_ok, papel || ': equipe do captador = "' || :'equipe_ref' || '"' FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT NOT vazou, papel || ': nada do proprietário/testemunha/comissão; sem detalhe para quem não pode' FROM res;
INSERT INTO r SELECT det = CASE WHEN papel IN ('gestor', 'admin', 'super_admin') THEN 2
                                WHEN papel = 'corretor' THEN 1 ELSE 0 END,
  papel || ': detalhe (endereço/situação) em ' || det FROM res WHERE papel <> 'B_admin';
INSERT INTO r SELECT total - cap_b = 0 AND cap_b = 1, 'outra imobiliária (B_admin): 0 captações da A (vê só a 1 dela)'
  FROM res WHERE papel = 'B_admin';

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) FROM r;
