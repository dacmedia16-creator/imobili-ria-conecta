-- Rollback de 20261105140000_academia_exige_modulo (card t_71136363).
-- Volta academia.user_org e public.academia_has_active_adm_access aos corpos de antes,
-- copiados do banco de produção (pg_get_functiondef) em 05/11/2026 antes de aplicar.
-- Efeito: a Academia volta a não olhar o módulo (qualquer imobiliária ativa entra). Nenhum dado é alterado.

CREATE OR REPLACE FUNCTION academia.user_org(_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid; _ativo boolean;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  SELECT p.ativo INTO _ativo FROM public.profiles p WHERE p.id = _user;
  IF _ativo IS NOT TRUE THEN RETURN NULL; END IF;
  IF to_regclass('public.organization_members') IS NOT NULL THEN
    EXECUTE 'SELECT organization_id FROM public.organization_members WHERE user_id = $1 AND ativo LIMIT 1'
      INTO _org USING _user;
    RETURN _org;
  END IF;
  RETURN academia.legacy_org_id();
END;
$function$;

CREATE OR REPLACE FUNCTION public.academia_has_active_adm_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
