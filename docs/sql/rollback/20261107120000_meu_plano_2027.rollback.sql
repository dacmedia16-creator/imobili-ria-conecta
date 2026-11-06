-- Rollback de 20261107120000_meu_plano_2027 (cartão t_1ac2e95d).
-- ATENÇÃO: apaga os planos preenchidos (carreira_plano). Metas já gravadas em minhas_metas pelo botão
-- "Usar como minha meta oficial" CONTINUAM (são metas normais do corretor).
-- Devolve o CHECK e a RPC platform_set_organization_module ao corpo da 20261105150000.

DROP FUNCTION IF EXISTS public.carreira_plano_meus_numeros();
DROP FUNCTION IF EXISTS public.carreira_plano_equipe(integer);
DROP FUNCTION IF EXISTS public.carreira_plano_usar_meta(integer, numeric, numeric, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.carreira_plano_assinar_broker(uuid, integer);
DROP FUNCTION IF EXISTS public.carreira_plano_assinar(integer);
DROP FUNCTION IF EXISTS public.carreira_plano_trilha(integer, text);
DROP FUNCTION IF EXISTS public.carreira_plano_salvar(integer, jsonb);
DROP TABLE IF EXISTS public.carreira_plano;
DROP FUNCTION IF EXISTS public.meu_plano_org_ok();
DROP FUNCTION IF EXISTS public.meu_plano_eh_broker(uuid);
DROP FUNCTION IF EXISTS public.meu_plano_2027_enabled();
DROP FUNCTION IF EXISTS public.meu_plano_modulo_ligado(uuid);

ALTER TABLE public.carreira_taxas DROP COLUMN IF EXISTS funil_v2_cre, DROP COLUMN IF EXISTS funil_v1_v2,
  DROP COLUMN IF EXISTS funil_folga;

DELETE FROM public.organization_module_history WHERE module = 'meu_plano_2027';
DELETE FROM public.organization_modules WHERE module = 'meu_plano_2027';

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta')
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
