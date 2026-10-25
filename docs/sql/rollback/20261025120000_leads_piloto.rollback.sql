-- Rollback da migration 20261025120000_leads_piloto.sql (card t_2472761a).
-- ATENÇÃO: apaga os leads do piloto (só existem na ZZ, dados de teste). Antes, desligue o módulo
-- pelo painel Plataforma. Volta a constraint/RPC de módulos ao estado de 20261016150000.
BEGIN;
DROP FUNCTION IF EXISTS public.leads_preparar_org(uuid);
DROP FUNCTION IF EXISTS public.lead_opcoes();
DROP FUNCTION IF EXISTS public.lead_anotar(uuid, text);
DROP FUNCTION IF EXISTS public.lead_atribuir(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_mudar_etapa(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.lead_criar(text, text, text, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_pega(uuid, uuid);
DROP TABLE IF EXISTS public.lead_eventos;
DROP TABLE IF EXISTS public.leads;
DROP TABLE IF EXISTS public.lead_motivos_perda;
DROP TABLE IF EXISTS public.lead_config;
DROP FUNCTION IF EXISTS public.lead_pode_ser_responsavel(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_ctx();
DROP FUNCTION IF EXISTS public.leads_responsaveis_visiveis();
DROP FUNCTION IF EXISTS public.leads_gestor();
DROP FUNCTION IF EXISTS public.leads_enabled();

-- O histórico (organization_module_history) é MANTIDO como prova de quem ligou/desligou o módulo.
DELETE FROM public.organization_modules WHERE module = 'leads';
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores')
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
