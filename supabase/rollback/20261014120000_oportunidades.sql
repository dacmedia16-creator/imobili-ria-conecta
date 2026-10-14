-- Rollback de 20261014120000_oportunidades.sql.
-- ATENÇÃO: apaga o mural (posts do grupo), os pares "não encaixa" e o registro de alertas.
-- Os posts originais continuam no leitor da VPS; basta religar e reingerir.
-- Depois de rodar, remover a linha 20261014120000 de supabase_migrations.schema_migrations.
BEGIN;
DROP FUNCTION IF EXISTS public.opportunity_ingest(uuid, jsonb);
DROP FUNCTION IF EXISTS public.opportunity_clean_text(text);
DROP FUNCTION IF EXISTS public.opportunity_capture_candidates();
DROP TABLE IF EXISTS public.opportunity_alerts;
DROP TABLE IF EXISTS public.opportunity_hidden_pairs;
DROP TABLE IF EXISTS public.opportunity_posts;
DELETE FROM public.organization_module_history WHERE module = 'oportunidades';
DELETE FROM public.organization_modules WHERE module = 'oportunidades';
DROP FUNCTION IF EXISTS public.opportunities_enabled();
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario'));
CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario')
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
COMMIT;
