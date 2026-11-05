-- Academia passa a exigir o módulo 'academia' ligado na imobiliária (card t_71136363, lacuna L4 do t_5841dfc9).
-- Autorizado por Denis em 05/11/2026 ("1 sim / 2 tudo aqui").
-- Antes: o módulo só era lido em public.academia_enabled() (cartão do Hub). Quem abria academia.unicaescolha.com.br
-- direto, sendo de uma imobiliária ativa com o módulo DESLIGADO, passava no porteiro e via todo o catálogo.
-- Agora:
--  * academia.user_org(_user) devolve NULL quando a imobiliária da pessoa não tem
--    organization_modules(module='academia', enabled=true). Como current_org(), user_role(), as políticas RLS
--    (courses, modules, lessons, enrollments, lesson_progress, storage academia-materiais), is_lesson_unlocked,
--    save_progress, tg_enrollment_org, list_org_people e team_progress_overview dependem dela, todos passam a barrar.
--  * public.academia_has_active_adm_access() (porteiro do login do site) exige o mesmo módulo ligado.
--  * Admin da plataforma (public.platform_admins): igual a hoje. Continua entrando pelo caminho próprio
--    (is_platform) e user_org não aplica a checagem do módulo para ele.
-- Nenhum dado é alterado: o progresso e as matrículas de quem perde o acesso ficam guardados.
-- Rollback: docs/sql/rollback/20261105140000_academia_exige_modulo.rollback.sql (corpos de antes, tirados do banco).

CREATE OR REPLACE FUNCTION academia.user_org(_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid; _ativo boolean; _mod boolean;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  SELECT p.ativo INTO _ativo FROM public.profiles p WHERE p.id = _user;
  IF _ativo IS NOT TRUE THEN RETURN NULL; END IF;
  IF to_regclass('public.organization_members') IS NOT NULL THEN
    EXECUTE 'SELECT organization_id FROM public.organization_members WHERE user_id = $1 AND ativo LIMIT 1'
      INTO _org USING _user;
    -- Módulo 'academia' precisa estar ligado na imobiliária (admin da plataforma fica como antes).
    IF _org IS NOT NULL AND to_regclass('public.organization_modules') IS NOT NULL
       AND NOT academia.is_platform_admin(_user) THEN
      EXECUTE 'SELECT coalesce((SELECT enabled FROM public.organization_modules
                 WHERE organization_id = $1 AND module = ''academia''), false)'
        INTO _mod USING _org;
      IF _mod IS NOT TRUE THEN RETURN NULL; END IF;
    END IF;
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
               JOIN public.organization_modules AS om
                 ON om.organization_id = o.id AND om.module = 'academia' AND om.enabled IS TRUE
              WHERE m.user_id = p.id AND m.ativo IS TRUE AND o.status = 'ativa'
           )
         )
    );
$function$;
