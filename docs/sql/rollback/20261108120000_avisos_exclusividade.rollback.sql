-- Rollback de 20261108120000_avisos_exclusividade (cartão t_c337fc12).
-- ATENÇÃO: apaga as reuniões registradas, o registro dos avisos, os aparelhos com push e as preferências.
-- Notificações do sino já gravadas (tabela notifications) CONTINUAM.
-- Devolve o CHECK e a RPC platform_set_organization_module ao corpo da 20261107120000.

DROP FUNCTION IF EXISTS public.aviso_preferencias_salvar(boolean, boolean);
DROP TABLE IF EXISTS public.aviso_preferencias;
DROP FUNCTION IF EXISTS public.push_cancelar(text);
DROP FUNCTION IF EXISTS public.push_inscrever(text, text, text, text);
DROP TABLE IF EXISTS public.push_subscriptions;
DROP TABLE IF EXISTS public.exclusive_notice_log;
DROP FUNCTION IF EXISTS public.exclusive_reuniao_registrar(uuid, date, text);
DROP TABLE IF EXISTS public.exclusive_owner_meetings;
DROP FUNCTION IF EXISTS public.avisos_exclusividade_enabled();
DROP FUNCTION IF EXISTS public.avisos_exclusividade_modulo_ligado(uuid);

DELETE FROM public.organization_module_history WHERE module = 'avisos_exclusividade';
DELETE FROM public.organization_modules WHERE module = 'avisos_exclusividade';

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027')
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
