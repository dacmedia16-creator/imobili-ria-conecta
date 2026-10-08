-- Suíte do "Virou venda" (migration 20261008190000). Roda DENTRO de transação revertida
-- (run-captacao-virou-venda.sh). Homologação: A = Única (00000000-…-0001), B = agencia-b-homolog.
-- Perfis: captador (UE Corretor), corretor da mesma equipe (QA A Corretor Um, posto na equipe só
-- aqui), gestor da equipe (UE Gestor), corretor de outra equipe (QA A Corretor Dois), admin (QA A
-- Admin) e admin da imobiliária B. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE paths(k text PRIMARY KEY, v text);
GRANT ALL ON r, ids, paths TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.pode(_k text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT public.exclusive_pode_virar_venda(pg_temp.id('c'), pg_temp.id(_k)) $$;
CREATE FUNCTION pg_temp.ndocs() RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.venda_documentos_captacao(pg_temp.id('v1')) $$;
CREATE FUNCTION pg_temp.nfiles() RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'exclusive-captures' AND name IN (SELECT v FROM paths) $$;
CREATE FUNCTION pg_temp.mapa() RETURNS TABLE(neg boolean, desde date, pode boolean) LANGUAGE sql AS
  $$ SELECT m.negociacao, m.negociacao_desde, m.pode_virar_venda FROM public.mapa_captacoes_v2() m WHERE m.id = pg_temp.id('c') $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('mesma', '5745cbff-22b6-4a28-a515-dd6706504b8b'), ('outra', 'ebffaded-075c-493f-89e2-1d3d62901dc4'),
  ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
INSERT INTO storage.buckets (id, name, public) VALUES ('exclusive-captures', 'exclusive-captures', false) ON CONFLICT (id) DO NOTHING;
UPDATE public.organization_modules SET enabled = true WHERE module = 'captacao_exclusiva' AND organization_id IN (:'org_a', :'org_b');
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
-- Corretor Um entra na equipe do captador (Equipe UE) só nesta transação.
DELETE FROM public.team_members WHERE membro_id = pg_temp.id('mesma');
INSERT INTO public.team_members (membro_id, team_id, organization_id, tipo)
  SELECT pg_temp.id('mesma'), team_id, organization_id, tipo FROM public.team_members WHERE membro_id = pg_temp.id('captador');

-- Captação aprovada do captador, com proprietários, imóvel e documentos.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'c', public.exclusive_create_unit(pg_temp.id('unit_a'));
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 20,
  geo_lat = -23.5, geo_lon = -47.45,
  form_data = form_data || jsonb_build_object(
    'imovel', jsonb_build_object('tipo_imovel', 'Casa em condomínio', 'endereco', 'Rua das Acácias, 412',
      'complemento', 'casa 7', 'bairro', 'Jardim Fictício', 'municipio', 'Sorocaba', 'estado', 'SP',
      'classificacao_fiscal_iptu', '12.34.567.0089', 'numero_matricula', '98.765',
      'cartorio_registro', '2º CRI Sorocaba', 'valor_imovel', 'R$ 870.000,00'),
    'proprietario_1', jsonb_build_object('nome_completo', 'Carlos Exemplo da Silva', 'cpf', '000.111.222-33',
      'rg', '11.111.111-1', 'estado_civil', 'Casado', 'email', 'carlos@exemplo.com', 'telefone_1', '(15) 90000-0001',
      'nacionalidade', 'brasileiro', 'endereco_completo', 'Rua Teste, 1 - Sorocaba/SP'),
    'proprietario_2', jsonb_build_object('nome_completo', 'Marina Exemplo da Silva', 'cpf', '000.444.555-66'))
  WHERE id = pg_temp.id('c');
INSERT INTO paths SELECT k, :'org_a' || '/' || pg_temp.id('c') || '/' || gen_random_uuid() || '.pdf'
  FROM unnest(ARRAY['rg1','cpf1','rg2','iptu','matricula','residencia','gerado','assinado']) k;
INSERT INTO storage.objects (bucket_id, name, metadata) SELECT 'exclusive-captures', v, '{"mimetype":"application/pdf"}' FROM paths;
INSERT INTO public.exclusive_documents (capture_id, kind, owner_index, storage_path, file_name, uploaded_by)
  SELECT pg_temp.id('c'), regexp_replace(k, '[0-9]$', ''), coalesce(nullif(regexp_replace(k, '\D', '', 'g'), '')::int, 0),
         v, k || '-ficticio.pdf', pg_temp.id('captador') FROM paths;
DELETE FROM paths WHERE k = 'gerado';  -- o "gerado" nunca vai para a venda (fora da contagem)

SET LOCAL ROLE authenticated;
-- 1) Quem vê o botão
SELECT pg_temp.as_user(pg_temp.id('captador')::text);  SELECT pg_temp.ok(pg_temp.pode('captador'), 'captador pode virar venda');
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);     SELECT pg_temp.ok(pg_temp.pode('mesma'), 'corretor da MESMA equipe pode');
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);    SELECT pg_temp.ok(pg_temp.pode('gestor'), 'gestor da equipe pode');
SELECT pg_temp.as_user(pg_temp.id('outra')::text);     SELECT pg_temp.ok(NOT pg_temp.pode('outra'), 'corretor de OUTRA equipe não pode');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_virar_venda(%L)', pg_temp.id('c'))) LIKE '42501%', 'outra equipe: RPC recusa (42501)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_venda_da_captacao(%L)', pg_temp.id('c'))) LIKE '42501%', 'outra equipe não consulta a venda da captação');
SELECT pg_temp.ok((SELECT NOT pode AND NOT neg FROM pg_temp.mapa()), 'mapa: outra equipe vê a captação sem botão');
SELECT pg_temp.as_user(pg_temp.id('admin')::text);     SELECT pg_temp.ok(NOT pg_temp.pode('admin'), 'admin fora da equipe não vê o botão');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_virar_venda(%L)', pg_temp.id('c'))) LIKE '42501%', 'admin fora da equipe: RPC recusa');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_virar_venda(%L)', pg_temp.id('c'))) LIKE '42501%', 'imobiliária B: RPC recusa');
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);
SELECT pg_temp.ok((SELECT pode AND NOT neg FROM pg_temp.mapa()), 'mapa: mesma equipe vê o botão');

-- 2) Corretor da mesma equipe vira a venda: rascunho preenchido, captador automático
INSERT INTO ids SELECT 'v1', (public.exclusive_virar_venda(pg_temp.id('c'))->'venda'->>'id')::uuid;
SELECT pg_temp.ok(pg_temp.id('v1') IS NOT NULL, 'venda criada');
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'rascunho' AND corretor_id = pg_temp.id('mesma') AND corretor_captador_id = pg_temp.id('captador')
  AND corretor_vendedor_id = pg_temp.id('mesma') AND lider_captador_id = pg_temp.id('gestor')
  AND valor_anunciado = 870000 AND imovel_logradouro = 'Rua das Acácias, 412' AND imovel_complemento = 'casa 7'
  AND imovel_bairro = 'Jardim Fictício' AND imovel_cidade = 'Sorocaba' AND imovel_uf = 'SP'
  AND matricula = '98.765 — 2º CRI Sorocaba' AND iptu = '12.34.567.0089'
  AND imovel_numero IS NULL AND imovel_cep IS NULL AND midia IS NULL AND valor_negociado IS NULL
  AND exclusive_capture_id = pg_temp.id('c') FROM public.sales WHERE id = pg_temp.id('v1')),
  'venda: imóvel/captador/líder preenchidos; número, CEP, Mídia e valor em branco');
SELECT pg_temp.ok((SELECT string_agg(papel || ':' || coalesce(nome, '-') || ':' || coalesce(cpf_cnpj, '-'), '|' ORDER BY papel)
  = 'comprador_1:-:-|vendedor_1:Carlos Exemplo da Silva:000.111.222-33|vendedor_2:Marina Exemplo da Silva:000.444.555-66'
  FROM public.sale_parties WHERE sale_id = pg_temp.id('v1')), 'partes: 2 proprietários + comprador em branco');
SELECT pg_temp.ok((SELECT profissao IS NULL AND regime_casamento IS NULL AND conjuge_nome IS NULL AND estado_civil = 'Casado'
  FROM public.sale_parties WHERE sale_id = pg_temp.id('v1') AND papel = 'vendedor_1'), 'profissão, regime e cônjuge em branco');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.sale_documents WHERE sale_id = pg_temp.id('v1')), 'nenhum arquivo copiado para a venda');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.exclusive_history WHERE capture_id = pg_temp.id('c') AND action = 'virou_venda'), 'histórico da captação: virou_venda');

-- 3) Idempotência: segundo clique / outra aba devolve a mesma venda
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok((SELECT (x->>'criada')::boolean = false AND (x->'venda'->>'id')::uuid = pg_temp.id('v1')
  FROM public.exclusive_virar_venda(pg_temp.id('c')) x), 'segundo clique (outro usuário) devolve a venda existente');
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);
SELECT pg_temp.ok((SELECT (x->>'criada')::boolean = false FROM public.exclusive_virar_venda(pg_temp.id('c')) x), 'mesmo usuário, duas abas: não cria outra');
SELECT pg_temp.ok((SELECT NOT pode FROM pg_temp.mapa()), 'com venda ativa, o mapa não oferece o botão');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.sales WHERE exclusive_capture_id = pg_temp.id('c')), 'uma única venda');
-- Banco bloqueia mesmo fora da RPC
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.sales (corretor_id, exclusive_capture_id, organization_id) VALUES (%L,%L,%L)',
  pg_temp.id('mesma'), pg_temp.id('c'), :'org_a')) LIKE '42501%', 'insert direto com vínculo é recusado');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT set_config('app.virou_venda','on',true); INSERT INTO public.sales (corretor_id, exclusive_capture_id, organization_id) VALUES (%L,%L,%L)$q$,
  pg_temp.id('mesma'), pg_temp.id('c'), :'org_a')) LIKE '23505%sales_captacao_ativa_key%', 'segunda venda ativa barrada pelo índice único');
SELECT set_config('app.virou_venda', 'off', true);
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.sales SET exclusive_capture_id = NULL WHERE id = %L', pg_temp.id('v1'))) LIKE '42501%', 'vínculo não pode ser alterado');

-- 4) Documentos herdados: só quem vê a venda; nunca o "gerado"
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);
SELECT pg_temp.ok(pg_temp.ndocs() = 7 AND pg_temp.nfiles() = 7, 'dono da venda vê 7 documentos e lê os 7 arquivos (sem o gerado)');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.venda_documentos_captacao(pg_temp.id('v1')) WHERE kind = 'gerado'), 'contrato "gerado" fica fora');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.exclusive_documents WHERE capture_id = pg_temp.id('c')), 'a ficha da captação continua fechada para ele');
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.ndocs() = 7, 'captador vê os documentos na venda');
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok(pg_temp.ndocs() = 0 AND pg_temp.nfiles() = 0, 'outra equipe: 0 documentos e 0 arquivos (URL do storage)');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(pg_temp.ndocs() = 0 AND pg_temp.nfiles() = 0, 'imobiliária B: 0 documentos e 0 arquivos');
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok(pg_temp.ndocs() = 7, 'admin vê (já via a venda)');

-- 5) Rascunho não muda a captação; enviada ao gestor -> Em negociação
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok((SELECT NOT neg FROM pg_temp.mapa()), 'rascunho: captação segue Ativa no mapa');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);
-- Regras atuais da venda continuam valendo: sem pagamento, o envio é barrado.
SELECT pg_temp.ok(pg_temp.err(format($q$UPDATE public.sales SET status = 'enviada_revisao' WHERE id = %L$q$, pg_temp.id('v1'))) LIKE '23514%',
  'regras atuais preservadas: venda incompleta não segue ao gestor');
-- O corretor completa o que falta (dados fictícios).
UPDATE public.sales SET imovel_numero = '412', midia = 'Placa', valor_negociado = 850000, data_assinatura = current_date,
  percentual_comissao = 6 WHERE id = pg_temp.id('v1');
INSERT INTO public.sale_payment (sale_id, tipo_pagamento, entrada_valor) VALUES (pg_temp.id('v1'), 'vista', 850000);
UPDATE public.sale_parties SET nome = 'Comprador Fictício', cpf_cnpj = '000.777.888-99'
  WHERE sale_id = pg_temp.id('v1') AND papel = 'comprador_1';
INSERT INTO paths SELECT 'envio_err', pg_temp.err(format($q$UPDATE public.sales SET status = 'enviada_revisao' WHERE id = %L$q$, pg_temp.id('v1')));
SELECT pg_temp.ok((SELECT v FROM paths WHERE k = 'envio_err') IS NULL,
  'dono envia ao gestor pelo fluxo normal (gatilhos atuais ativos) ' || coalesce((SELECT v FROM paths WHERE k = 'envio_err'), ''));
DELETE FROM paths WHERE k = 'envio_err';
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok((SELECT neg AND desde = (now() AT TIME ZONE 'America/Sao_Paulo')::date FROM pg_temp.mapa()), 'mapa: Em negociação desde hoje (pino laranja)');
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT x->'venda'->>'situacao' = 'em_negociacao' AND (x->>'pode_virar')::boolean
  FROM public.exclusive_venda_da_captacao(pg_temp.id('c')) x), 'tela da captação: Em negociação com link da venda');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.exclusive_situacao_venda_lista()
  WHERE capture_id = pg_temp.id('c') AND situacao = 'em_negociacao' AND negociacao_desde IS NOT NULL),
  'lista: captador vê o selo Em negociação');
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.exclusive_situacao_venda_lista() WHERE capture_id = pg_temp.id('c')),
  'lista: outra equipe (não vê a captação) não recebe a situação');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.exclusive_situacao_venda_lista() WHERE capture_id = pg_temp.id('c')),
  'lista: imobiliária B não recebe a situação');

-- 6) Contrato assinado -> Vendida (sai do mapa); arquivada -> volta a Ativa
RESET ROLE;
ALTER TABLE public.sales DISABLE TRIGGER USER;
ALTER TABLE public.sales ENABLE TRIGGER trg_sales_captacao_historico;
ALTER TABLE public.sales ENABLE TRIGGER trg_sales_proteger_vinculo_captacao;
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
UPDATE public.sales SET status = 'contrato_assinado' WHERE id = pg_temp.id('v1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM pg_temp.mapa()), 'Vendida: sai do mapa');
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT x->'venda'->>'situacao' = 'vendida' AND (x->'venda'->>'pode_abrir')::boolean
  FROM public.exclusive_venda_da_captacao(pg_temp.id('c')) x), 'tela da captação: Vendida com link (captador abre a venda)');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.exclusive_situacao_venda_lista()
  WHERE capture_id = pg_temp.id('c') AND situacao = 'vendida'), 'lista: selo Vendida');
RESET ROLE;
UPDATE public.sales SET status = 'arquivada' WHERE id = pg_temp.id('v1');
ALTER TABLE public.sales ENABLE TRIGGER USER;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok((SELECT NOT neg FROM pg_temp.mapa()), 'venda arquivada: captação volta a Ativa no mapa');
SELECT pg_temp.as_user(pg_temp.id('mesma')::text);
SELECT pg_temp.ok(pg_temp.ndocs() = 0 AND pg_temp.nfiles() = 0, 'venda arquivada: documentos herdados deixam de abrir');
SELECT pg_temp.ok(pg_temp.pode('mesma') AND (SELECT pode FROM pg_temp.mapa()), 'botão volta a funcionar');
INSERT INTO ids SELECT 'v2', (public.exclusive_virar_venda(pg_temp.id('c'))->'venda'->>'id')::uuid;
SELECT pg_temp.ok(pg_temp.id('v2') IS DISTINCT FROM pg_temp.id('v1') AND pg_temp.id('v2') IS NOT NULL, 'nova venda pode ser aberta');
RESET ROLE;
SELECT pg_temp.ok((SELECT string_agg(action, ',' ORDER BY id) = 'virou_venda,em_negociacao,vendida,venda_encerrada_captacao_ativa,virou_venda'
  FROM public.exclusive_history WHERE capture_id = pg_temp.id('c') AND action <> 'criada'), 'histórico completo da captação');
-- Captação não aprovada não vira venda
UPDATE public.exclusive_captures SET status = 'enviada' WHERE id = pg_temp.id('c');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(NOT pg_temp.pode('captador'), 'captação não aprovada: sem botão');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) || ' de ' || count(*) FROM r;
