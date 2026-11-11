-- Ajuda MAX na Locação — fatia 1/2 (t_b037935e; maquete t_8e76e1c3 aprovada por Denis em 11/11/2026).
-- 1) Chave própria por imobiliária 'ajuda_max_locacao' (nasce DESLIGADA: nenhuma linha). O balão só aparece com
--    esta chave E o módulo 'locacao' ligados. Só o super-admin da plataforma liga (tela Módulos).
-- 2) Contador diário de perguntas por pessoa (limite 20/dia, dia de Brasília). Nenhum texto de pergunta ou resposta
--    é gravado: só contagens e tokens. organization_id em toda linha; RLS ligada e nenhum grant ao navegador.
-- Rollback: supabase/rollback/20261116120000_ajuda_max_locacao.sql
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Chave ----------------------------------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento', 'proposta_compra',
                    'locacao', 'ajuda_max_locacao'));

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
                                        'locacao', 'ajuda_max_locacao')
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

-- Ligado para quem está logado: Locação liberada (módulo + não ser só fotógrafo) E a chave do assistente.
CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(public.locacao_enabled() AND EXISTS (
    SELECT 1 FROM public.organization_modules m
     WHERE m.organization_id = public.current_org_id() AND m.module = 'ajuda_max_locacao' AND m.enabled), false)
$$;
REVOKE ALL ON FUNCTION public.ajuda_max_locacao_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_enabled() TO authenticated, service_role;

-- 2) Contador diário ------------------------------------------------------------------------------------------------
CREATE TABLE public.ajuda_max_locacao_uso (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  dia date NOT NULL,
  perguntas integer NOT NULL DEFAULT 0 CONSTRAINT ajuda_max_locacao_uso_perguntas_check CHECK (perguntas BETWEEN 0 AND 20),
  respondidas integer NOT NULL DEFAULT 0 CONSTRAINT ajuda_max_locacao_uso_resp_check CHECK (respondidas >= 0),
  nao_sabe integer NOT NULL DEFAULT 0 CONSTRAINT ajuda_max_locacao_uso_nao_sabe_check CHECK (nao_sabe >= 0),
  tokens_entrada bigint NOT NULL DEFAULT 0,
  tokens_saida bigint NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, dia)
);
CREATE INDEX ajuda_max_locacao_uso_org_dia_idx ON public.ajuda_max_locacao_uso (organization_id, dia);
ALTER TABLE public.ajuda_max_locacao_uso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ajuda_max_locacao_uso FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ajuda_max_locacao_uso TO service_role;
COMMENT ON TABLE public.ajuda_max_locacao_uso IS
  'Ajuda MAX na Locação (t_b037935e): contagem diária de perguntas por pessoa. Sem texto de pergunta/resposta.';

-- Uso de hoje de quem está logado (para o balão mostrar "x de 20").
CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_uso_hoje() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _n integer;
  _dia date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _uid IS NULL OR _org IS NULL OR NOT public.ajuda_max_locacao_enabled() THEN
    RETURN jsonb_build_object('ligado', false, 'usadas', 0, 'limite', 20);
  END IF;
  SELECT perguntas INTO _n FROM public.ajuda_max_locacao_uso
   WHERE organization_id = _org AND user_id = _uid AND dia = _dia;
  RETURN jsonb_build_object('ligado', true, 'usadas', coalesce(_n, 0), 'limite', 20);
END $$;
REVOKE ALL ON FUNCTION public.ajuda_max_locacao_uso_hoje() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_uso_hoje() TO authenticated;

-- Reserva 1 pergunta ANTES da chamada à IA (com o login de quem pergunta). Trava a linha: duas abas ao mesmo tempo
-- não passam de 20. Devolve a imobiliária e o dia para o servidor fechar a conta depois.
CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_reservar() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _n integer;
  _dia date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _uid IS NULL OR _org IS NULL OR NOT public.ajuda_max_locacao_enabled() THEN
    RAISE EXCEPTION 'Ajuda MAX desligado nesta imobiliária.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.ajuda_max_locacao_uso (organization_id, user_id, dia)
  VALUES (_org, _uid, _dia) ON CONFLICT (organization_id, user_id, dia) DO NOTHING;
  SELECT perguntas INTO _n FROM public.ajuda_max_locacao_uso
   WHERE organization_id = _org AND user_id = _uid AND dia = _dia FOR UPDATE;
  IF _n >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'usadas', _n, 'limite', 20);
  END IF;
  UPDATE public.ajuda_max_locacao_uso SET perguntas = perguntas + 1, atualizado_em = now()
   WHERE organization_id = _org AND user_id = _uid AND dia = _dia RETURNING perguntas INTO _n;
  RETURN jsonb_build_object('ok', true, 'usadas', _n, 'limite', 20, 'org', _org, 'dia', _dia);
END $$;
REVOKE ALL ON FUNCTION public.ajuda_max_locacao_reservar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_reservar() TO authenticated;

-- Fecha a pergunta (só o servidor, service_role): 'sabe' / 'nao_sabe' somam; 'falha' devolve a pergunta reservada
-- (a IA não respondeu, não conta no limite). Só service_role: o navegador não pode "devolver" para burlar o limite.
CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_fechar(_org uuid, _uid uuid, _dia date, _resultado text,
  _entrada integer DEFAULT 0, _saida integer DEFAULT 0) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF _resultado NOT IN ('sabe', 'nao_sabe', 'falha') THEN
    RAISE EXCEPTION 'Resultado inválido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ajuda_max_locacao_uso SET
    perguntas = CASE WHEN _resultado = 'falha' THEN greatest(perguntas - 1, 0) ELSE perguntas END,
    respondidas = respondidas + CASE WHEN _resultado = 'sabe' THEN 1 ELSE 0 END,
    nao_sabe = nao_sabe + CASE WHEN _resultado = 'nao_sabe' THEN 1 ELSE 0 END,
    tokens_entrada = tokens_entrada + greatest(coalesce(_entrada, 0), 0),
    tokens_saida = tokens_saida + greatest(coalesce(_saida, 0), 0),
    atualizado_em = now()
   WHERE organization_id = _org AND user_id = _uid AND dia = _dia;
END $$;
REVOKE ALL ON FUNCTION public.ajuda_max_locacao_fechar(uuid, uuid, date, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_fechar(uuid, uuid, date, text, integer, integer) TO service_role;

COMMIT;
