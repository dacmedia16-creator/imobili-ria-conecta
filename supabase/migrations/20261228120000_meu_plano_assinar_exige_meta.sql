-- Meu Plano 2027: só assina com a meta oficial calculada (cartão t_3d55d20c, Denis 23/11/2026, tópico 6238).
-- Só aditivo: NÃO altera nenhum plano, nenhuma meta gravada nem nenhuma assinatura existente. Quem já assinou
-- continua assinado (a trava só roda para quem ainda NÃO assinou); o caminho para esses é o Reabrir plano.
--
-- Regra = metaOficialDoPlano(calc()) não é null (src/lib/meu-plano-2027/meta-calculavel.ts). Ela só precisa
-- saber se as transações do ano (tCapt) e a comissão média (comMedia) EXISTEM, não o valor:
--  - tCapt: mt.tCapt digitado (número) OU sugestão = transações do passo 3, que existe quando
--    estilo de vida > 0 (despesas × 12 + sonhos, alíquota < 100), faixa > 0 e ticket × % > 0;
--  - comMedia: mt.comMedia digitado (número) OU ticket × % > 0 (ticket digitado ou, em branco, o do
--    diagnóstico se > 0);
--  - mt.tVenda vazio conta 0 (não impede); as taxas do funil não entram no VGC.
-- Os mesmos casos (src/lib/meu-plano-2027/meta-calculavel.casos.json) são conferidos no vitest e na suíte SQL.
-- Rollback: docs/sql/rollback/20261228120000_meu_plano_assinar_exige_meta.rollback.sql
BEGIN;

-- Número no padrão brasileiro: igual à versão de 20261209120000, agora também ignorando BOM (U+FEFF) e NBSP
-- (U+00A0) colados de planilha, como o trim() da tela. Antes, NULL aqui só deixava de conferir; agora impede assinar.
CREATE OR REPLACE FUNCTION public.carreira_plano_num(_v jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $function$
DECLARE s text;
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) NOT IN ('number', 'string') THEN RETURN NULL; END IF;
  IF jsonb_typeof(_v) = 'number' THEN RETURN (_v #>> '{}')::numeric; END IF;
  s := regexp_replace(_v #>> '{}', 'R\$|\s|%|' || chr(160) || '|' || chr(65279), '', 'g');
  IF s = '' THEN RETURN NULL; END IF;
  IF position(',' IN s) > 0 THEN s := replace(replace(s, '.', ''), ',', '.');
  ELSIF s ~ '^[0-9]{1,3}(\.[0-9]{3})+$' THEN s := replace(s, '.', '');
  END IF;
  IF s !~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)$' THEN RETURN NULL; END IF;
  RETURN s::numeric;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_num(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carreira_plano_num(jsonb) TO service_role;

-- O que falta para a meta oficial sair (null = está calculada). Uso interno.
-- shortcut: número em notação científica/hex ("1e3", "0x10") a tela lê e o banco não (carreira_plano_num);
-- nesse caso raro o banco recusa e o corretor digita o número normal.
CREATE OR REPLACE FUNCTION public.carreira_plano_falta_meta(_r jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $function$
DECLARE
  _sub numeric; _aliq numeric; _faixa numeric; _tk numeric; _pct numeric;
  _com_trans boolean; _trans boolean; _capt boolean; _com boolean; _falta text[] := '{}';
BEGIN
  IF _r IS NULL OR jsonb_typeof(_r) <> 'object' THEN _r := '{}'::jsonb; END IF;
  -- Comissão por transação (linha 6 do passo 3) = ticket × % quando os dois são > 0.
  _tk := coalesce(public.carreira_plano_num(_r -> 'm.ticket'),
                  nullif(greatest(public.carreira_plano_num(_r -> 'd.ticket'), 0), 0));
  _pct := public.carreira_plano_num(_r -> 'm.pct');
  _com_trans := coalesce(_tk > 0 AND _pct > 0, false);
  -- Estilo de vida do ano: (pessoais + negócio) × 12 + sonhos; vazio/inválido conta 0 (soma() da tela).
  SELECT coalesce(sum(public.carreira_plano_num(_r -> k)), 0) INTO _sub
    FROM unnest(ARRAY['op.0','op.1','op.2','op.3','op.4','op.5','op.6','op.7',
                      'on.0','on.1','on.2','on.3','on.4','on.5']) k;
  _sub := _sub * 12 + coalesce((SELECT sum(public.carreira_plano_num(_r -> k))
                                  FROM unnest(ARRAY['so.0.v','so.1.v','so.2.v']) k), 0);
  _aliq := public.carreira_plano_num(_r -> 'es.aliq');
  _faixa := public.carreira_plano_num(_r -> 'm.faixa');
  _trans := coalesce(_aliq < 100 AND _sub > 0 AND _faixa > 0 AND _com_trans, false);
  _capt := public.carreira_plano_num(_r -> 'mt.tCapt') IS NOT NULL OR _trans;
  _com := public.carreira_plano_num(_r -> 'mt.comMedia') IS NOT NULL OR _com_trans;
  IF NOT _capt THEN _falta := array_append(_falta, 'transações de captação'); END IF;
  IF NOT _com THEN _falta := array_append(_falta, 'comissão média por transação'); END IF;
  IF cardinality(_falta) = 0 THEN RETURN NULL; END IF;
  RETURN array_to_string(_falta, ' e ');
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_falta_meta(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carreira_plano_falta_meta(jsonb) TO service_role;

-- Trava de valores (Denis 23/11, item 1): agora também confere as transações SUGERIDAS (captação/venda em
-- branco) e o VGC calculado com elas, igual à tela (conferirPlano em src/lib/meu-plano-2027/conferencia.ts).
-- A sugestão é a mesma conta de calc(): estilo de vida ÷ faixa ÷ (ticket × %), arredondada para cima, dividida
-- 60% captação (arredondado) e o resto venda. Os casos de trava-sugestao.casos.json conferem tela × banco.
-- shortcut: a conta é em numeric e a tela em ponto flutuante; só difere em centavos exatamente no teto.
CREATE OR REPLACE FUNCTION public.carreira_plano_trava(_r jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $function$
DECLARE
  _k text; _v jsonb; _t text; _tc numeric; _tv numeric; _cm numeric; _tk numeric; _pct numeric;
  _sub numeric; _aliq numeric; _faixa numeric; _ct numeric; _trans numeric; _sc numeric; _sv numeric;
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
    IF _t !~ '^[0-9]+$' THEN -- só 0-9: o \d do PG aceita dígitos Unicode e quebra o ::numeric
      RETURN format('%s: "%s" não é um número inteiro. Corrija na tela Metas.', _nomes ->> _k, left(_t, 20));
    END IF;
    IF _t::numeric > 500 THEN
      RETURN format('%s %s no ano passa do máximo de 500. Confira se não digitou um valor em reais.',
                    _t, _nomes ->> _k);
    END IF;
  END LOOP;
  -- Comissão por transação = ticket × % (ticket digitado ou, em branco, o do diagnóstico se > 0).
  _tk := coalesce(public.carreira_plano_num(_r -> 'm.ticket'),
                  nullif(greatest(public.carreira_plano_num(_r -> 'd.ticket'), 0), 0));
  _pct := public.carreira_plano_num(_r -> 'm.pct');
  IF _tk > 0 AND _pct > 0 THEN _ct := _tk * _pct / 100; END IF;
  -- Transações sugeridas (passo 3): estilo de vida ÷ faixa ÷ comissão por transação, para cima.
  SELECT coalesce(sum(public.carreira_plano_num(_r -> k)), 0) INTO _sub
    FROM unnest(ARRAY['op.0','op.1','op.2','op.3','op.4','op.5','op.6','op.7',
                      'on.0','on.1','on.2','on.3','on.4','on.5']) k;
  _sub := _sub * 12 + coalesce((SELECT sum(public.carreira_plano_num(_r -> k))
                                  FROM unnest(ARRAY['so.0.v','so.1.v','so.2.v']) k), 0);
  _aliq := public.carreira_plano_num(_r -> 'es.aliq');
  _faixa := public.carreira_plano_num(_r -> 'm.faixa');
  IF _aliq < 100 AND _sub > 0 AND _faixa > 0 AND _ct > 0 THEN
    _trans := ceil((_sub / (1 - _aliq / 100)) / (_faixa / 100) / _ct);
    _sc := round(_trans * 0.6);
    _sv := _trans - _sc;
  END IF;
  _tc := public.carreira_plano_num(_r -> 'mt.tCapt');
  _tv := public.carreira_plano_num(_r -> 'mt.tVenda');
  IF _tc IS NULL AND _sc > 500 THEN
    RETURN format('A sugestão do plano deu %s transações de captação no ano. Confira se não entrou um valor em reais no ticket ou na comissão. O máximo aceito é 500.',
                  replace(to_char(_sc, 'FM999,999,999,999'), ',', '.'));
  END IF;
  IF _tv IS NULL AND _sv > 500 THEN
    RETURN format('A sugestão do plano deu %s transações de venda no ano. Confira se não entrou um valor em reais no ticket ou na comissão. O máximo aceito é 500.',
                  replace(to_char(_sv, 'FM999,999,999,999'), ',', '.'));
  END IF;
  _tc := coalesce(_tc, _sc);
  _tv := coalesce(_tv, _sv);
  _cm := coalesce(public.carreira_plano_num(_r -> 'mt.comMedia'), _ct);
  IF _tc IS NOT NULL AND _cm IS NOT NULL AND (_tc + coalesce(_tv, 0)) * _cm > 5000000 THEN
    RETURN 'Meta de comissão do ano acima de R$ 5 milhões. Confira as transações e a comissão média antes de assinar.';
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_trava(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carreira_plano_trava(jsonb) TO service_role;

-- Assinar: igual à versão de 20261209120000, mais a exigência da meta calculada (depois da trava de valores).
CREATE OR REPLACE FUNCTION public.carreira_plano_assinar(_ano integer)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid; _em timestamptz; _r jsonb; _ja timestamptz; _motivo text;
BEGIN
  _org := public.meu_plano_org_ok();
  SELECT respostas, assinado_corretor_em INTO _r, _ja FROM public.carreira_plano
   WHERE organization_id = _org AND user_id = _me AND ano = _ano FOR UPDATE;
  IF FOUND AND _ja IS NULL THEN
    _motivo := public.carreira_plano_trava(_r);
    IF _motivo IS NOT NULL THEN
      RAISE EXCEPTION 'Plano com valor fora do limite: %', _motivo USING ERRCODE = '22023';
    END IF;
    _motivo := public.carreira_plano_falta_meta(_r);
    IF _motivo IS NOT NULL THEN
      RAISE EXCEPTION 'Plano sem meta calculada: falta %. Complete na tela Metas antes de assinar.', _motivo
        USING ERRCODE = '22023';
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

COMMIT;
