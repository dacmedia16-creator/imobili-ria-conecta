-- t_37cf21e3 (Denis 27/10/2026, tópico 6238, conversa d8907e38): parecidos com quartos parecidos.
-- Antes: o "mesmo tipo cru do XML" vinha antes de "quartos mais perto" e quartos não filtravam; para a casa de
-- 3 quartos VIP0027 a 1ª opção foi a VIP0141 (casa de 1 quarto, outro bairro).
-- Agora: quartos ±1 do imóvel de referência (quando ele tem quartos) e, na ordem, mesmo condomínio > mesmo bairro >
-- quartos mais perto > mesmo tipo cru > preço mais perto. Tipo normalizado e faixa de preço continuam iguais.
-- Mesma assinatura e mesmas permissões (só service_role). NÃO APLICADA: depende do "sim" de Denis.
-- Rollback: docs/sql/rollback/20261028000000_leads_ia_parecidos_quartos.rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.lead_ia_imoveis_parecidos(_conversa uuid, _excluir text[] DEFAULT '{}',
  _preco_min numeric DEFAULT NULL, _preco_max numeric DEFAULT NULL, _bairro text DEFAULT NULL,
  _negocio text DEFAULT 'venda', _limite integer DEFAULT 1, _mais_barato boolean DEFAULT false, _codigo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _run uuid; _ref public.remax_xml_listings; _cap uuid;
  _tipo_raw text; _tipo text; _bairro_ref text; _cidade text; _preco numeric; _min numeric; _max numeric;
  _alvo numeric; _b text := nullif(left(public.lead_ia_norm(btrim(coalesce(_bairro, ''))), 60), '');
  _ex text[]; _itens jsonb; _refj jsonb;
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa;
  IF _cv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id AND organization_id = _cv.organization_id;
  IF _l.id IS NULL THEN RETURN NULL; END IF;
  IF _negocio IS NULL OR _negocio NOT IN ('venda', 'locacao') THEN RAISE EXCEPTION 'Negocio invalido' USING ERRCODE = '22023'; END IF;
  IF (_preco_min IS NOT NULL AND (_preco_min < 0 OR _preco_min > 1e11))
     OR (_preco_max IS NOT NULL AND (_preco_max <= 0 OR _preco_max > 1e11)) THEN
    RAISE EXCEPTION 'Faixa invalida' USING ERRCODE = '22023';
  END IF;
  _run := (public.remax_xml_last_ok(_cv.organization_id)).id;

  -- Referência: XML da PRÓPRIA imobiliária (mesmo que já tenha saído). Ordem: código do portal, código
  -- informado neste turno (_codigo, ainda não gravado na conversa), código guardado na conversa.
  IF char_length(btrim(coalesce(_codigo, ''))) > 60 THEN RAISE EXCEPTION 'Codigo invalido' USING ERRCODE = '22023'; END IF;
  SELECT x.* INTO _ref FROM public.remax_xml_listings x
    JOIN (VALUES (1, nullif(btrim(_l.anuncio_codigo), '')), (2, nullif(btrim(_codigo), '')),
                 (3, nullif(btrim(_cv.dados->>'imovel_xml_codigo'), ''))) AS k(ord, cod)
      ON x.code_key = public.portal_code_key(k.cod)
   WHERE x.organization_id = _cv.organization_id AND k.cod IS NOT NULL
   ORDER BY k.ord, (x.last_run = _run) DESC
   LIMIT 1;
  IF _ref.code IS NOT NULL THEN
    _tipo_raw := _ref.tipo; _tipo := public.lead_ia_tipo(_ref.tipo);
    _bairro_ref := nullif(btrim(_ref.bairro), ''); _cidade := nullif(btrim(_ref.cidade), '');
    -- Locação compara aluguel com aluguel (t_25fe1197); pedido de venda não serve de referência de aluguel.
    _preco := CASE WHEN _negocio = 'locacao' THEN _ref.preco_aluguel
                   WHEN _ref.negocio = 'locacao' THEN NULL ELSE _ref.preco END;
  ELSE
    _cap := public.lead_ia_captacao(_l, _cv.dados);
    IF _cap IS NOT NULL THEN
      SELECT public.lead_ia_tipo(c.form_data->'imovel'->>'tipo_imovel'), nullif(btrim(c.form_data->'imovel'->>'bairro'), ''),
             nullif(btrim(c.form_data->'imovel'->>'municipio'), '')
        INTO _tipo, _bairro_ref, _cidade
        FROM public.exclusive_captures c WHERE c.id = _cap AND c.organization_id = _cv.organization_id;
    END IF;
  END IF;
  _refj := jsonb_strip_nulls(jsonb_build_object(
    'codigo', _ref.code, 'no_xml', _ref.code IS NOT NULL AND _ref.last_run = _run,
    'saiu', _ref.code IS NOT NULL AND _ref.last_run IS DISTINCT FROM _run,
    'tipo', _tipo, 'bairro', left(_bairro_ref, 60), 'cidade', left(_cidade, 60),
    'preco', CASE WHEN _preco > 0 THEN _preco END));

  -- Faixa: a do cliente; sem ela, ±15% do preço do pedido. Sem nenhuma das duas, não há parecido.
  _min := _preco_min; _max := _preco_max;
  IF _min IS NULL AND _max IS NULL AND _preco > 0 THEN _min := round(_preco * 0.85); _max := round(_preco * 1.15); END IF;
  -- "Mais barato": só abaixo do preço do pedido (continua dentro da faixa/±15%).
  IF coalesce(_mais_barato, false) AND _preco > 0 THEN _max := least(coalesce(_max, _preco), _preco - 1); END IF;
  _alvo := CASE WHEN _min IS NOT NULL AND _max IS NOT NULL AND _min > _max THEN NULL
                WHEN _preco > 0 AND _preco BETWEEN coalesce(_min, 0) AND coalesce(_max, 1e12) THEN _preco
                WHEN _max IS NOT NULL AND _min IS NOT NULL THEN (_min + _max) / 2
                ELSE coalesce(_max, _min) END;
  -- Locação sem aluguel de referência e sem faixa do cliente (ex.: o pedido era de venda): oferece a locação do
  -- mesmo tipo e cidade, preferindo bairro e quartos, sem filtro de valor (o aluguel é dito na oferta).
  IF _negocio = 'locacao' AND _alvo IS NULL AND _min IS NULL AND _max IS NULL THEN _alvo := 0; END IF;
  _ex := ARRAY(SELECT public.portal_code_key(btrim(e)) FROM unnest(coalesce(_excluir, '{}')) e
                WHERE char_length(btrim(coalesce(e, ''))) BETWEEN 1 AND 60 LIMIT 20);

  -- Locação (t_25fe1197): o XML genérico guarda locação (20261027080000); locação só oferece locação,
  -- comparando o aluguel. Sem locação no XML, nada é achado e a Nicole passa ao corretor.
  IF _run IS NULL OR _tipo IS NULL OR _cidade IS NULL OR _alvo IS NULL THEN
    RETURN jsonb_build_object('referencia', _refj, 'itens', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(i.j ORDER BY i.ord), '[]'::jsonb) INTO _itens FROM (
    SELECT row_number() OVER (ORDER BY
             -- coalesce: em DESC o NULL viria primeiro e passaria na frente do mesmo condomínio/bairro.
             coalesce(_ref.rua IS NOT NULL AND _ref.numero IS NOT NULL AND x.rua = _ref.rua AND x.numero = _ref.numero, false) DESC,
             coalesce(public.lead_ia_norm(btrim(x.bairro)) = public.lead_ia_norm(_bairro_ref), false) DESC,
             -- t_37cf21e3: quartos mais perto ANTES do tipo cru do XML (a VIP0141, "casa" de 1 quarto, passava na
             -- frente das "casa-de-condominio" de 3 quartos).
             coalesce(abs(x.quartos - _ref.quartos), 99),
             coalesce(x.tipo = _tipo_raw, false) DESC, -- mesmo tipo do XML (só desempate)
             abs(x.pv - _alvo), x.code) AS ord,
           jsonb_strip_nulls(jsonb_build_object(
             'codigo', x.code,
             'tipo', public.lead_ia_tipo(x.tipo),
             'bairro', left(nullif(btrim(x.bairro), ''), 60),
             'cidade', left(nullif(btrim(x.cidade), ''), 60),
             'quartos', x.quartos::text,
             'suites', x.suites::text,
             'vagas', x.vagas::text,
             'area_util_m2', public.lead_ia_num(x.area_util),
             'area_terreno_m2', public.lead_ia_num(x.area_terreno),
             'preco', CASE WHEN _negocio = 'venda' THEN public.lead_ia_reais_curto(x.pv) END,
             'aluguel', CASE WHEN _negocio = 'locacao' THEN public.lead_ia_reais_curto(x.pv) END,
             'url', CASE WHEN public.xml_url_anuncio_ok(x.url) THEN x.url END,
             'mesmo_condominio', CASE WHEN coalesce(_ref.rua IS NOT NULL AND _ref.numero IS NOT NULL
                                       AND x.rua = _ref.rua AND x.numero = _ref.numero, false) THEN true END,
             'mesmo_bairro', CASE WHEN coalesce(public.lead_ia_norm(btrim(x.bairro)) = public.lead_ia_norm(_bairro_ref), false) THEN true END)) AS j
      FROM (SELECT y.*, CASE WHEN _negocio = 'locacao' THEN y.preco_aluguel ELSE y.preco END AS pv
              FROM public.remax_xml_listings y
             WHERE y.organization_id = _cv.organization_id AND y.last_run = _run
               AND CASE WHEN _negocio = 'locacao' THEN y.negocio IN ('locacao', 'venda_locacao')
                        ELSE y.negocio IN ('venda', 'venda_locacao') END) x
     WHERE x.pv > 0
       AND x.pv BETWEEN coalesce(_min, 0) AND coalesce(_max, 1e12)
       AND public.lead_ia_norm(btrim(x.cidade)) = public.lead_ia_norm(_cidade)
       -- t_82c89141: tipo NORMALIZADO (casa = casa/casa de condomínio). Antes era o tipo cru do XML e a casa 3975
       -- ("casa") não achava as 14 "casa-de-condominio" da mesma faixa em Sorocaba.
       AND public.lead_ia_tipo(x.tipo) = _tipo
       -- t_37cf21e3 item 1: quartos parecidos (±1) quando o imóvel de referência tem quartos (terreno/sala: sem filtro).
       AND (coalesce(_ref.quartos, 0) <= 0 OR (x.quartos IS NOT NULL AND abs(x.quartos - _ref.quartos) <= 1))
       AND (_b IS NULL OR public.lead_ia_norm(x.bairro) LIKE '%' || _b || '%')
       AND (_ref.code_key IS NULL OR x.code_key <> _ref.code_key)
       AND NOT (x.code_key = ANY (_ex))
     ORDER BY 1
     LIMIT least(greatest(coalesce(_limite, 1), 1), 3)
  ) i;
  RETURN jsonb_build_object('referencia', _refj, 'itens', _itens);
END $$;

-- Só o servidor (service_role), como antes.
REVOKE ALL ON FUNCTION public.lead_ia_imoveis_parecidos(uuid, text[], numeric, numeric, text, text, integer, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_imoveis_parecidos(uuid, text[], numeric, numeric, text, text, integer, boolean, text)
  TO service_role;

COMMIT;
