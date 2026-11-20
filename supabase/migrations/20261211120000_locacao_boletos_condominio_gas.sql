-- Locação — boletos de condomínio e gás só quando aplicável (t_a0736d87, pedido de Denis 20/11, tópico 6238).
-- CONSTRUÇÃO EM TESTE: aplicar em produção só depois da revisão do MAX Principal e do "pode publicar" de Denis.
--
-- Rollback: supabase/rollback/20261211120000_locacao_boletos_condominio_gas.sql
-- Teste:    supabase/tests/run-locacao-boletos.sh (homologação, transação desfeita; nunca produção).
--
-- O que muda (só o checklist da Documentação; nenhuma tabela, linha ou arquivo é alterado):
--  1) Parte "Condomínio" (só imóvel do tipo condomínio, como antes): passa a pedir o "Boleto do condomínio", que é
--     obrigatório e trava o envio; a "CND do condomínio (opcional)" continua opcional. Casa de rua e comercial não
--     têm essa parte: nenhum boleto de condomínio é exigido.
--  2) Parte nova "Gás": "Boleto do gás" (obrigatório) só aparece quando o corretor informou um código de gás nos dados
--     do contrato (campo imv_gas). Não aparece com o campo vazio, com "não possui"/"não tem"/"sem gás" ou quando o
--     texto diz que o gás é cobrado no condomínio (nesse caso o boleto do condomínio já cobre).
-- Funções redefinidas (o rollback devolve o texto exato da 20261201150000): locacao_partes, locacao_docs_grupo.
-- Função nova (interna, fechada ao navegador): locacao_tem_gas.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- Sinal de gás: o código de gás digitado (ou lido pela IA) nos dados do contrato.
CREATE FUNCTION public.locacao_tem_gas(_l public.locacoes) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(s.v <> '' AND s.v !~* '^(n[ãaÃA]o|sem)([[:space:]]|$)' AND s.v !~* 'condom[ií]nio', false)
    FROM (SELECT btrim(coalesce(public.locacao_contrato_valores(_l)->>'imv_gas', '')) AS v) s
$$;

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
    -- t_8f09d406 + t_a0736d87: imóvel em condomínio pede o boleto (obrigatório) e a CND (opcional).
    (4, 'condominio', 'condominio', 'Condomínio'),
    -- t_a0736d87: boleto do gás só quando há código de gás nos dados do contrato.
    (5, 'gas', 'gas', 'Gás')
  ) v(ordem, parte, grupo, rotulo)
  -- t_d3e1c29f: seguro-fiança não pede documento na Documentação (apólice vai em "Seguro e condomínio").
  WHERE NOT (v.ordem = 2 AND v.parte = 'seguro_fianca')
    AND (v.ordem <> 4 OR _l.imovel_tipo = 'condominio')
    AND (v.ordem <> 5 OR public.locacao_tem_gas(_l))
$$;

CREATE OR REPLACE FUNCTION public.locacao_docs_grupo(_org uuid, _grupo text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _j jsonb; _v jsonb; _r text[];
BEGIN
  -- Listas fixas (fora das Regras); o "(opcional)" faz o item não travar.
  -- t_8f09d406 + t_a0736d87: boleto do condomínio obrigatório, CND opcional.
  IF _grupo = 'condominio' THEN RETURN ARRAY['Boleto do condomínio', 'CND do condomínio (opcional)']; END IF;
  -- t_a0736d87: a parte "Gás" só existe quando há código de gás (locacao_tem_gas).
  IF _grupo = 'gas' THEN RETURN ARRAY['Boleto do gás']; END IF;
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

REVOKE ALL ON FUNCTION public.locacao_tem_gas(public.locacoes), public.locacao_partes(public.locacoes),
  public.locacao_docs_grupo(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
