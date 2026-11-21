-- Rollback da 20261211120000_locacao_boletos_condominio_gas (t_a0736d87). Rodar em transação, DEPOIS de voltar o site.
-- Devolve locacao_partes e locacao_docs_grupo com o texto exato da 20261201150000 e apaga locacao_tem_gas.
-- Nenhum arquivo é apagado: boletos já anexados continuam em locacao_documentos e no bucket privado.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

CREATE OR REPLACE FUNCTION public.locacao_partes(_l public.locacoes)
RETURNS TABLE (ordem integer, parte text, grupo text, rotulo text)
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT * FROM (VALUES
    (1, 'locatario',
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'locatario_pj' ELSE 'locatario' END,
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'Locatário PJ' ELSE 'Locatário PF' END),
    (2, _l.garantia,
        CASE WHEN _l.garantia = 'fiador' AND _l.ficha->>'fiador_pessoa' = 'pj' THEN 'fiador_pj' ELSE _l.garantia END,
        CASE WHEN _l.garantia = 'fiador' THEN CASE WHEN _l.ficha->>'fiador_pessoa' = 'pj' THEN 'Fiador PJ' ELSE 'Fiador PF' END
          ELSE 'Garantia — ' || public.locacao_garantia_rotulo(_l.garantia) END),
    (3, 'proprietario',
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'proprietario_pj' ELSE 'proprietario' END,
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'Proprietário PJ' ELSE 'Proprietário PF' END),
    -- t_8f09d406: imóvel em condomínio pede a CND do condomínio (opcional, não trava).
    (4, 'condominio', 'condominio', 'Condomínio')
  ) v(ordem, parte, grupo, rotulo)
  -- t_d3e1c29f: seguro-fiança não pede documento na Documentação (apólice vai em "Seguro e condomínio").
  WHERE NOT (v.ordem = 2 AND v.parte = 'seguro_fianca')
    AND (v.ordem <> 4 OR _l.imovel_tipo = 'condominio')
$$;

CREATE OR REPLACE FUNCTION public.locacao_docs_grupo(_org uuid, _grupo text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _j jsonb; _v jsonb; _r text[];
BEGIN
  -- t_8f09d406: lista fixa do condomínio (fora das Regras); o "(opcional)" faz o item não travar.
  IF _grupo = 'condominio' THEN RETURN ARRAY['CND do condomínio (opcional)']; END IF;
  _j := (public.locacao_cfg(_org)).documentos;
  _v := _j->_grupo;
  IF right(_grupo, 3) = '_pj' AND (_v IS NULL OR jsonb_typeof(_v) <> 'array' OR jsonb_array_length(_v) = 0) THEN
    _v := _j->left(_grupo, -3);
  END IF;
  IF _v IS NULL OR jsonb_typeof(_v) <> 'array' THEN
    _r := ARRAY[]::text[];
  ELSE
    _r := coalesce((SELECT array_agg(x ORDER BY n) FROM jsonb_array_elements_text(_v) WITH ORDINALITY t(x, n)), ARRAY[]::text[]);
  END IF;
  -- t_8f09d406: comprovante de renda do locatário sempre obrigatório (qualquer garantia, inclusive seguro-fiança).
  IF _grupo = 'locatario' AND NOT EXISTS (SELECT 1 FROM unnest(_r) x WHERE x ~* 'renda' AND NOT public.locacao_doc_opcional(x)) THEN
    _r := _r || 'Comprovante de renda do locatário'::text;
  END IF;
  RETURN _r;
END $$;

DROP FUNCTION public.locacao_tem_gas(public.locacoes);

COMMIT;
