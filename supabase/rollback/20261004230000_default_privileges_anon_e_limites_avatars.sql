-- Rollback de 20261004230000_default_privileges_anon_e_limites_avatars.sql
-- Volta ao estado anterior: padrão de postgres em public concedendo ALL a anon em tabelas/sequences,
-- anon com ALL nas sequences existentes e bucket avatars sem limite de tamanho/tipo.
-- Depois de rodar, remover a linha 20261004230000 de supabase_migrations.schema_migrations.
BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;

UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL WHERE id = 'avatars';

COMMIT;
