-- Rollback de 20261105150000_chave_sistemas_etapa0 (cartão t_1969ae17).
-- Tira os gatilhos novos, apaga as linhas dos módulos visita/estudo/sessenta (e o histórico deles) e devolve
-- o CHECK e a RPC platform_set_organization_module ao corpo de antes (copiado do banco em 05/11/2026).
-- Efeito para quem usa: nenhum (nada lia essas chaves para bloquear). O sync_org_map não é tocado.
-- Os satélites mantêm a coluna adm_sync_orgs.acesso_ligado (padrão true); ver o rollback de cada satélite.

DROP TRIGGER IF EXISTS trg_zz_org_sistema_chave ON public.organization_modules;
DROP FUNCTION IF EXISTS public.org_sistema_chave_trg();
DROP TRIGGER IF EXISTS trg_zz_org_sistemas_padrao ON public.organizations;
DROP FUNCTION IF EXISTS public.org_sistemas_padrao_trg();

DELETE FROM public.organization_module_history WHERE module IN ('visita', 'estudo', 'sessenta');
DELETE FROM public.organization_modules WHERE module IN ('visita', 'estudo', 'sessenta');

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia', 'vouchers_fotos')
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
