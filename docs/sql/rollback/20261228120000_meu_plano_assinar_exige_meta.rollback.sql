-- Rollback de 20261228120000_meu_plano_assinar_exige_meta (cartão t_3d55d20c).
-- Volta carreira_plano_assinar ao corpo da migration 20261209120000 (só a trava de valores) e tira a função
-- auxiliar. Nenhum dado é apagado nem alterado. ACL mantida (CREATE OR REPLACE).
BEGIN;

CREATE OR REPLACE FUNCTION public.carreira_plano_assinar(_ano integer)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid; _em timestamptz; _r jsonb; _ja timestamptz; _motivo text;
BEGIN
  _org := public.meu_plano_org_ok();
  SELECT respostas, assinado_corretor_em INTO _r, _ja FROM public.carreira_plano
   WHERE organization_id = _org AND user_id = _me AND ano = _ano FOR UPDATE;
  IF _ja IS NULL THEN
    _motivo := public.carreira_plano_trava(_r);
    IF _motivo IS NOT NULL THEN
      RAISE EXCEPTION 'Plano com valor fora do limite: %', _motivo USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.carreira_plano SET assinado_corretor_em = coalesce(assinado_corretor_em, now())
   WHERE organization_id = _org AND user_id = _me AND ano = _ano
  RETURNING assinado_corretor_em INTO _em;
  IF _em IS NULL THEN RAISE EXCEPTION 'Preencha o pacto antes de assinar' USING ERRCODE = 'P0002'; END IF;
  RETURN _em;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_assinar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_assinar(integer) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.carreira_plano_falta_meta(jsonb);

-- Trava de valores: volta ao corpo de 20261209120000 (sem conferir a sugestão).
CREATE OR REPLACE FUNCTION public.carreira_plano_trava(_r jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $function$
DECLARE
  _k text; _v jsonb; _t text; _n numeric; _tc numeric; _tv numeric; _cm numeric; _tk numeric; _pct numeric;
  _nomes CONSTANT jsonb := '{"mt.tCapt":"transações de captação","mt.tVenda":"transações de venda",
    "mt.novas":"novas CREs","mt.vendidas":"CREs vendidas","mt.canc":"CREs canceladas/expiradas",
    "mt.creIni":"CREs ativas no início","mt.creFim":"CREs ativas no fim"}';
BEGIN
  IF _r IS NULL OR jsonb_typeof(_r) <> 'object' THEN RETURN NULL; END IF;
  FOR _k IN SELECT jsonb_object_keys(_nomes) LOOP
    _v := _r -> _k;
    IF _v IS NULL OR jsonb_typeof(_v) NOT IN ('number', 'string') THEN CONTINUE; END IF;
    -- Tira espaço comum, tab, quebra de linha, NBSP e BOM das pontas (igual ao trim() da tela).
    _t := regexp_replace(_v #>> '{}', '^[\s' || chr(160) || chr(65279) || ']+|[\s' || chr(160) || chr(65279) || ']+$', '', 'g');
    IF _t = '' THEN CONTINUE; END IF;
    IF _t !~ '^\d+$' THEN
      RETURN format('%s: "%s" não é um número inteiro. Corrija na tela Metas.', _nomes ->> _k, left(_t, 20));
    END IF;
    IF _t::numeric > 500 THEN
      RETURN format('%s %s no ano passa do máximo de 500. Confira se não digitou um valor em reais.',
                    _t, _nomes ->> _k);
    END IF;
  END LOOP;
  _tc := public.carreira_plano_num(_r -> 'mt.tCapt');
  _tv := public.carreira_plano_num(_r -> 'mt.tVenda');
  _cm := public.carreira_plano_num(_r -> 'mt.comMedia');
  IF _cm IS NULL THEN
    -- Mesma ordem da conta (calc): ticket digitado ou, em branco, o do diagnóstico (> 0).
    _tk := coalesce(public.carreira_plano_num(_r -> 'm.ticket'),
                    nullif(greatest(public.carreira_plano_num(_r -> 'd.ticket'), 0), 0));
    _pct := public.carreira_plano_num(_r -> 'm.pct');
    IF _tk > 0 AND _pct > 0 THEN _cm := _tk * _pct / 100; END IF;
  END IF;
  IF _tc IS NOT NULL AND _cm IS NOT NULL AND (_tc + coalesce(_tv, 0)) * _cm > 5000000 THEN
    RETURN 'Meta de comissão do ano acima de R$ 5 milhões. Confira as transações e a comissão média antes de assinar.';
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_trava(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carreira_plano_trava(jsonb) TO service_role;

-- Número BR: volta ao corpo de 20261209120000.
CREATE OR REPLACE FUNCTION public.carreira_plano_num(_v jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $function$
DECLARE s text;
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) NOT IN ('number', 'string') THEN RETURN NULL; END IF;
  IF jsonb_typeof(_v) = 'number' THEN RETURN (_v #>> '{}')::numeric; END IF;
  s := regexp_replace(_v #>> '{}', 'R\$|\s|%', '', 'g');
  IF s = '' THEN RETURN NULL; END IF;
  IF position(',' IN s) > 0 THEN s := replace(replace(s, '.', ''), ',', '.');
  ELSIF s ~ '^\d{1,3}(\.\d{3})+$' THEN s := replace(s, '.', '');
  END IF;
  IF s !~ '^[+-]?(\d+\.?\d*|\.\d+)$' THEN RETURN NULL; END IF;
  RETURN s::numeric;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_num(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carreira_plano_num(jsonb) TO service_role;

COMMIT;
