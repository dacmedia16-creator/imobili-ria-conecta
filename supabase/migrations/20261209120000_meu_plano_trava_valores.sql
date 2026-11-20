-- Meu Plano 2027: trava contra valores absurdos no SERVIDOR (cartão t_125c4dd3, Denis 20/11, tópico 6238).
-- Só aditivo: não altera nenhum plano, nenhuma meta gravada nem nenhuma assinatura existente.
-- Espelho dos BLOQUEIOS de src/lib/meu-plano-2027/conferencia.ts (avisos ficam só na tela):
--  - carreira_plano_assinar: recusa assinar se um campo de quantidade DIGITADO não for inteiro ou passar de 500,
--    ou se a meta de comissão (com transações e comissão digitadas) passar de R$ 5 mi;
--  - carreira_plano_usar_meta: recusa gravar meta oficial com comissão acima de R$ 5 mi ou mais de 1.000
--    transações (2 campos × 500).
-- O rascunho (carreira_plano_salvar) continua aceitando tudo, para o corretor poder corrigir.
-- Rollback: supabase/rollback/20261209120000_meu_plano_trava_valores.sql
BEGIN;

-- Número no padrão brasileiro (mesma regra de num() em regras.ts). Uso interno.
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

-- Motivo para NÃO assinar (null = pode). Só olha o que foi DIGITADO; sugestões em branco a tela confere.
-- shortcut: a meta de comissão só é conferida aqui quando a captação está digitada e há comissão média (digitada
-- ou ticket × %). Transação SUGERIDA (em branco) depende do estilo de vida (despesas ÷ faixa) e não é refeita no
-- banco: nesse caso a tela trava e, se alguém pular a tela, carreira_plano_usar_meta recusa a meta acima de R$ 5 mi.
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

-- Assinar: igual à versão de 20261107120000, mais a trava. Plano já assinado continua assinado (não reabre nada):
-- a trava só roda para quem ainda NÃO assinou.
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

-- Meta oficial: igual à versão de 20261107120000, com teto de R$ 5 mi de comissão e 1.000 transações.
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
  IF _comissao > 5000000 THEN
    RAISE EXCEPTION 'Plano com valor fora do limite: meta de comissão do ano acima de R$ 5 milhões. Confira as transações e a comissão média.'
      USING ERRCODE = '22023';
  END IF;
  IF _vendas > 1000 THEN
    RAISE EXCEPTION 'Plano com valor fora do limite: mais de 1.000 transações no ano. Confira se não digitou um valor em reais.'
      USING ERRCODE = '22023';
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

COMMIT;
