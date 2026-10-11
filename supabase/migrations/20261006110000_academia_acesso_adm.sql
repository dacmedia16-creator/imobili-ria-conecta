-- Recuperado de supabase_migrations.schema_migrations (versão 20261006110000) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Academia Única MAX: consulta apenas a identidade autenticada, sem expor dados do ADM.
-- Rollback: 20261006110000_academia_acesso_adm.down.sql
CREATE FUNCTION public.academia_has_active_adm_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
       WHERE p.id = auth.uid() AND p.ativo IS TRUE
         AND (
           EXISTS (SELECT 1 FROM public.platform_admins AS a WHERE a.user_id = p.id)
           OR EXISTS (
             SELECT 1 FROM public.organization_members AS m
               JOIN public.organizations AS o ON o.id = m.organization_id
              WHERE m.user_id = p.id AND m.ativo IS TRUE AND o.status = 'ativa'
           )
         )
    );
$$;
REVOKE ALL ON FUNCTION public.academia_has_active_adm_access() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.academia_has_active_adm_access() TO authenticated;
