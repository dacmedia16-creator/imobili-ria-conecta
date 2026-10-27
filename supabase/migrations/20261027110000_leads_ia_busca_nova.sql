-- Nicole: busca NOVA no meio da conversa (card t_5b493bc9, teste real de Denis 27/10/2026, tópico 6238).
-- Ex.: "queria ver um imóvel para o meu filho também, vocês trabalham com apartamento?". A Nicole responde,
-- faz até 3 perguntas curtas e procura no XML da PRÓPRIA imobiliária (tipo, negócio, região, faixa).
--
-- ADITIVA e SÓ LEITURA: cria uma função; não altera tabela, dado, outra função, canal nem allowlist.
-- Rollback: docs/sql/rollback/20261027110000_leads_ia_busca_nova.rollback.sql
-- Depende de 20261016200000 (remax_xml_*), 20261026170000 (lead_ia_tipo), 20261026190000 (lead_ia_num),
-- 20261027080000 (negocio, preco_aluguel, xml_url_anuncio_ok, lead_ia_reais_curto). Aplicar DEPOIS delas.
--
-- lead_ia_imoveis_busca(_conversa, _tipo, _negocio, _preco_min, _preco_max, _regiao, _cidade, _excluir, _limite)
--   MESMA imobiliária da conversa, última coleta boa do XML, mesmo negócio (venda/locação), tipo pedido
--   (null = qualquer). Região = bairro OU cidade dita pelo cliente; sem região, a cidade do imóvel do lead.
--   Preço dentro da faixa (sem faixa, sem filtro de preço). Ordem: bairro que bate, depois o preço mais perto
--   do teto (ou do meio da faixa), depois o código. Nunca devolve o imóvel do lead nem os já oferecidos.
--   Devolve {referencia:{}, itens:[...]} no mesmo formato de lead_ia_imoveis_parecidos. Sem endereço,
--   contato, disponibilidade, permuta, financiamento ou andar.
BEGIN;

CREATE OR REPLACE FUNCTION public.lead_ia_imoveis_busca(_conversa uuid, _tipo text DEFAULT NULL,
  _negocio text DEFAULT 'venda', _preco_min numeric DEFAULT NULL, _preco_max numeric DEFAULT NULL,
  _regiao text DEFAULT NULL, _cidade text DEFAULT NULL, _excluir text[] DEFAULT '{}', _limite integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _run uuid; _ex text[]; _itens jsonb; _alvo numeric;
  _r text := nullif(left(public.lead_ia_norm(btrim(coalesce(_regiao, ''))), 60), '');
  _c text := nullif(left(public.lead_ia_norm(btrim(coalesce(_cidade, ''))), 60), '');
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa;
  IF _cv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id AND organization_id = _cv.organization_id;
  IF _l.id IS NULL THEN RETURN NULL; END IF;
  IF _negocio IS NULL OR _negocio NOT IN ('venda', 'locacao') THEN RAISE EXCEPTION 'Negocio invalido' USING ERRCODE = '22023'; END IF;
  IF _tipo IS NOT NULL AND _tipo NOT IN ('apartamento', 'casa', 'terreno', 'cobertura', 'studio', 'imóvel comercial') THEN
    RAISE EXCEPTION 'Tipo invalido' USING ERRCODE = '22023';
  END IF;
  IF (_preco_min IS NOT NULL AND (_preco_min < 0 OR _preco_min > 1e11))
     OR (_preco_max IS NOT NULL AND (_preco_max <= 0 OR _preco_max > 1e11))
     OR char_length(coalesce(_regiao, '')) > 60 OR char_length(coalesce(_cidade, '')) > 60 THEN
    RAISE EXCEPTION 'Filtro invalido' USING ERRCODE = '22023';
  END IF;
  _run := (public.remax_xml_last_ok(_cv.organization_id)).id;
  IF _run IS NULL THEN RETURN jsonb_build_object('referencia', '{}'::jsonb, 'itens', '[]'::jsonb); END IF;
  _alvo := CASE WHEN _preco_max IS NOT NULL AND _preco_min IS NOT NULL THEN (_preco_min + _preco_max) / 2
                ELSE coalesce(_preco_max, _preco_min) END;
  _ex := ARRAY(SELECT public.portal_code_key(btrim(e)) FROM unnest(coalesce(_excluir, '{}')) e
                WHERE char_length(btrim(coalesce(e, ''))) BETWEEN 1 AND 60 LIMIT 20)
         || ARRAY[public.portal_code_key(coalesce(nullif(btrim(_l.anuncio_codigo), ''), '-'))]
         || ARRAY[public.portal_code_key(coalesce(nullif(btrim(_cv.dados->>'imovel_xml_codigo'), ''), '-'))];

  SELECT coalesce(jsonb_agg(i.j ORDER BY i.ord), '[]'::jsonb) INTO _itens FROM (
    SELECT row_number() OVER (ORDER BY
             coalesce(_r IS NOT NULL AND public.lead_ia_norm(x.bairro) LIKE '%' || _r || '%', false) DESC,
             abs(x.pv - coalesce(_alvo, x.pv)), x.code) AS ord,
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
             'url', CASE WHEN public.xml_url_anuncio_ok(x.url) THEN x.url END)) AS j
      FROM (SELECT y.*, CASE WHEN _negocio = 'locacao' THEN y.preco_aluguel ELSE y.preco END AS pv
              FROM public.remax_xml_listings y
             WHERE y.organization_id = _cv.organization_id AND y.last_run = _run
               AND CASE WHEN _negocio = 'locacao' THEN y.negocio IN ('locacao', 'venda_locacao')
                        ELSE y.negocio IN ('venda', 'venda_locacao') END) x
     WHERE x.pv > 0
       AND x.pv BETWEEN coalesce(_preco_min, 0) AND coalesce(_preco_max, 1e12)
       AND (_tipo IS NULL OR public.lead_ia_tipo(x.tipo) = _tipo)
       -- Região: bairro OU cidade dita pelo cliente; sem região, a cidade do imóvel do lead.
       AND CASE WHEN _r IS NOT NULL THEN public.lead_ia_norm(x.bairro) LIKE '%' || _r || '%'
                                         OR public.lead_ia_norm(btrim(x.cidade)) = _r
                WHEN _c IS NOT NULL THEN public.lead_ia_norm(btrim(x.cidade)) = _c
                ELSE true END
       AND NOT (x.code_key = ANY (_ex))
     ORDER BY 1
     LIMIT least(greatest(coalesce(_limite, 1), 1), 3)
  ) i;
  RETURN jsonb_build_object('referencia', '{}'::jsonb, 'itens', _itens);
END $$;

-- Só o servidor (service_role), como lead_ia_imoveis_parecidos.
REVOKE ALL ON FUNCTION public.lead_ia_imoveis_busca(uuid, text, text, numeric, numeric, text, text, text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_imoveis_busca(uuid, text, text, numeric, numeric, text, text, text[], integer)
  TO service_role;

COMMIT;
