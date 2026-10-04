-- Segurança: tabelas novas nascem fechadas para anon + limites no bucket avatars.
--
-- 1) Privilégios padrão (default privileges) do papel postgres no schema public.
--    Antes: toda tabela/sequence nova criada por postgres (dono de todas as 67 tabelas de public;
--    é o papel usado pelas migrations) recebia GRANT ALL para anon automaticamente — foi assim que
--    as 30 tabelas de negócio ficaram abertas até 20261004220000.
--    Agora: tabelas e sequences novas NÃO recebem nada para anon. authenticated e service_role
--    continuam recebendo como antes (o RLS de cada tabela segue valendo).
--    Funções: NÃO mexemos. O Postgres concede EXECUTE a PUBLIC em toda função nova, então revogar
--    só de anon não teria efeito; e as RPCs públicas (/especialistas) dependem desse EXECUTE.
--    supabase_admin: o papel postgres não pode alterar os padrões dele (não é membro) e ele não é
--    dono de nenhuma tabela de public; fica como está.
--    As 6 sequences existentes também perdem os privilégios de anon (anon não insere em nenhuma tabela).
--
-- 2) Bucket avatars continua PÚBLICO (a página pública /especialistas exibe as fotos pelo link
--    público gravado em profiles.avatar_url). Listagem/enumeração por anon já é negada (não há
--    política SELECT para anon em storage.objects). Aqui só limitamos o que pode ser enviado:
--    até 5 MB (mesmo limite da tela Meu acesso) e apenas PNG/JPEG/WebP/GIF — bloqueia SVG/HTML
--    servidos a partir de um bucket público. Os 51 arquivos atuais (png/jpeg/webp, maior 4,2 MB) cabem.
--
-- Rollback: supabase/rollback/20261004230000_default_privileges_anon_e_limites_avatars.sql
BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

UPDATE storage.buckets
   SET file_size_limit = 5242880,
       allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/gif']
 WHERE id = 'avatars';

-- Travas: o padrão de postgres em public não pode mais citar anon; nenhuma tabela/sequence legível por anon;
-- RPCs públicas seguem executáveis; avatars segue público com os limites.
DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM pg_default_acl d, aclexplode(d.defaclacl) a
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
     AND d.defaclobjtype IN ('r','S') AND a.grantee = 'anon'::regrole;
  IF _n > 0 THEN RAISE EXCEPTION 'default privileges ainda concedem a anon (%)', _n; END IF;

  SELECT count(*) INTO _n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m')
     AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE');
  IF _n > 0 THEN RAISE EXCEPTION 'anon ainda acessa % tabela(s) de public', _n; END IF;

  SELECT count(*) INTO _n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
     AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') ELSE false END;
  IF _n > 0 THEN RAISE EXCEPTION 'anon ainda usa % sequence(s) de public', _n; END IF;

  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('list_public_positioning_regions','list_public_specialists')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF _n <> 2 THEN RAISE EXCEPTION 'RPCs publicas de /especialistas perderam EXECUTE para anon (%)', _n; END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars' AND public AND file_size_limit = 5242880) THEN
    RAISE EXCEPTION 'bucket avatars fora do esperado';
  END IF;
END $$;

COMMIT;
