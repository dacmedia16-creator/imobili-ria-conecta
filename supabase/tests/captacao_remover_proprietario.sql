-- Suíte de exclusive_remove_owner (migration 20261230120000, t_b3a9ed4f). Roda DENTRO de transação
-- revertida (run-captacao-remover-proprietario.sh). Cria uma imobiliária, um corretor e captações
-- fictícias só dentro da transação; nada fica gravado.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;

SELECT 'b3a90000-0000-4000-8000-0000000000a1' AS org, 'b3a90000-0000-4000-8000-0000000000c1' AS uid,
       'b3a90000-0000-4000-8000-0000000000d1' AS cap, 'b3a90000-0000-4000-8000-0000000000d2' AS cap2 \gset
INSERT INTO public.organizations (id, slug, nome) VALUES (:'org', 'teste-b3a9', 'Imobiliária Fictícia B3A9');
INSERT INTO auth.users (id, email) VALUES (:'uid', 'corretor.ficticio.b3a9@example.com');
INSERT INTO public.profiles (id, nome, organization_id) VALUES (:'uid', 'Corretor Fictício', :'org')
  ON CONFLICT (id) DO UPDATE SET organization_id = excluded.organization_id, ativo = true;
INSERT INTO public.organization_members (organization_id, user_id) VALUES (:'org', :'uid')
  ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (:'uid', 'corretor', :'org')
  ON CONFLICT DO NOTHING;
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (:'org', 'captacao_exclusiva', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
-- 4 proprietários: P1..P4. Documentos: P1 cnh, P2 cnh+residência, P3 rg+cpf, P4 cnh; imóvel: matrícula; PDF gerado.
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, organization_id, form_data, status)
VALUES (:'cap', :'uid', :'uid', 'campolim', :'org', jsonb_build_object(
  'proprietario_1', jsonb_build_object('nome_completo', 'P1'),
  'proprietario_2', jsonb_build_object('nome_completo', 'P2'),
  'proprietarios_extras', jsonb_build_array(jsonb_build_object('nome_completo', 'P3'), jsonb_build_object('nome_completo', 'P4')),
  'imovel', jsonb_build_object('endereco', 'Rua Fictícia')), 'rascunho'),
  (:'cap2', :'uid', :'uid', 'campolim', :'org', jsonb_build_object(
  'proprietario_1', jsonb_build_object('nome_completo', 'Q1'),
  'proprietario_2', jsonb_build_object('nome_completo', 'Q2'),
  'proprietarios_extras', jsonb_build_array(jsonb_build_object('nome_completo', 'Q3'))), 'enviada');
INSERT INTO public.exclusive_documents (capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id)
SELECT :'cap', k, o, 'x/b3a9-' || k || '-' || o || '.pdf', k || '-' || o || '.pdf', :'uid', :'org'
  FROM (VALUES ('cnh',1),('cnh',2),('residencia',2),('rg',3),('cpf',3),('cnh',4),('matricula',0),('gerado',0)) v(k, o);
INSERT INTO public.exclusive_documents (capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id)
VALUES (:'cap2', 'cnh', 2, 'x/b3a9-q-cnh-2.pdf', 'q.pdf', :'uid', :'org');

-- Como o corretor (JWT authenticated).
SELECT set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', :'uid', true);
SET LOCAL ROLE authenticated;

SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_remove_owner(%L, 1, 4)', :'cap')) LIKE '%1º proprietário%',
  'não remove o 1º');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_remove_owner(%L, 2, 3)', :'cap')) LIKE '%mudou%',
  'total diferente do gravado é recusado (tela desatualizada)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_remove_owner(%L, 2, 3)', :'cap2')) LIKE '%não autorizada%',
  'captação enviada continua travada (regra de status não foi ampliada)');

CREATE TEMP TABLE out_paths AS SELECT public.exclusive_remove_owner(:'cap', 2, 4) AS p;
RESET ROLE;

SELECT pg_temp.ok((SELECT p FROM out_paths) @> ARRAY['x/b3a9-cnh-2.pdf','x/b3a9-residencia-2.pdf','x/b3a9-gerado-0.pdf']
  AND cardinality((SELECT p FROM out_paths)) = 3, 'devolve os arquivos do 2º e do PDF gerado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id = :'cap' AND storage_path LIKE '%-2.pdf'),
  'documentos do 2º saíram');
SELECT pg_temp.ok((SELECT string_agg(storage_path || '=' || owner_index, ',' ORDER BY storage_path)
  FROM public.exclusive_documents WHERE capture_id = :'cap') =
  'x/b3a9-cnh-1.pdf=1,x/b3a9-cnh-4.pdf=3,x/b3a9-cpf-3.pdf=2,x/b3a9-matricula-0.pdf=0,x/b3a9-rg-3.pdf=2',
  'seguintes renumerados (3→2, 4→3) com o mesmo arquivo; imóvel e 1º iguais');
SELECT pg_temp.ok((SELECT form_data->'proprietario_2'->>'nome_completo' = 'P3'
    AND jsonb_array_length(form_data->'proprietarios_extras') = 1
    AND form_data->'proprietarios_extras'->0->>'nome_completo' = 'P4'
    AND form_data->'imovel'->>'endereco' = 'Rua Fictícia'
  FROM public.exclusive_captures WHERE id = :'cap'), 'formulário: P1, P3, P4 (resto do form intacto)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.exclusive_history WHERE capture_id = :'cap'
  AND action = 'proprietario_removido' AND detail = 'proprietario:2 de 4'), 'histórico gravado');

-- Remover até sobrar 1: 3 de 3 (último) e depois 2 de 2.
SET LOCAL ROLE authenticated;
SELECT public.exclusive_remove_owner(:'cap', 3, 3);
SELECT public.exclusive_remove_owner(:'cap', 2, 2);
RESET ROLE;
SELECT pg_temp.ok((SELECT NOT (form_data ? 'proprietario_2') AND NOT (form_data ? 'proprietarios_extras')
  AND form_data->'proprietario_1'->>'nome_completo' = 'P1' FROM public.exclusive_captures WHERE id = :'cap'),
  'sobrou só o 1º, sem proprietario_2/extras');
SELECT pg_temp.ok((SELECT string_agg(storage_path || '=' || owner_index, ',' ORDER BY storage_path)
  FROM public.exclusive_documents WHERE capture_id = :'cap') = 'x/b3a9-cnh-1.pdf=1,x/b3a9-matricula-0.pdf=0',
  'só documentos do 1º e do imóvel');

SELECT (CASE WHEN ok THEN 'OK   ' ELSE 'FALHA ' END) || msg FROM r;
SELECT 'RESUMO ' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
