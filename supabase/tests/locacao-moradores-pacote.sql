-- Suíte da migration 20261216120000 (ficha de moradores + pacote para a administradora, t_40cff7e4). Roda DENTRO de
-- transação revertida (run-locacao-moradores-pacote.sh), na homologação, só com dados fictícios. Pessoas (Agência A):
-- c2 = QA A Corretor Dois (corretor da locação), a1 = UE Corretor (outro corretor), con = QA A Dono Plataforma (vistoria),
-- ges = QA A Corretor Tres (gestora da locação), adm = QA A Admin; b1/admB = Agência B.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
GRANT ALL ON r, ids, js TO authenticated, service_role, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _uid = '' THEN '' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
-- Conferências diretas (tabelas fechadas ao navegador) pelo dono do banco.
CREATE FUNCTION pg_temp.loc(_k text) RETURNS public.locacoes LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT l FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.checklist(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT public.locacao_checklist_l(l) FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.faltando(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT public.locacao_docs_faltando(l) FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.ct_faltando(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT public.locacao_contrato_faltando(l) FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.moradores_txt(_k text) RETURNS text LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT public.locacao_contrato_valores(l)->>'moradores' FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.downloads(_k text) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT count(*) FROM public.locacao_pacote_downloads WHERE locacao_id = (SELECT v FROM ids WHERE k = _k) $$;
-- now() não anda dentro da transação: confere o conjunto de quem baixou (e que o horário foi gravado).
CREATE FUNCTION pg_temp.quem_baixou(_k text) RETURNS uuid[] LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT array_agg(baixado_por ORDER BY baixado_por) FROM public.locacao_pacote_downloads
      WHERE locacao_id = (SELECT v FROM ids WHERE k = _k) AND baixado_em IS NOT NULL $$;
CREATE FUNCTION pg_temp.eventos(_k text) RETURNS text LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT coalesce(string_agg(descricao, ' | ' ORDER BY id), '') FROM public.locacao_eventos WHERE locacao_id = (SELECT v FROM ids WHERE k = _k) $$;
-- Simula o upload: o arquivo "chega" no bucket privado (só o caminho; dono do banco).
CREATE FUNCTION pg_temp.objeto(_path text) RETURNS void LANGUAGE sql SECURITY DEFINER AS
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('locacao-documentos', _path) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role, anon;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('ges', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('con', 'b316b223-da46-4c2c-9952-25096d5ae5ff'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'),
  ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true),
  (pg_temp.id('orgB'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('ges'), 'gestora'),
  (pg_temp.id('orgA'), pg_temp.id('con'), 'vistoria')
ON CONFLICT DO NOTHING;

-- 0) Estrutura, permissões e locações antigas --------------------------------------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.locacoes WHERE moradores_ficha),
  'locações que já existiam ficam com texto livre (moradores_ficha = false), sem UPDATE');
SELECT pg_temp.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.locacao_moradores'::regclass, 'public.locacao_pacote_downloads'::regclass))
  AND NOT has_table_privilege('authenticated', 'public.locacao_moradores', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.locacao_moradores', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.locacao_moradores', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.locacao_pacote_downloads', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.locacao_pacote_downloads', 'INSERT'),
  'tabelas novas com RLS e sem acesso direto do navegador (anon/authenticated)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_moradores_ler', 'locacao_moradores_salvar', 'locacao_pacote_preparar', 'locacao_pacote_registrar')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR NOT p.prosecdef OR NOT coalesce('search_path=""' = ANY (p.proconfig), false))),
  'RPCs novas: só com login, SECURITY DEFINER e search_path vazio');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_morador_pode', 'locacao_morador_itens', 'locacao_morador_adulto', 'locacao_morador_item', 'locacao_moradores_texto')
   AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'funções internas fora do alcance do navegador');

-- Locações fictícias: N = nova (condomínio, caução), V = antiga com texto livre, K = nova casa de rua, B = Agência B.
WITH s AS (INSERT INTO public.locacoes (organization_id, corretor_id, etapa, aluguel, taxa_adm, endereco, garantia, imovel_tipo, candidato, ficha)
  VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'documentacao', 3000, 10, 'Rua Fictícia Moradores, 100', 'caucao', 'condominio',
    '{"nome":"Locatário Fictício","cpf":"529.982.247-25","nascimento":"1985-02-01","email":"loc@exemplo.com","telefone":"(15) 98888-0000"}',
    '{"complemento":"Bloco B, apto 34"}') RETURNING id)
INSERT INTO ids SELECT 'N', id FROM s;
WITH s AS (INSERT INTO public.locacoes (organization_id, corretor_id, etapa, aluguel, taxa_adm, endereco, garantia, imovel_tipo, moradores_ficha)
  VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'documentacao', 2000, 10, 'Rua Fictícia Antiga, 5', 'caucao', 'condominio', false) RETURNING id)
INSERT INTO ids SELECT 'V', id FROM s;
WITH s AS (INSERT INTO public.locacoes (organization_id, corretor_id, etapa, aluguel, taxa_adm, endereco, garantia, imovel_tipo)
  VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'documentacao', 2500, 10, 'Rua Fictícia Casa, 9', 'caucao', 'casa') RETURNING id)
INSERT INTO ids SELECT 'K', id FROM s;
WITH s AS (INSERT INTO public.locacoes (organization_id, corretor_id, etapa, aluguel, taxa_adm, endereco, garantia, imovel_tipo)
  VALUES (pg_temp.id('orgB'), pg_temp.id('b1'), 'documentacao', 1500, 10, 'Rua Fictícia B', 'caucao', 'condominio') RETURNING id)
INSERT INTO ids SELECT 'B', id FROM s;
SELECT pg_temp.ok((pg_temp.loc('N')).moradores_ficha AND NOT (pg_temp.loc('V')).moradores_ficha,
  'locação nova nasce exigindo a ficha; a marcada como antiga não');

-- 1) Locação ANTIGA: texto livre continua funcionando, sem migração manual ---------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_contrato_salvar(pg_temp.id('V'), '{"moradores": "Fulano Antigo — CPF 529.982.247-25", "prazo_meses": "30", "dia_vencimento": "10"}');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.moradores_txt('V') = 'Fulano Antigo — CPF 529.982.247-25'
  AND NOT ('moradores' = ANY (pg_temp.ct_faltando('V'))),
  'antiga: texto livre aceito e "moradores" deixa de faltar (igual a hoje)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM unnest(pg_temp.checklist('V')) x WHERE x LIKE 'Cópia do RG — %'),
  'antiga sem ficha: nenhum RG de morador exigido');

-- 2) Locação NOVA: ficha, RG ≥18 e contrato com o mesmo texto ----------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"moradores": "Texto Livre — CPF 529.982.247-25"}'')',
  pg_temp.id('N'))) LIKE '22023%ficha de moradores%', 'nova: texto livre de moradores recusado (só pela ficha)');
SELECT pg_temp.ok((public.locacao_moradores_ler(pg_temp.id('N'))->>'ficha')::boolean = false
  AND (public.locacao_moradores_ler(pg_temp.id('N'))->>'obrigatoria')::boolean, 'nova: ficha vazia e obrigatória');
SELECT pg_temp.put('salvo', public.locacao_moradores_salvar(pg_temp.id('N'), jsonb_build_array(
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000001', 'nome', ' Ana Fictícia ', 'cpf', '529.982.247-25',
    'nascimento', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '18 years', 'YYYY-MM-DD'),
    'email', 'ana@exemplo.com', 'telefone', '(15) 99999-0000'),
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000002', 'nome', 'Bia Fictícia', 'cpf', '111.444.777-35',
    'nascimento', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '18 years' + interval '1 day', 'YYYY-MM-DD'),
    'email', '', 'telefone', ''))));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('salvo')->'rgs' = '["Cópia do RG — Ana Fictícia"]'::jsonb,
  '≥18 (faz 18 hoje) gera "Cópia do RG — Ana Fictícia"; <18 (faz 18 amanhã) não gera');
SELECT pg_temp.ok('Cópia do RG — Ana Fictícia' = ANY (pg_temp.faltando('N'))
  AND NOT EXISTS (SELECT 1 FROM unnest(pg_temp.checklist('N')) x WHERE x LIKE '%Bia%'),
  '≥18: RG obrigatório entra no que falta da documentação; <18 fora do checklist');
SELECT pg_temp.ok(pg_temp.moradores_txt('N') = 'Ana Fictícia — CPF 529.982.247-25' || chr(10) || 'Bia Fictícia — CPF 111.444.777-35',
  'contrato recebe o mesmo texto de antes: "Nome — CPF xxx", um por linha (nome aparado)');
SELECT pg_temp.ok(NOT ('moradores' = ANY (pg_temp.ct_faltando('N'))), 'com a ficha salva, "moradores" deixa de faltar no contrato');
SELECT pg_temp.ok(pg_temp.eventos('N') LIKE '%Ficha de moradores salva (2 morador(es))%', 'histórico registra a ficha salva');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)', pg_temp.id('N'))) LIKE '%Cópia do RG — Ana Fictícia%',
  'enviar documentação recusa enquanto falta o RG do morador maior de 18');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.locacao_detalhe(pg_temp.id('N'))->'partes') p,
    jsonb_array_elements(p->'itens') i WHERE p->>'parte' = 'locatario' AND i->>'item' = 'Cópia do RG — Ana Fictícia'
    AND (i->>'obrigatorio')::boolean AND NOT (i->>'entregue')::boolean),
  'tela: RG aparece na parte do locatário, obrigatório e pendente');

-- 3) Validação da ficha ------------------------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, %L)', pg_temp.id('N'), jsonb_build_array(
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000009', 'nome', 'Ze Fictício', 'cpf', '111.111.111-11',
    'nascimento', '1990-01-01', 'email', 'ze@exemplo.com', 'telefone', '15999990000'))::text)) LIKE '22023%CPF%', 'CPF inválido recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, %L)', pg_temp.id('N'), jsonb_build_array(
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000009', 'nome', 'Ze Fictício', 'cpf', '529.982.247-25',
    'nascimento', '1990-01-01', 'email', '', 'telefone', '15999990000'))::text)) LIKE '22023%E-mail%', 'adulto sem e-mail recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, %L)', pg_temp.id('N'), jsonb_build_array(
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000009', 'nome', 'Ze Fictício', 'cpf', '529.982.247-25',
    'nascimento', '2999-01-01', 'email', '', 'telefone', ''))::text)) LIKE '22023%nascimento%', 'nascimento no futuro recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, %L)', pg_temp.id('N'), jsonb_build_array(
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000009', 'nome', 'Ze Fictício', 'cpf', '529.982.247-25',
    'nascimento', '1990-01-01', 'email', 'ze@exemplo.com', 'telefone', '15999990000', 'extra', 'x'))::text)) LIKE '22023%',
  'campo fora da lista recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, %L)', pg_temp.id('N'), jsonb_build_array(
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000008', 'nome', 'Ze Fictício', 'cpf', '529.982.247-25',
    'nascimento', '1990-01-01', 'email', 'ze@exemplo.com', 'telefone', '15999990000'),
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000009', 'nome', 'Outro Fictício', 'cpf', '52998224725',
    'nascimento', '1990-01-01', 'email', 'o@exemplo.com', 'telefone', '15999990001'))::text)) LIKE '22023%repetido%',
  'mesmo CPF em dois moradores recusado');

-- 4) RG anexado pelo mesmo caminho dos documentos (preparar → bucket → registrar → ver) ------------------------------
SELECT pg_temp.put('prep', public.locacao_documento_preparar(pg_temp.id('N'), 'Cópia do RG — Ana Fictícia', 'jpg'));
RESET ROLE;
SELECT pg_temp.objeto(pg_temp.j('prep')->>'path');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('doc', public.locacao_documento_registrar(pg_temp.id('N'), 'Cópia do RG — Ana Fictícia', pg_temp.j('prep')->>'path', 'rg-ana.jpg'));
RESET ROLE;
SELECT pg_temp.ok(NOT ('Cópia do RG — Ana Fictícia' = ANY (pg_temp.faltando('N'))), 'RG anexado: deixa de faltar');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.locacao_documento_ver((pg_temp.j('doc')->>'id')::uuid)->>'path' = pg_temp.j('prep')->>'path',
  'corretor abre o RG pelo link assinado (mesmo fluxo dos documentos)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, %L)', pg_temp.id('N'), jsonb_build_array(
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000001', 'nome', 'Ana Fictícia Renomeada', 'cpf', '529.982.247-25',
    'nascimento', '1990-01-01', 'email', 'ana@exemplo.com', 'telefone', '(15) 99999-0000'))::text)) LIKE '22023%Remova a cópia do RG%',
  'com RG anexado, trocar o nome ou tirar o morador exige remover o RG antes');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, %L)', pg_temp.id('N'), jsonb_build_array(
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000001', 'nome', 'Ana Fictícia', 'cpf', '390.533.447-05',
    'nascimento', '1990-01-01', 'email', 'ana@exemplo.com', 'telefone', '(15) 99999-0000'),
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000002', 'nome', 'Bia Fictícia', 'cpf', '111.444.777-35',
    'nascimento', '2016-04-04', 'email', '', 'telefone', ''))::text)) LIKE '22023%Remova a cópia do RG%CPF%',
  'com RG anexado, trocar o CPF do morador exige remover o RG antes');

-- 5) Acesso: só corretor da locação + gestão; isolamento entre imobiliárias --------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_ler(%L)', pg_temp.id('N'))) LIKE '42501%',
  'outro corretor da mesma imobiliária: não lê a ficha');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pacote_preparar(%L)', pg_temp.id('N'))) LIKE '42501%',
  'outro corretor: não baixa o pacote');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, ''[]'')', pg_temp.id('N'))) LIKE '42501%',
  'outro corretor: não grava a ficha');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_ver(%L)', pg_temp.j('doc')->>'id')) LIKE '42501%',
  'outro corretor: não abre o RG');
SELECT pg_temp.ok(NOT (coalesce(public.locacao_consultar_imovel('Moradores')::text, '') ~* 'Ana Fict|529[.]982|ana@exemplo'),
  '"Consultar imóvel" não mostra nenhum dado dos moradores');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_ler(%L)', pg_temp.id('N'))) LIKE '42501%',
  'vistoria (vê a locação, não é gestão): não lê a ficha');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pacote_registrar(%L)', pg_temp.id('N'))) LIKE '42501%',
  'vistoria: não registra download');
-- Quem vê a locação mas não é da gestão (vistoria/contratos/financeiro/líder): nada do RG dos moradores aparece.
SELECT pg_temp.put('det_con', public.locacao_detalhe(pg_temp.id('N')));
SELECT pg_temp.ok(pg_temp.j('det_con') IS NOT NULL
  AND position('Cópia do RG' IN (pg_temp.j('det_con')->'checklist')::text) = 0
  AND position('Cópia do RG' IN (pg_temp.j('det_con')->'faltando')::text) = 0
  AND position('Cópia do RG' IN (pg_temp.j('det_con')->'partes')::text) = 0
  AND position('Cópia do RG' IN (pg_temp.j('det_con')->'documentos')::text) = 0
  AND position('Cópia do RG' IN (pg_temp.j('det_con')->'eventos')::text) = 0
  AND position('rg-ana' IN pg_temp.j('det_con')::text) = 0
  AND jsonb_array_length(pg_temp.j('det_con')->'partes') > 0,
  'vistoria abre a locação, mas checklist, pendências, documentos e histórico não mostram o RG dos moradores');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_ver(%L)', pg_temp.j('doc')->>'id')) LIKE '42501%',
  'vistoria: não abre o RG do morador (link assinado recusado)');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(position('Cópia do RG — Ana Fictícia' IN (public.locacao_detalhe(pg_temp.id('N'))->'documentos')::text) > 0
  AND (public.locacao_detalhe(pg_temp.id('N'))->>'moradores_com_ficha')::boolean,
  'corretor da locação vê o RG do morador na lista de documentos');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_moradores_ler(pg_temp.id('N'))->'pessoas') = 2, 'gestora da locação lê a ficha');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, ''[]'')', pg_temp.id('N'))) LIKE '42501%',
  'gestora lê mas não grava (só o corretor)');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_moradores_ler(pg_temp.id('N'))->'pessoas') = 2, 'administrador da imobiliária lê a ficha');
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_ler(%L)', pg_temp.id('N'))) LIKE '42501%',
  'administrador de OUTRA imobiliária: não lê a ficha');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pacote_preparar(%L)', pg_temp.id('N'))) LIKE '42501%',
  'administrador de OUTRA imobiliária: não baixa o pacote');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pacote_registrar(%L)', pg_temp.id('N'))) LIKE '42501%',
  'administrador de OUTRA imobiliária: não registra download');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_ver(%L)', pg_temp.j('doc')->>'id')) LIKE '42501%',
  'administrador de OUTRA imobiliária: não abre o RG');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, ''[]'')', pg_temp.id('N'))) LIKE '42501%',
  'corretor de OUTRA imobiliária: não grava a ficha');
SELECT pg_temp.as_user('');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_ler(%L)', pg_temp.id('N'))) LIKE '42501%', 'sem login: recusado');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.downloads('N') = 0, 'nenhuma tentativa recusada gravou download');

-- 6) Pacote para a administradora --------------------------------------------------------------------------------------
UPDATE public.locacao_contrato_dados SET valores = valores || '{"inicio": "2026-12-01"}' WHERE locacao_id = pg_temp.id('N');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('pac', public.locacao_pacote_preparar(pg_temp.id('N')));
SELECT pg_temp.ok(pg_temp.j('pac')->'locatario'->>'nome' = 'Locatário Fictício'
  AND pg_temp.j('pac')->>'unidade' = 'Bloco B, apto 34' AND pg_temp.j('pac')->>'entrada' = '2026-12-01'
  AND pg_temp.j('pac')->>'endereco' = 'Rua Fictícia Moradores, 100'
  AND jsonb_array_length(pg_temp.j('pac')->'moradores') = 2
  AND pg_temp.j('pac')->'moradores'->0->>'email' = 'ana@exemplo.com'
  AND jsonb_array_length(pg_temp.j('pac')->'rgs') = 1 AND pg_temp.j('pac')->'rgs'->0->>'path' = pg_temp.j('prep')->>'path',
  'pacote traz locatário, moradores (com e-mail/telefone), RG, endereço/unidade e data de entrada');
SELECT public.locacao_pacote_registrar(pg_temp.id('N'));
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_pacote_preparar(pg_temp.id('N')) IS NOT NULL;
SELECT public.locacao_pacote_registrar(pg_temp.id('N'));
SELECT pg_temp.ok(jsonb_array_length(public.locacao_moradores_ler(pg_temp.id('N'))->'downloads') = 2,
  'tela mostra quem baixou e quando');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pacote_preparar(%L)', pg_temp.id('K'))) LIKE '22023%condomínio%',
  'casa de rua: sem pacote');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.downloads('N') = 2
  AND pg_temp.quem_baixou('N') = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.id('c2'), pg_temp.id('ges')]) x),
  'download registrado com quem baixou (corretor e gestora) e quando');
SELECT pg_temp.ok(pg_temp.eventos('N') LIKE '%Pacote para a administradora baixado%', 'histórico registra o download');
-- Sem RG anexado o pacote não sai.
UPDATE public.locacao_documentos SET removido_em = now() WHERE id = (pg_temp.j('doc')->>'id')::uuid;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pacote_preparar(%L)', pg_temp.id('N'))) LIKE '22023%Falta anexar: Cópia do RG — Ana Fictícia%',
  'pacote recusado enquanto falta RG obrigatório');
-- Sem RG, agora pode tirar a Ana; ficando só a menor, nada de RG é exigido.
SELECT public.locacao_moradores_salvar(pg_temp.id('N'), jsonb_build_array(
  jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-000000000002', 'nome', 'Bia Fictícia', 'cpf', '11144477735',
    'nascimento', '2016-04-04', 'email', '', 'telefone', '')));
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM unnest(pg_temp.checklist('N')) x WHERE x LIKE 'Cópia do RG — %')
  AND pg_temp.moradores_txt('N') = 'Bia Fictícia — CPF 111.444.777-35',
  'só menor: nenhum RG exigido e contrato atualizado (CPF digitado sem pontos vai com máscara)');

-- 6b) Idade congelada ao sair da Documentação -------------------------------------------------------------------------
-- Morador que faz 18 HOJE; a data ficou congelada ONTEM (saiu da Documentação ontem): não exige RG nem trava a minuta.
WITH s AS (INSERT INTO public.locacoes (organization_id, corretor_id, etapa, aluguel, taxa_adm, endereco, garantia, imovel_tipo)
  VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'documentacao', 2200, 10, 'Rua Fictícia Idade, 7', 'caucao', 'condominio') RETURNING id)
INSERT INTO ids SELECT 'I', id FROM s;
INSERT INTO public.locacao_moradores (locacao_id, organization_id, pessoas) VALUES (pg_temp.id('I'), pg_temp.id('orgA'),
  jsonb_build_array(jsonb_build_object('id', '6f1b7c1e-0000-4000-8000-0000000000a1', 'nome', 'Caio Fictício', 'cpf', '529.982.247-25',
    'nascimento', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '18 years', 'YYYY-MM-DD'),
    'email', 'caio@exemplo.com', 'telefone', '15999990002')));
SELECT pg_temp.ok('Cópia do RG — Caio Fictício' = ANY (pg_temp.checklist('I')), 'na Documentação a idade conta pela data de hoje');
UPDATE public.locacoes SET etapa = 'minuta' WHERE id = pg_temp.id('I');
SELECT pg_temp.ok((SELECT referencia FROM public.locacao_moradores WHERE locacao_id = pg_temp.id('I'))
  = (now() AT TIME ZONE 'America/Sao_Paulo')::date, 'ao sair da Documentação a data de referência é congelada');
UPDATE public.locacao_moradores SET referencia = referencia - 1 WHERE locacao_id = pg_temp.id('I');
SELECT pg_temp.ok(NOT ('Cópia do RG — Caio Fictício' = ANY (pg_temp.checklist('I')))
  AND NOT ('Cópia do RG — Caio Fictício' = ANY (pg_temp.faltando('I'))),
  'congelada ontem: aniversário de 18 anos hoje não cria pendência nem trava a minuta');
UPDATE public.locacoes SET etapa = 'documentacao' WHERE id = pg_temp.id('I');
SELECT pg_temp.ok((SELECT referencia FROM public.locacao_moradores WHERE locacao_id = pg_temp.id('I')) IS NULL
  AND 'Cópia do RG — Caio Fictício' = ANY (pg_temp.checklist('I')),
  'devolvida à Documentação: a idade volta a contar pela data de hoje');

-- 7) Etapa: ficha só na Documentação -----------------------------------------------------------------------------------
UPDATE public.locacoes SET etapa = 'conferencia' WHERE id = pg_temp.id('N');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_moradores_salvar(%L, ''[]'')', pg_temp.id('N'))) LIKE '22023%etapa%',
  'fora da Documentação a ficha não muda');
SELECT pg_temp.ok(jsonb_array_length(public.locacao_moradores_ler(pg_temp.id('N'))->'pessoas') = 1, 'mas continua legível');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
