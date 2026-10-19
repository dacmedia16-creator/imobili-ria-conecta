-- Suíte da migration 20261019200000 (comprovante de residência por proprietário, t_8e496afb).
-- Roda DENTRO de transação revertida (run-captacao-residencia-proprietario.sh), depois da migration.
-- Homologação: A = Agência A (…-0001); captador = UE Corretor. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
-- Objeto no storage (como o upload faria) e registro pela RPC, como o usuário logado.
-- SECURITY DEFINER: o arquivo de teste é criado como admin (o upload real passa pela policy do storage).
CREATE FUNCTION pg_temp.obj(_cap uuid, _org uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _p text := _org::text || '/' || _cap::text || '/' || gen_random_uuid()::text || '.pdf';
BEGIN
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('exclusive-captures', _p, '{"mimetype":"application/pdf"}');
  RETURN _p;
END $$;
CREATE FUNCTION pg_temp.reg(_kind text, _owner int) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.err(format('SELECT public.exclusive_register_document(%L, %L, %s, %L, %L)',
    pg_temp.id('cap'), _kind, _owner, pg_temp.obj(pg_temp.id('cap'), pg_temp.id('org')), _kind || '.pdf')) $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('org', :'org_a');
UPDATE public.organization_modules SET enabled = true
 WHERE module IN ('captacao_exclusiva', 'feedback_proprietario') AND organization_id = :'org_a';
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
SELECT pg_temp.ok((SELECT count(*) FROM ids WHERE k = 'unit_a') = 1, 'pré: unidade na homologação');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'cap', public.exclusive_create_unit(pg_temp.id('unit_a'));
SELECT pg_temp.ok(pg_temp.reg('residencia', 1) IS NULL, 'aceita comprovante do proprietário 1');
SELECT pg_temp.ok(pg_temp.reg('residencia', 2) IS NULL, 'aceita comprovante do proprietário 2');
SELECT pg_temp.ok(pg_temp.reg('residencia', 0) IS NULL, 'comprovante do imóvel (0) continua aceito');
SELECT pg_temp.ok(pg_temp.reg('residencia', 3) LIKE '%Documento inválido%', 'recusa proprietário 3');
SELECT pg_temp.ok(pg_temp.reg('iptu', 1) LIKE '%Documento inválido%', 'IPTU continua só no imóvel');
SELECT pg_temp.ok(pg_temp.reg('matricula', 2) LIKE '%Documento inválido%', 'matrícula continua só no imóvel');
SELECT pg_temp.ok(pg_temp.reg('rg', 0) LIKE '%Documento inválido%', 'RG continua só no proprietário');
SELECT pg_temp.ok(pg_temp.reg('cnh', 1) IS NULL, 'CNH do proprietário 1 continua aceita');
-- Substituir o comprovante do proprietário 1 atualiza a mesma linha (não duplica).
SELECT pg_temp.ok(pg_temp.reg('residencia', 1) IS NULL, 'substitui comprovante do proprietário 1');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_documents WHERE capture_id = pg_temp.id('cap') AND kind = 'residencia') = 3,
  '3 comprovantes (imóvel, prop. 1, prop. 2), sem duplicar');
SELECT pg_temp.ok((SELECT string_agg(detail, ',' ORDER BY id) FROM public.exclusive_history
  WHERE capture_id = pg_temp.id('cap') AND action = 'documento_anexado') LIKE 'residencia:1,residencia:2,residencia:0,cnh:1,residencia:1',
  'histórico registra o proprietário de cada comprovante');
-- CHECK da tabela (escrita direta, por exemplo pelo servidor).
SELECT pg_temp.ok(pg_temp.err(format($q$INSERT INTO public.exclusive_documents (capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id)
  VALUES (%L, 'iptu', 1, 'x/' || gen_random_uuid() || '.pdf', 'x.pdf', %L, %L)$q$, pg_temp.id('cap'), pg_temp.id('captador'), pg_temp.id('org'))) LIKE '23514%',
  'CHECK recusa IPTU com proprietário');
-- 'enviar' não exige o comprovante: a função de transição não foi alterada pela migration.
SELECT pg_temp.ok(position('residencia' in (SELECT prosrc FROM pg_proc WHERE proname = 'exclusive_transition')) = 0,
  'exclusive_transition não cita comprovante de residência (continua opcional)');
-- Guarda do rollback: com comprovante de proprietário gravado, o rollback recusa e nada muda.
SELECT pg_temp.ok(pg_temp.err($q$DO $d$ BEGIN
  IF EXISTS (SELECT 1 FROM public.exclusive_documents WHERE kind = 'residencia' AND owner_index <> 0)
  THEN RAISE EXCEPTION 'Há comprovantes de residência de proprietário; trate-os antes do rollback'; END IF;
END $d$$q$) LIKE '%trate-os antes do rollback%', 'rollback trava se houver comprovante de proprietário');

SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || msg FROM r;
SELECT 'TOTAL ' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
