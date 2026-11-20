-- Suíte da migration 20261211120000 (boletos de condomínio e gás só quando aplicável, t_a0736d87). Roda DENTRO de
-- transação revertida (run-locacao-boletos.sh), na homologação, só com dados fictícios (Agência A: c2 = QA A Corretor Dois).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _uid = '' THEN '' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.loc(_k text) RETURNS public.locacoes LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT l FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.chk(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_checklist_l(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.falt(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_docs_faltando(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.gas(_k text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_tem_gas(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.partes(_k text) RETURNS text LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT string_agg(p.parte, ',' ORDER BY p.ordem) FROM public.locacao_partes(pg_temp.loc(_k)) p $$;
-- Grava imv_gas direto (dono do banco) para os casos de texto; o caminho do corretor é provado com locacao_contrato_salvar.
CREATE FUNCTION pg_temp.gas_set(_k text, _v text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.locacao_contrato_dados (locacao_id, organization_id, valores)
  SELECT l.id, l.organization_id, CASE WHEN _v IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('imv_gas', _v) END
    FROM public.locacoes l WHERE l.id = pg_temp.id(_k)
  ON CONFLICT (locacao_id) DO UPDATE SET valores = CASE WHEN _v IS NULL THEN locacao_contrato_dados.valores - 'imv_gas'
    ELSE locacao_contrato_dados.valores || jsonb_build_object('imv_gas', _v) END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.locacao_config (organization_id, documentos) VALUES (pg_temp.id('orgA'),
  '{"locatario":["RG/CNH do locatário","Comprovante de renda do locatário"],"proprietario":["RG/CNH do proprietário"]}')
ON CONFLICT (organization_id) DO UPDATE SET documentos = EXCLUDED.documentos;

-- 0) Permissões ---------------------------------------------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_tem_gas(public.locacoes)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.locacao_tem_gas(public.locacoes)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_partes(public.locacoes)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_docs_grupo(uuid, text)', 'EXECUTE')
  AND (SELECT coalesce('search_path=""' = ANY (p.proconfig), false) AND p.prosecdef FROM pg_proc p
        WHERE p.oid = 'public.locacao_tem_gas(public.locacoes)'::regprocedure),
  'funções internas fechadas ao navegador e com search_path vazio');

-- 1) Abre condomínio, casa de rua e comercial (corretor) e leva à Documentação --------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.setid('C', (public.locacao_criar('condominio')->>'id')::uuid);
SELECT pg_temp.setid('H', (public.locacao_criar('casa')->>'id')::uuid);
SELECT pg_temp.setid('K', (public.locacao_criar('comercial')->>'id')::uuid);
RESET ROLE;
SELECT pg_temp.as_user('');
UPDATE public.locacoes SET etapa = 'documentacao', garantia = 'seguro_fianca',
  candidato = '{"nome":"Locatário Fictício","cpf":"529.982.247-25"}' WHERE id IN (pg_temp.id('C'), pg_temp.id('H'), pg_temp.id('K'));

-- 2) Condomínio: boleto obrigatório, CND opcional; casa e comercial sem nada de condomínio --------------------------
SELECT pg_temp.ok(pg_temp.chk('C') @> ARRAY['Boleto do condomínio', 'CND do condomínio (opcional)'],
  'condomínio: checklist com boleto e CND');
SELECT pg_temp.ok(pg_temp.falt('C') @> ARRAY['Boleto do condomínio'] AND NOT pg_temp.falt('C') @> ARRAY['CND do condomínio (opcional)'],
  'condomínio: boleto trava, CND continua opcional');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM unnest(pg_temp.chk('H') || pg_temp.chk('K')) x WHERE x ~* 'condom'),
  'casa de rua e comercial: nenhum documento de condomínio');
SELECT pg_temp.ok(pg_temp.partes('H') = 'locatario,proprietario' AND pg_temp.partes('K') = 'locatario,proprietario',
  'casa/comercial sem gás: só Locatário e Proprietário');

-- 3) Gás: só com código de gás nos dados do contrato -----------------------------------------------------------------
SELECT pg_temp.ok(NOT pg_temp.gas('H') AND NOT pg_temp.chk('H') @> ARRAY['Boleto do gás'], 'sem dado de gás: não pede boleto do gás');
SELECT pg_temp.gas_set('H', 'não possui');
SELECT pg_temp.ok(NOT pg_temp.gas('H') AND NOT pg_temp.chk('H') @> ARRAY['Boleto do gás'], '"não possui": não pede boleto do gás');
SELECT pg_temp.gas_set('H', 'Não tem');
SELECT pg_temp.ok(NOT pg_temp.gas('H'), '"Não tem": não pede');
SELECT pg_temp.gas_set('H', 'sem gás encanado');
SELECT pg_temp.ok(NOT pg_temp.gas('H'), '"sem gás encanado": não pede');
SELECT pg_temp.gas_set('C', 'cobrado no condomínio');
SELECT pg_temp.ok(NOT pg_temp.gas('C') AND NOT pg_temp.chk('C') @> ARRAY['Boleto do gás'],
  'gás cobrado no condomínio: o boleto do condomínio cobre (sem boleto do gás)');
SELECT pg_temp.gas_set('H', '   ');
SELECT pg_temp.ok(NOT pg_temp.gas('H'), 'só espaços: não pede');
-- Caminho real do corretor: "Salvar dados do contrato" com o código de gás.
SELECT pg_temp.gas_set('H', NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_contrato_salvar(pg_temp.id('H'), '{"imv_gas":"123456"}');
RESET ROLE;
SELECT pg_temp.as_user('');
SELECT pg_temp.ok(pg_temp.gas('H') AND pg_temp.partes('H') = 'locatario,proprietario,gas'
  AND pg_temp.falt('H') @> ARRAY['Boleto do gás'], 'com código de gás: parte "Gás" com boleto obrigatório');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok((SELECT x->>'rotulo' = 'Gás' AND x->'itens'->0->>'item' = 'Boleto do gás' AND (x->'itens'->0->>'obrigatorio')::boolean
   FROM jsonb_array_elements(public.locacao_detalhe(pg_temp.id('H'))->'partes') x WHERE x->>'parte' = 'gas'),
  'tela: parte "Gás" aparece no checklist da locação com boleto obrigatório');
SELECT pg_temp.ok((SELECT bool_and(NOT (x->>'item' = 'CND do condomínio (opcional)') OR NOT (x->>'obrigatorio')::boolean)
     AND bool_or(x->>'item' = 'Boleto do condomínio' AND (x->>'obrigatorio')::boolean)
   FROM jsonb_array_elements(public.locacao_detalhe(pg_temp.id('C'))->'partes') p, jsonb_array_elements(p->'itens') x
   WHERE p->>'parte' = 'condominio'), 'tela: boleto do condomínio obrigatório e CND opcional');
-- Trava do envio: a Documentação não segue sem o boleto do condomínio.
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)', pg_temp.id('C'))) LIKE '22023%Boleto do condomínio%',
  'envio da Documentação trava sem o boleto do condomínio');
-- O corretor marca "não possui" depois: o boleto do gás sai da lista e não trava mais.
SELECT public.locacao_contrato_salvar(pg_temp.id('H'), '{"imv_gas":"não possui"}');
RESET ROLE;
SELECT pg_temp.as_user('');
SELECT pg_temp.ok(NOT pg_temp.falt('H') @> ARRAY['Boleto do gás'] AND pg_temp.partes('H') = 'locatario,proprietario',
  'trocar para "não possui" tira o boleto do gás');

-- 4) Anexar o boleto do condomínio libera a parte Condomínio (o arquivo entra pela lista normal) -----------------------
INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo)
SELECT pg_temp.id('orgA'), pg_temp.id('C'), x, 'boletos-teste/' || md5(x) || '.pdf', 'doc-ficticio.pdf'
  FROM unnest(pg_temp.chk('C')) x WHERE NOT public.locacao_doc_opcional(x);
SELECT pg_temp.ok(cardinality(pg_temp.falt('C')) = 0, 'com todos os obrigatórios (boleto incluído), nada falta');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
