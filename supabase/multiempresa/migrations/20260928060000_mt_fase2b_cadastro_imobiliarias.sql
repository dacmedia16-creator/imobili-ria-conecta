-- ADM MAX multiempresa — Fase 2b (homologação). NÃO aplicar em produção sem aprovação de Denis.
-- Arquivo fora de supabase/migrations para não entrar em `db push`.
-- 1. Cadastro de imobiliárias pela plataforma: CNPJ, cores e logo em organizations; RPC de dados
--    cadastrais exclusiva do super-admin da plataforma (mesmo padrão de platform_update_organization).
-- 2. Bucket público `organization-logos` (marca da agência; escrita só pelo servidor com service_role,
--    depois de conferir o super-admin da plataforma; sem policy para usuários).
-- 3. `mt_2b_org_auth_users(_org)`: último acesso/e-mail só dos usuários de UMA agência, para o
--    servidor não paginar o auth.users global (listUsers). EXECUTE só para service_role.
-- Rollback: 20260928060000_mt_fase2b_cadastro_imobiliarias.down.sql
BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN cnpj text CHECK (cnpj ~ '^[0-9]{14}$'),
  ADD COLUMN cor_primaria text CHECK (cor_primaria ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN cor_secundaria text CHECK (cor_secundaria ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN logo_path text CHECK (logo_path IS NULL OR split_part(logo_path, '/', 1) = id::text);
CREATE UNIQUE INDEX organizations_cnpj_unique ON public.organizations (cnpj) WHERE cnpj IS NOT NULL;

-- Dados cadastrais: só o super-admin da plataforma. NULL/'' limpa o campo (CNPJ e cores são opcionais).
CREATE FUNCTION public.platform_update_organization_profile(_id uuid, _cnpj text, _cor_primaria text,
  _cor_secundaria text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_platform_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma edita imobiliarias.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organizations
     SET cnpj = nullif(regexp_replace(coalesce(_cnpj, ''), '[^0-9]', '', 'g'), ''),
         cor_primaria = nullif(lower(btrim(coalesce(_cor_primaria, ''))), ''),
         cor_secundaria = nullif(lower(btrim(coalesce(_cor_secundaria, ''))), '')
   WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.platform_update_organization_profile(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_organization_profile(uuid, text, text, text)
  TO authenticated, service_role;

-- Último acesso por agência sem varrer auth.users inteiro na aplicação.
CREATE FUNCTION public.mt_2b_org_auth_users(_org uuid)
RETURNS TABLE (user_id uuid, email text, last_sign_in_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT u.id, u.email::text, u.last_sign_in_at
    FROM public.organization_members m
    JOIN auth.users u ON u.id = m.user_id
   WHERE m.organization_id = _org
$$;
REVOKE ALL ON FUNCTION public.mt_2b_org_auth_users(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mt_2b_org_auth_users(uuid) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('organization-logos', 'organization-logos', true, 1048576,
        ARRAY['image/png', 'image/jpeg', 'image/webp']);
COMMIT;
