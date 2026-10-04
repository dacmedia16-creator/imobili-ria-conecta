-- Suíte da migration 20261004230000 (roda no clone, com a migration aplicada).
-- Cria objetos de teste como postgres (mesmo papel das migrations) dentro de transação revertida.
-- Saída: linhas "ok ..." / "FALHA ..." e "TOTAL=<falhas>".
BEGIN;
SET LOCAL ROLE postgres;
CREATE TABLE public.zz_teste_defacl (id bigserial PRIMARY KEY, v text);
CREATE FUNCTION public.zz_teste_defacl_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
RESET ROLE;

CREATE TEMP TABLE r(ok bool, msg text);
INSERT INTO r VALUES
 (NOT has_table_privilege('anon','public.zz_teste_defacl','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'tabela nova: anon sem privilégio'),
 ((SELECT NOT EXISTS (SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid='public.zz_teste_defacl'::regclass)) a
                       WHERE a.grantee='anon'::regrole)), 'tabela nova: ACL sem entrada anon'),
 (has_table_privilege('authenticated','public.zz_teste_defacl','SELECT,INSERT,UPDATE,DELETE'),
  'tabela nova: authenticated mantém privilégios'),
 (has_table_privilege('service_role','public.zz_teste_defacl','SELECT,INSERT,UPDATE,DELETE'),
  'tabela nova: service_role mantém privilégios'),
 (NOT has_sequence_privilege('anon','public.zz_teste_defacl_id_seq','USAGE,SELECT,UPDATE'),
  'sequence nova: anon sem privilégio'),
 (has_sequence_privilege('authenticated','public.zz_teste_defacl_id_seq','USAGE'),
  'sequence nova: authenticated mantém USAGE'),
 (has_function_privilege('authenticated','public.zz_teste_defacl_fn()','EXECUTE'),
  'função nova: authenticated executa (inalterado)'),
 ((SELECT count(*) = 0 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m')
     AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')), 'tabelas existentes: anon sem acesso'),
 ((SELECT count(*) = 0 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='S'
     AND CASE WHEN c.relkind='S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') ELSE false END), 'sequences existentes: anon sem acesso'),
 ((SELECT count(*) = 2 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
     AND p.proname IN ('list_public_positioning_regions','list_public_specialists')
     AND has_function_privilege('anon', p.oid, 'EXECUTE')), 'RPCs públicas: anon executa'),
 ((SELECT public AND file_size_limit = 5242880 AND allowed_mime_types @> ARRAY['image/png','image/jpeg','image/webp']
          AND NOT ('image/svg+xml' = ANY(allowed_mime_types))
     FROM storage.buckets WHERE id='avatars'), 'avatars: público, 5 MB, sem SVG'),
 ((SELECT public AND file_size_limit = 1048576 FROM storage.buckets WHERE id='organization-logos'),
  'organization-logos: inalterado');

-- RPC pública realmente executa como anon
SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM * FROM public.list_public_specialists() LIMIT 1; PERFORM * FROM public.list_public_positioning_regions() LIMIT 1; END $$;
RESET ROLE;
INSERT INTO r VALUES (true, 'RPCs públicas: chamada real como anon sem erro');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) FROM r;
ROLLBACK;
