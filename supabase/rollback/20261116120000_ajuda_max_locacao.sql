-- Rollback de 20261116120000_ajuda_max_locacao.sql (Ajuda MAX na Locação, fatia 1/2, t_b037935e).
-- Remove só o que a migration criou: funções do assistente, contador diário e a chave 'ajuda_max_locacao'.
-- Nenhuma locação, venda, usuário ou outro módulo é tocado. A chave sai de organization_modules ANTES de o CHECK
-- voltar à lista anterior. Reverter junto o front (fechar/reverter o PR): a tela de Módulos lista a chave nova.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

DROP FUNCTION IF EXISTS public.ajuda_max_locacao_fechar(uuid, uuid, date, text, integer, integer);
DROP FUNCTION IF EXISTS public.ajuda_max_locacao_reservar();
DROP FUNCTION IF EXISTS public.ajuda_max_locacao_uso_hoje();
DROP FUNCTION IF EXISTS public.ajuda_max_locacao_enabled();
DROP TABLE IF EXISTS public.ajuda_max_locacao_uso;

DELETE FROM public.organization_modules WHERE module = 'ajuda_max_locacao';

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento', 'proposta_compra',
                    'locacao'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                                        'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento', 'proposta_compra',
                                        'locacao')
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
