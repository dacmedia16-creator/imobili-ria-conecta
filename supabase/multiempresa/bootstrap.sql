-- Ajustes mínimos para rodar as migrations do ADM num supabase/postgres local descartável.
-- Não usar em banco remoto.
-- auth.uid()/auth.jwt() aceitando o formato novo (request.jwt.claims) e o antigo (request.jwt.claim.sub).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;
-- A imagem sem storage-api traz storage mínimo; completa colunas/funções usadas pelas migrations.
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS public boolean DEFAULT false;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit bigint;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types text[];
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS path_tokens text[]
  GENERATED ALWAYS AS (string_to_array(name, '/')) STORED;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects, storage.buckets TO authenticated, service_role;
GRANT SELECT ON storage.objects, storage.buckets TO anon;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
