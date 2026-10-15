-- Reversão de 20261015120000_mural_conquistas.sql (Mural de Conquistas).
-- Apaga posts, parabéns e preferências de silêncio do mural. NÃO toca em vendas.
-- A tabela profile_birthdates (datas que os usuários preencheram) é mantida por padrão, só a RPC de
-- gravação sai; para apagar também as datas, descomente a linha marcada no fim.
BEGIN;

DROP TRIGGER IF EXISTS trg_zz_mural_conquistas ON public.sale_status_history;
DROP TRIGGER IF EXISTS trg_zz_mural_conquistas ON public.sales;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'achievement_posts') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.achievement_posts;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.trg_achievement_sync();
DROP FUNCTION IF EXISTS public.achievement_sync_sale(uuid);
DROP FUNCTION IF EXISTS public.achievement_feed(integer);
DROP FUNCTION IF EXISTS public.achievement_cheer(uuid);
DROP FUNCTION IF EXISTS public.achievement_ranking(integer, integer);
DROP FUNCTION IF EXISTS public.achievement_birthdays(integer);
DROP FUNCTION IF EXISTS public.achievement_set_muted(boolean);

DROP TABLE IF EXISTS public.achievement_cheers;
DROP TABLE IF EXISTS public.achievement_mutes;
DROP TABLE IF EXISTS public.achievement_posts;

DROP FUNCTION IF EXISTS public.achievements_enabled();

DELETE FROM public.organization_modules WHERE module = 'mural_conquistas';
DELETE FROM public.organization_module_history WHERE module = 'mural_conquistas';

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades')
     OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT enabled INTO _current FROM public.organization_modules
    WHERE organization_id = _org AND module = _module FOR UPDATE;
  IF _current IS NOT DISTINCT FROM _enabled THEN RETURN _enabled; END IF;
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (_org, _module, _enabled, now(), _actor)
  ON CONFLICT (organization_id, module)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _actor;
  INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
  VALUES (_org, _module, _enabled, _actor);
  RETURN _enabled;
END $$;

DROP FUNCTION IF EXISTS public.profile_set_birthdate(date);
-- DROP TABLE IF EXISTS public.profile_birthdates;  -- opcional: apaga as datas preenchidas

COMMIT;
