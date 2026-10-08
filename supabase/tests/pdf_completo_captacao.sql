-- Suíte de permissões dos PDFs da captação normal (t_3f434408). Sem migration nova: confere que as regras
-- atuais já sustentam o fluxo. Roda DENTRO de transação revertida (run-pdf-completo-captacao.sh).
-- Homologação: A = Única (00000000-…-0001) e B = agencia-b-homolog (2a000000-…-00b0). Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE paths(k text PRIMARY KEY, v text);
GRANT ALL ON r, ids, paths TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.obj(_org uuid, _cap uuid, _ext text, _mime text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _p text := _org::text || '/' || _cap::text || '/' || gen_random_uuid()::text || '.' || _ext;
BEGIN
  INSERT INTO storage.objects(bucket_id, name, metadata) VALUES ('exclusive-captures', _p, jsonb_build_object('mimetype', _mime));
  RETURN _p;
END $$;
-- Quantos documentos (por tipo) o usuário atual enxerga, e quantos arquivos do Storage.
CREATE FUNCTION pg_temp.kinds(_cap uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(kind, ',' ORDER BY kind), '') FROM public.exclusive_documents WHERE capture_id = _cap $$;
CREATE FUNCTION pg_temp.files(_cap uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'exclusive-captures' AND name LIKE '%/' || _cap::text || '/%' $$;

SELECT '10000000-0000-4000-8000-000000000003' AS a_corretor, '7dd997f7-2021-43ea-af9c-e758b826fcfd' AS a_admin,
       'b3144521-7e3b-4f48-a1e0-29d90fd3f536' AS b_admin,
       '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO storage.buckets (id, name, public) VALUES ('exclusive-captures', 'exclusive-captures', false) ON CONFLICT (id) DO NOTHING;
UPDATE public.organization_modules SET enabled = true WHERE module = 'captacao_exclusiva' AND organization_id IN (:'org_a', :'org_b');
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
-- Outro corretor ativo da imobiliária A (não é o captador nem líder dele).
INSERT INTO ids SELECT 'outro', p.id FROM public.profiles p
  WHERE p.ativo AND p.id <> :'a_corretor'::uuid AND p.organization_id = :'org_a'
    AND public.has_any_role(p.id, ARRAY['corretor']::public.app_role[])
    AND NOT public.has_any_role(p.id, ARRAY['gestor','team_leader','admin','super_admin']::public.app_role[])
  ORDER BY p.id LIMIT 1;

SET LOCAL ROLE authenticated;
-- 1) Corretor cria a captação NORMAL e anexa RG, CPF, IPTU e matrícula.
SELECT pg_temp.as_user(:'a_corretor');
INSERT INTO ids SELECT 'c', public.exclusive_create_unit((SELECT v FROM ids WHERE k = 'unit_a'));
RESET ROLE;
INSERT INTO paths SELECT k, pg_temp.obj(:'org_a', (SELECT v FROM ids WHERE k = 'c'), 'pdf', 'application/pdf')
  FROM unnest(ARRAY['rg','cpf','iptu','matricula','gerado','assinado']) k;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'a_corretor');
SELECT public.exclusive_register_document((SELECT v FROM ids WHERE k = 'c'), k, CASE WHEN k IN ('rg','cpf') THEN 1 ELSE 0 END,
  (SELECT v FROM paths p WHERE p.k = x.k), k || '-ficticio.pdf') FROM (VALUES ('rg'),('cpf'),('iptu'),('matricula')) x(k);
SELECT pg_temp.ok(pg_temp.kinds((SELECT v FROM ids WHERE k = 'c')) = 'cpf,iptu,matricula,rg', 'corretor anexou RG, CPF, IPTU e matrícula');

-- 2) Envio ao gestor (os campos obrigatórios já têm suíte própria; aqui o status é posto direto).
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'enviada' WHERE id = (SELECT v FROM ids WHERE k = 'c');
SET LOCAL ROLE authenticated;

-- 3) Gestor/ADM gera o PDF para assinatura ("gerado"); corretor não pode gerar.
SELECT pg_temp.as_user(:'a_corretor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_register_document(%L,%L,0,%L,%L)', (SELECT v FROM ids WHERE k = 'c'),
  'gerado', (SELECT v FROM paths WHERE k = 'gerado'), 'contrato.pdf')) IS NOT NULL, 'corretor NÃO gera o PDF para assinatura');
SELECT pg_temp.as_user(:'a_admin');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_register_document(%L,%L,0,%L,%L)', (SELECT v FROM ids WHERE k = 'c'),
  'gerado', (SELECT v FROM paths WHERE k = 'gerado'), 'contrato-exclusividade.pdf')) IS NULL, 'ADM gera e salva o PDF para assinatura');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L,%L)', (SELECT v FROM ids WHERE k = 'c'), 'assinatura')) IS NULL,
  'gestor registra envio ao Clicksign (externo)');

-- 4) Antes da aprovação o corretor NÃO vê o contrato (regra atual mantida).
SELECT pg_temp.as_user(:'a_corretor');
SELECT pg_temp.ok(pg_temp.kinds((SELECT v FROM ids WHERE k = 'c')) = 'cpf,iptu,matricula,rg', 'antes de aprovar, corretor não vê o contrato');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_register_document(%L,%L,0,%L,%L)', (SELECT v FROM ids WHERE k = 'c'),
  'assinado', (SELECT v FROM paths WHERE k = 'assinado'), 'assinado.pdf')) IS NOT NULL, 'corretor NÃO sobe o contrato assinado');

-- 5) Gestor/ADM sobe o assinado e aprova: aprovada + signed_on.
SELECT pg_temp.as_user(:'a_admin');
SELECT public.exclusive_register_document((SELECT v FROM ids WHERE k = 'c'), 'assinado', 0, (SELECT v FROM paths WHERE k = 'assinado'), 'contrato-assinado.pdf');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L,%L)', (SELECT v FROM ids WHERE k = 'c'), 'aprovar')) IS NULL, 'ADM aprova');
SELECT pg_temp.ok((SELECT status = 'aprovada' AND signed_on IS NOT NULL FROM public.exclusive_captures WHERE id = (SELECT v FROM ids WHERE k = 'c')),
  'captação aprovada com signed_on (critério do mapa)');
SELECT pg_temp.ok(pg_temp.kinds((SELECT v FROM ids WHERE k = 'c')) = 'assinado,cpf,gerado,iptu,matricula,rg', 'ADM vê tudo (PDF completo)');
SELECT pg_temp.ok(pg_temp.files((SELECT v FROM ids WHERE k = 'c')) = 6, 'ADM lê os 6 arquivos no Storage');

-- 6) Corretor (captador) volta a ver: contrato assinado + todos os documentos → pode gerar o PDF completo.
SELECT pg_temp.as_user(:'a_corretor');
SELECT pg_temp.ok(pg_temp.kinds((SELECT v FROM ids WHERE k = 'c')) LIKE 'assinado,cpf,%iptu,matricula,rg', 'captador vê o contrato assinado + documentos');
SELECT pg_temp.ok(pg_temp.files((SELECT v FROM ids WHERE k = 'c')) = 6, 'captador lê os arquivos no Storage (URL assinada)');

-- 7) Corretor de OUTRA equipe e imobiliária B não veem nada (nem arquivo).
SELECT CASE WHEN (SELECT v FROM ids WHERE k = 'outro') IS NULL THEN '00000000-0000-0000-0000-000000000000' ELSE (SELECT v::text FROM ids WHERE k = 'outro') END AS outro \gset
SELECT pg_temp.as_user(:'outro');
SELECT pg_temp.ok((SELECT v FROM ids WHERE k = 'outro') IS NOT NULL AND pg_temp.kinds((SELECT v FROM ids WHERE k = 'c')) = ''
  AND pg_temp.files((SELECT v FROM ids WHERE k = 'c')) = 0, 'outro corretor da mesma imobiliária não vê documentos nem arquivos');
SELECT pg_temp.as_user(:'b_admin');
SELECT pg_temp.ok(pg_temp.kinds((SELECT v FROM ids WHERE k = 'c')) = '' AND pg_temp.files((SELECT v FROM ids WHERE k = 'c')) = 0
  AND (SELECT count(*) = 0 FROM public.exclusive_captures WHERE id = (SELECT v FROM ids WHERE k = 'c')),
  'ADM da imobiliária B não vê captação, documentos nem arquivos de A');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) || ' de ' || count(*) FROM r;
