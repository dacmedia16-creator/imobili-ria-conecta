-- Rollback de 20261108200000_link_acompanhamento.sql (t_54c79bdc).
-- Remove só o que a migration criou. Nenhuma venda, parte ou histórico é tocado. Os links gerados deixam de
-- existir (todos param de abrir). O campo "Link de avaliação no Google" é apagado junto com a coluna.
-- A chave 'link_acompanhamento' sai de organization_modules ANTES de o CHECK voltar à lista anterior.
-- Reverter junto o front (PR): a tela de Módulos lista 'link_acompanhamento' e o CHECK deixaria de aceitar.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

DROP FUNCTION IF EXISTS public.acompanhamento_publico(text, text);
DROP FUNCTION IF EXISTS public.acompanhamento_link_regenerar(uuid, text);
DROP FUNCTION IF EXISTS public.acompanhamento_links(uuid);
DROP FUNCTION IF EXISTS public.acompanhamento_link_criar(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.acompanhamento_links_json(uuid, integer);
DROP FUNCTION IF EXISTS public.acompanhamento_venda_checada(uuid);
DROP FUNCTION IF EXISTS public.acompanhamento_pode_ver_venda(uuid);
DROP FUNCTION IF EXISTS public.acompanhamento_hash(text);
DROP FUNCTION IF EXISTS public.acompanhamento_token(uuid);
DROP FUNCTION IF EXISTS public.acompanhamento_etapa(public.sale_status);
DROP TABLE IF EXISTS public.sale_acompanhamento_tentativas;
DROP TABLE IF EXISTS public.sale_acompanhamento_links;
DELETE FROM vault.secrets WHERE name = 'acompanhamento_link_chave';

DROP FUNCTION IF EXISTS public.agency_google_avaliacao_salvar(text);
ALTER TABLE public.organizations DROP COLUMN IF EXISTS google_avaliacao_url;

DROP FUNCTION IF EXISTS public.link_acompanhamento_enabled();
DROP FUNCTION IF EXISTS public.link_acompanhamento_modulo_ligado(uuid);
-- O histórico de liga/desliga (organization_module_history) fica: é auditoria e não tem CHECK de módulo.
DELETE FROM public.organization_modules WHERE module = 'link_acompanhamento';

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade', 'inteligencia_gestao'));

-- platform_set_organization_module igual à da 20261108180000.
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
                                        'avisos_exclusividade', 'inteligencia_gestao')
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
