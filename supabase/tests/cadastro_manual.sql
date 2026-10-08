-- Suíte funcional da migration 20261008160000 (cadastro manual de exclusividade já assinada).
-- Roda DENTRO de transação revertida (ver run-cadastro-manual.sh), depois do "up". Homologação:
-- A = Única (00000000-…-0001) e B = agencia-b-homolog (2a000000-…-00b0). Dados fictícios.
-- Saída: linhas "ok …" / "FALHA …" e "TOTAL=<falhas>".
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
-- Executa SQL e devolve a mensagem de erro (NULL = passou).
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
-- Objeto de Storage fictício (só metadados) no caminho exigido pela RPC.
CREATE FUNCTION pg_temp.obj(_org uuid, _cap uuid, _ext text, _mime text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _p text := _org::text || '/' || _cap::text || '/' || gen_random_uuid()::text || '.' || _ext;
BEGIN
  INSERT INTO storage.objects(bucket_id, name, metadata) VALUES ('exclusive-captures', _p, jsonb_build_object('mimetype', _mime));
  RETURN _p;
END $$;

SELECT '10000000-0000-4000-8000-000000000003' AS a_corretor, 'cab7391a-463f-4d97-b99b-ced6e4696796' AS a_gestor,
       '7dd997f7-2021-43ea-af9c-e758b826fcfd' AS a_admin, 'b3144521-7e3b-4f48-a1e0-29d90fd3f536' AS b_admin,
       '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO storage.buckets (id, name, public) VALUES ('exclusive-captures', 'exclusive-captures', false)
  ON CONFLICT (id) DO NOTHING;
UPDATE public.organization_modules SET enabled = true WHERE module = 'captacao_exclusiva'
  AND organization_id IN (:'org_a', :'org_b');
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
INSERT INTO public.exclusive_units (organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial, ativo)
  SELECT :'org_b', 'Unidade QA B', creci, razao_social, endereco, cidade, estado, cnpj, 'QA B', true
    FROM public.exclusive_units WHERE id = (SELECT v FROM ids WHERE k = 'unit_a')
  RETURNING id AS unit_b_id \gset
INSERT INTO ids VALUES ('unit_b', :'unit_b_id');

-- Estrutura
SELECT pg_temp.ok((SELECT column_default = 'false' AND is_nullable = 'NO' FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'exclusive_captures' AND column_name = 'manual'), 'coluna manual NOT NULL DEFAULT false');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.exclusive_create_manual(uuid)', 'EXECUTE'), 'anon não executa exclusive_create_manual');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.exclusive_captures WHERE manual), 'captações existentes continuam normais (manual=false)');

SET LOCAL ROLE authenticated;

-- 1) Corretor A cria o cadastro manual: captador = ele mesmo, status rascunho.
SELECT pg_temp.as_user(:'a_corretor');
INSERT INTO ids SELECT 'm1', public.exclusive_create_manual((SELECT v FROM ids WHERE k = 'unit_a'));
SELECT pg_temp.ok((SELECT manual AND status = 'rascunho' AND captor_id = :'a_corretor'::uuid AND created_by = :'a_corretor'::uuid
  FROM public.exclusive_captures WHERE id = (SELECT v FROM ids WHERE k = 'm1')), 'corretor cria manual: captador = logado, rascunho');
SELECT pg_temp.ok((SELECT form_data->'condicoes'->>'prazo_dias_numero' = '' FROM public.exclusive_captures
  WHERE id = (SELECT v FROM ids WHERE k = 'm1')), 'condições começam vazias (vêm do contrato)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_create_manual(%L)', (SELECT v FROM ids WHERE k = 'unit_b'))) = 'Unidade inválida',
  'corretor A não cria manual em unidade da imobiliária B');

-- 2) Enviar sem contrato é recusado; único obrigatório é o contrato.
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', (SELECT v FROM ids WHERE k = 'm1'), 'enviar'))
  = 'Anexe o contrato assinado antes de enviar', 'enviar sem contrato assinado é recusado');

-- 3) Corretor anexa o contrato assinado como FOTO (jpg). Normal recusaria.
RESET ROLE;
SELECT pg_temp.obj(:'org_a', (SELECT v FROM ids WHERE k = 'm1'), 'jpg', 'image/jpeg') AS foto \gset
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'a_corretor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_register_document(%L, %L, 0, %L, %L)',
  (SELECT v FROM ids WHERE k = 'm1'), 'assinado', :'foto', 'contrato-foto.jpg')) IS NULL, 'corretor anexa contrato assinado (foto) no manual');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.exclusive_documents WHERE capture_id = (SELECT v FROM ids WHERE k = 'm1') AND kind = 'assinado'),
  'corretor enxerga o contrato que anexou (policy exclusive_documents_read)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', (SELECT v FROM ids WHERE k = 'm1'), 'assinatura'))
  IS NOT NULL, 'ação "assinatura" (Clicksign) não se aplica ao manual');

-- 4) Corretor confere: grava data de assinatura do contrato (anterior à criação) e envia sem outros documentos.
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_save(%L, %L::jsonb, %L, %L)', (SELECT v FROM ids WHERE k = 'm1'),
  '{"proprietario_1":{"nome_completo":"Maria Ficticia QA"},"imovel":{"endereco":"Rua Manual QA, 77","bairro":"Campolim","municipio":"Sorocaba","estado":"São Paulo"},"condicoes":{"prazo_dias_numero":"180"},"data_assinatura":"2026-06-02"}',
  '', '')) IS NULL, 'corretor salva a conferência');
-- Plano de Marketing: a regra (ao menos 1 ação) é validada na TELA, igual à captação normal, cujo
-- exclusive_transition também não olha form_data->dossie. Aqui só se confirma a paridade com a normal
-- e que a seleção salva chega ao gestor.
SELECT pg_temp.ok(position('dossie' IN pg_get_functiondef('public.exclusive_transition(uuid,text,text)'::regprocedure)) = 0,
  'Plano de Marketing: banco não valida em nenhum fluxo (paridade com a captação normal; bloqueio na tela)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_save(%L, %L::jsonb, %L, %L)', (SELECT v FROM ids WHERE k = 'm1'),
  '{"proprietario_1":{"nome_completo":"Maria Ficticia QA"},"imovel":{"endereco":"Rua Manual QA, 77","bairro":"Campolim","municipio":"Sorocaba","estado":"São Paulo"},"condicoes":{"prazo_dias_numero":"180"},"data_assinatura":"2026-06-02","dossie":["acao-qa-1","acao-qa-2"]}',
  '', '')) IS NULL AND (SELECT form_data->'dossie' = '["acao-qa-1","acao-qa-2"]'::jsonb FROM public.exclusive_captures
  WHERE id = (SELECT v FROM ids WHERE k = 'm1')), 'Plano de Marketing marcado no manual fica salvo para o gestor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', (SELECT v FROM ids WHERE k = 'm1'), 'enviar')) IS NULL,
  'enviar ao gestor com contrato + Plano de Marketing (sem RG/CPF/IPTU/matrícula)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', (SELECT v FROM ids WHERE k = 'm1'), 'aprovar')) IS NOT NULL,
  'corretor NÃO aprova o próprio cadastro manual');

-- 5) Antes da aprovação NÃO conta como assinada: fora do mapa.
SELECT pg_temp.as_user(:'a_admin');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.mapa_captacoes() m WHERE m.id = (SELECT v FROM ids WHERE k = 'm1')),
  'enviada (não aprovada) fica fora do mapa');

-- 6) Imobiliária B não vê nem mexe.
SELECT pg_temp.as_user(:'b_admin');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.exclusive_captures WHERE id = (SELECT v FROM ids WHERE k = 'm1')), 'B não vê a captação manual de A');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.exclusive_documents WHERE capture_id = (SELECT v FROM ids WHERE k = 'm1')), 'B não vê o contrato de A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', (SELECT v FROM ids WHERE k = 'm1'), 'aprovar')) IS NOT NULL,
  'admin de B não aprova captação de A');

-- 7) Gestor/ADM de A aprova: status aprovada + signed_on = data do contrato.
SELECT pg_temp.as_user(:'a_admin');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', (SELECT v FROM ids WHERE k = 'm1'), 'aprovar')) IS NULL,
  'ADM da imobiliária aprova o cadastro manual');
SELECT pg_temp.ok((SELECT status = 'aprovada' AND signed_on = date '2026-06-02' FROM public.exclusive_captures
  WHERE id = (SELECT v FROM ids WHERE k = 'm1')), 'aprovada com signed_on = data escrita no contrato (02/06/2026)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', (SELECT v FROM ids WHERE k = 'm1'), '2026-05-30')) IS NULL,
  'gestor corrige a data para antes da criação (contrato antigo)');

-- 8) Entra no mapa do PR #41 (mesmo critério), sem dado do proprietário.
RESET ROLE;
UPDATE public.exclusive_captures SET geo_lat = -23.51, geo_lon = -47.46, geo_key = 'qa' WHERE id = (SELECT v FROM ids WHERE k = 'm1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'a_corretor');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.mapa_captacoes() m WHERE m.id = (SELECT v FROM ids WHERE k = 'm1')),
  'aprovada entra no mapa_captacoes() sem mudar a função');
SELECT pg_temp.ok((SELECT bool_and(to_jsonb(m)::text NOT LIKE '%Maria Ficticia%') FROM public.mapa_captacoes() m),
  'mapa não traz o nome do proprietário');
SELECT pg_temp.as_user(:'b_admin');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.mapa_captacoes() m WHERE m.id = (SELECT v FROM ids WHERE k = 'm1')),
  'B não vê a captação manual de A no mapa');

-- 9) Devolver mantém o contrato de papel; manual não aceita "gerado".
SELECT pg_temp.as_user(:'a_corretor');
INSERT INTO ids SELECT 'm2', public.exclusive_create_manual((SELECT v FROM ids WHERE k = 'unit_a'));
RESET ROLE;
SELECT pg_temp.obj(:'org_a', (SELECT v FROM ids WHERE k = 'm2'), 'pdf', 'application/pdf') AS pdf2 \gset
SELECT pg_temp.obj(:'org_a', (SELECT v FROM ids WHERE k = 'm2'), 'pdf', 'application/pdf') AS ger2 \gset
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'a_corretor');
SELECT public.exclusive_register_document((SELECT v FROM ids WHERE k = 'm2'), 'assinado', 0, :'pdf2', 'contrato.pdf');
SELECT public.exclusive_transition((SELECT v FROM ids WHERE k = 'm2'), 'enviar');
SELECT pg_temp.as_user(:'a_admin');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_register_document(%L, %L, 0, %L, %L)',
  (SELECT v FROM ids WHERE k = 'm2'), 'gerado', :'ger2', 'gerado.pdf')) IS NOT NULL, 'manual não aceita contrato "gerado"');
SELECT public.exclusive_transition((SELECT v FROM ids WHERE k = 'm2'), 'devolver', 'Conferir endereço');
SELECT pg_temp.ok((SELECT status = 'devolvida' FROM public.exclusive_captures WHERE id = (SELECT v FROM ids WHERE k = 'm2'))
  AND (SELECT count(*) = 1 FROM public.exclusive_documents WHERE capture_id = (SELECT v FROM ids WHERE k = 'm2') AND kind = 'assinado'),
  'devolver mantém o contrato assinado do manual');
SELECT pg_temp.as_user(:'a_corretor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_archive(%L, %L)', (SELECT v FROM ids WHERE k = 'm2'), 'arquivar')) IS NULL,
  'devolvida manual pode ser arquivada');

-- 10) Rascunho manual com contrato anexado ainda pode ser excluído.
INSERT INTO ids SELECT 'm3', public.exclusive_create_manual((SELECT v FROM ids WHERE k = 'unit_a'));
RESET ROLE;
SELECT pg_temp.obj(:'org_a', (SELECT v FROM ids WHERE k = 'm3'), 'png', 'image/png') AS foto3 \gset
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'a_corretor');
SELECT public.exclusive_register_document((SELECT v FROM ids WHERE k = 'm3'), 'assinado', 0, :'foto3', 'contrato.png');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_archive(%L, %L)', (SELECT v FROM ids WHERE k = 'm3'), 'excluir')) IS NULL,
  'rascunho manual com contrato anexado pode ser excluído');

-- 11) Regressão: captação NORMAL segue igual.
INSERT INTO ids SELECT 'n1', public.exclusive_create_unit((SELECT v FROM ids WHERE k = 'unit_a'));
SELECT pg_temp.ok((SELECT NOT manual FROM public.exclusive_captures WHERE id = (SELECT v FROM ids WHERE k = 'n1')), 'captação normal nasce manual=false');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', (SELECT v FROM ids WHERE k = 'n1'), 'enviar'))
  = 'Preencha todos os campos obrigatórios antes do envio', 'normal continua exigindo todos os campos para enviar');
RESET ROLE;
SELECT pg_temp.obj(:'org_a', (SELECT v FROM ids WHERE k = 'n1'), 'jpg', 'image/jpeg') AS foton \gset
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'a_corretor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_register_document(%L, %L, 0, %L, %L)',
  (SELECT v FROM ids WHERE k = 'n1'), 'assinado', :'foton', 'x.jpg')) = 'Apenas gestor pode anexar contrato assinado',
  'normal: corretor continua sem poder anexar contrato assinado');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) || ' de ' || count(*) FROM r;
