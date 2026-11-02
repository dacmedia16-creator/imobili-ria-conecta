-- Academia Única MAX como módulo liga/desliga por imobiliária. Card t_e21b37b6 (pedido de Denis em 02/11/2026,
-- tópico 6238: "colocar academia como modulo liga e desliga para imobiliarias").
--
-- ADITIVA. Rollback: docs/sql/rollback/20261102150000_academia_modulo.rollback.sql
--
-- O que faz:
-- 1) Chave nova "academia" em organization_modules (CHECK + lista aceita em platform_set_organization_module,
--    que só o super-admin da plataforma executa e que grava organization_module_history).
-- 2) academia_enabled(): a imobiliária atual (current_org_id, do banco) tem a Academia ligada? Usada pelo hub
--    (card "Academia MAX" e roda). Sem linha, erro ou sem login = desligado.
-- 3) Estado inicial: ligada só na RE/MAX Única Escolha (slug unica-escolha); desligada nas demais.
--    ON CONFLICT DO NOTHING: não sobrescreve escolha já feita.
-- Não mexe na Academia (academia.unicaescolha.com.br) nem na Conta MAX. Desligar não apaga nada.
BEGIN;

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia')
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

-- Academia ligada na imobiliária atual (sem linha = desligada).
CREATE OR REPLACE FUNCTION public.academia_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'academia'), false)
$$;
REVOKE ALL ON FUNCTION public.academia_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academia_enabled() TO authenticated, service_role;

INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'academia', (o.slug = 'unica-escolha') FROM public.organizations o
ON CONFLICT (organization_id, module) DO NOTHING;

COMMIT;
