-- Rollback de 20261209120000_meu_plano_trava_valores (t_125c4dd3): volta carreira_plano_assinar e
-- carreira_plano_usar_meta ao corpo de 20261107120000 (o que está em produção em 20/11/2026, md5 conferido) e
-- apaga as 2 funções auxiliares novas. Não mexe em dado nenhum.
BEGIN;

CREATE OR REPLACE FUNCTION public.carreira_plano_assinar(_ano integer)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid; _em timestamptz;
BEGIN
  _org := public.meu_plano_org_ok();
  UPDATE public.carreira_plano SET assinado_corretor_em = coalesce(assinado_corretor_em, now())
   WHERE organization_id = _org AND user_id = _me AND ano = _ano
  RETURNING assinado_corretor_em INTO _em;
  IF _em IS NULL THEN RAISE EXCEPTION 'Preencha o pacto antes de assinar' USING ERRCODE = 'P0002'; END IF;
  RETURN _em;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_assinar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_assinar(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.carreira_plano_usar_meta(_ano integer, _comissao numeric, _vgv numeric,
  _vendas integer, _captacoes integer, _substituir boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid; _ini date; _atual public.minhas_metas%ROWTYPE; _snap jsonb;
BEGIN
  _org := public.meu_plano_org_ok();
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  IF (_comissao IS NOT NULL AND (_comissao < 0 OR _comissao > 999999999999)) OR
     (_vgv IS NOT NULL AND (_vgv < 0 OR _vgv > 99999999999999)) OR
     (_vendas IS NOT NULL AND _vendas NOT BETWEEN 0 AND 10000) OR
     (_captacoes IS NOT NULL AND _captacoes NOT BETWEEN 0 AND 10000) OR
     num_nulls(_comissao, _vgv, _vendas, _captacoes) = 4 THEN
    RAISE EXCEPTION 'Meta inválida' USING ERRCODE = '22023';
  END IF;
  _ini := make_date(_ano, 1, 1);
  SELECT * INTO _atual FROM public.minhas_metas
   WHERE organization_id = _org AND user_id = _me AND periodo = 'ano' AND inicio = _ini FOR UPDATE;
  IF FOUND AND NOT coalesce(_substituir, false) THEN
    RETURN jsonb_build_object('status', 'existe', 'atual', jsonb_build_object(
      'meta_comissao', _atual.meta_comissao, 'meta_vgv', _atual.meta_vgv,
      'meta_vendas', _atual.meta_vendas, 'meta_captacoes', _atual.meta_captacoes));
  END IF;
  INSERT INTO public.minhas_metas (organization_id, user_id, periodo, inicio, meta_comissao, meta_vgv, meta_vendas, meta_captacoes)
  VALUES (_org, _me, 'ano', _ini, round(_comissao, 2), round(_vgv, 2), _vendas, _captacoes)
  ON CONFLICT (organization_id, user_id, periodo, inicio)
  DO UPDATE SET meta_comissao = EXCLUDED.meta_comissao, meta_vgv = EXCLUDED.meta_vgv,
    meta_vendas = EXCLUDED.meta_vendas, meta_captacoes = EXCLUDED.meta_captacoes;
  _snap := jsonb_build_object('meta_comissao', round(_comissao, 2), 'meta_vgv', round(_vgv, 2),
    'meta_vendas', _vendas, 'meta_captacoes', _captacoes);
  INSERT INTO public.carreira_plano AS p (organization_id, user_id, ano, meta_oficial, meta_oficial_em)
  VALUES (_org, _me, _ano, _snap, now())
  ON CONFLICT (organization_id, user_id, ano)
  DO UPDATE SET meta_oficial = EXCLUDED.meta_oficial, meta_oficial_em = EXCLUDED.meta_oficial_em;
  RETURN jsonb_build_object('status', 'gravada', 'meta', _snap);
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_usar_meta(integer, numeric, numeric, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_usar_meta(integer, numeric, numeric, integer, integer, boolean)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.carreira_plano_trava(jsonb);
DROP FUNCTION IF EXISTS public.carreira_plano_num(jsonb);

COMMIT;
