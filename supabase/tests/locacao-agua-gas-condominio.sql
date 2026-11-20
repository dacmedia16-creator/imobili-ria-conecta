-- Suíte da migration 20261211150000 (água e gás incluídos no condomínio, t_778e6bef). Roda DENTRO de transação
-- revertida (run-locacao-agua-gas-condominio.sh), na homologação, só com dados fictícios (Agência A: c2 = QA A Corretor Dois).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _uid = '' THEN '' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.loc(_k text) RETURNS public.locacoes LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT l FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.chk(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_checklist_l(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.cfalt(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_contrato_faltando(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.contas(_k text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_contas_condominio(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.salvar(_k text, _d jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.locacao_contrato_dados (locacao_id, organization_id, valores)
  SELECT l.id, l.organization_id, _d FROM public.locacoes l WHERE l.id = pg_temp.id(_k)
  ON CONFLICT (locacao_id) DO UPDATE SET valores = locacao_contrato_dados.valores || _d $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;

-- 0) Permissões ---------------------------------------------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_contas_condominio(public.locacoes)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.locacao_contas_condominio(public.locacoes)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_json(public.locacoes)', 'EXECUTE')
  AND (SELECT coalesce('search_path=""' = ANY (p.proconfig), false) AND p.prosecdef FROM pg_proc p
        WHERE p.oid = 'public.locacao_contas_condominio(public.locacoes)'::regprocedure),
  'funções internas fechadas ao navegador e com search_path vazio');

-- 1) Condomínio residencial com fiador (exige dados do contrato) e casa de rua ------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.setid('C', (public.locacao_criar('condominio')->>'id')::uuid);
SELECT pg_temp.setid('H', (public.locacao_criar('casa')->>'id')::uuid);
RESET ROLE;
SELECT pg_temp.as_user('');
UPDATE public.locacoes SET etapa = 'documentacao', garantia = 'fiador',
  candidato = '{"nome":"Locatário Fictício","cpf":"529.982.247-25"}' WHERE id IN (pg_temp.id('C'), pg_temp.id('H'));

-- 2) Desmarcado = como hoje ------------------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.cfalt('C') @> ARRAY['código de água'], 'desmarcado: código de água continua obrigatório');
SELECT pg_temp.ok(pg_temp.contas('C') = '{"agua": false, "gas": false}'::jsonb, 'desmarcado: nada incluído no condomínio');
SELECT pg_temp.salvar('C', '{"imv_gas":"123456"}');
SELECT pg_temp.ok(pg_temp.chk('C') @> ARRAY['Boleto do gás'], 'desmarcado com código de gás: boleto do gás pedido como hoje');

-- 3) Marcado pelo caminho real do corretor (Salvar dados do contrato) -------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_contrato_salvar(pg_temp.id('C'), '{"imv_agua":"incluída no condomínio","imv_gas":"incluído no condomínio"}');
SELECT pg_temp.ok((public.locacao_detalhe(pg_temp.id('C'))->'contas_condominio') = '{"agua": true, "gas": true}'::jsonb,
  'tela (detalhe): contas_condominio = água e gás incluídos');
SELECT pg_temp.ok((SELECT x->'contas_condominio' = '{"agua": true, "gas": true}'::jsonb
   FROM jsonb_array_elements(public.locacao_lista()) x WHERE (x->>'id')::uuid = pg_temp.id('C')),
  'tela (lista): contas_condominio chega também na lista (aviso de protocolo)');
RESET ROLE;
SELECT pg_temp.as_user('');
SELECT pg_temp.ok(NOT pg_temp.cfalt('C') @> ARRAY['código de água'], 'marcado: código de água não falta (motivo gravado)');
SELECT pg_temp.ok(NOT pg_temp.chk('C') @> ARRAY['Boleto do gás'], 'marcado: boleto do gás deixa de ser pedido');
SELECT pg_temp.ok((SELECT valores->>'imv_agua' FROM public.locacao_contrato_dados WHERE locacao_id = pg_temp.id('C'))
  = 'incluída no condomínio', 'motivo "incluída no condomínio" fica gravado e visível para quem confere');
SELECT pg_temp.ok((SELECT pos FROM public.locacoes WHERE id = pg_temp.id('C'))
  = '{"tit":{"cpfl":{"aplica":true},"saae":{"aplica":true},"gas":{"aplica":false}}}'::jsonb,
  'pos.tit não é gravado (o "não se aplica" é calculado)');

-- 4) Texto livre antigo continua valendo; só a água marcada --------------------------------------------------------------
SELECT pg_temp.salvar('C', '{"imv_agua":"SAAE 998877","imv_gas":"cobrado no condomínio"}');
SELECT pg_temp.ok(pg_temp.contas('C') = '{"agua": false, "gas": true}'::jsonb
  AND NOT pg_temp.chk('C') @> ARRAY['Boleto do gás'], 'texto livre "cobrado no condomínio" (gás) continua valendo');
SELECT pg_temp.salvar('C', '{"imv_gas":"não possui"}');
SELECT pg_temp.ok(pg_temp.contas('C') = '{"agua": false, "gas": false}'::jsonb, '"não possui" não é "incluído no condomínio"');

-- 5) Casa de rua: sem marcação, nada muda --------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.contas('H') = '{"agua": false, "gas": false}'::jsonb AND pg_temp.cfalt('H') @> ARRAY['código de água'],
  'casa de rua: código de água pedido como hoje');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
