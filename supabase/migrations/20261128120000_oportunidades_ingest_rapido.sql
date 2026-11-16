-- t_88f986ce (16/11/2026): opportunity_ingest mais rápido, mesmo resultado.
--
-- Problema: o UPDATE que liga o autor pelo telefone recalculava opportunity_phone_key() de TODOS os
-- membros ativos da imobiliária para CADA post do lote (~390 perfis x ~200 posts = ~77 mil chamadas),
-- levando 4-5 s contra o statement_timeout de 8 s; em 11-12/11 estourou (57014) por ~33 h.
--
-- Correção: a chave do celular de cada membro ativo é calculada UMA vez (CTE "membros"), agrupada
-- por chave, e só depois cruzada com os posts. A regra continua a mesma:
--   * só liga o autor se houver exatamente 1 membro ativo (perfil ativo + vínculo ativo na org) com
--     a mesma chave; 0 ou 2+ = sem autor (NULL);
--   * envio sem telefone válido (chave NULL) não mexe no autor já ligado;
--   * só grava quando o autor muda (IS DISTINCT FROM).
-- O resto da função (módulo desligado, lote inválido, INSERT/ON CONFLICT, retorno) não muda.
-- Rollback: docs/sql/rollback/20261128120000_oportunidades_ingest_rapido.rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.opportunity_ingest(_org uuid, _posts jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n integer;
BEGIN
  IF NOT coalesce((SELECT enabled FROM public.organization_modules
      WHERE organization_id = _org AND module = 'oportunidades'), false) THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(_posts) <> 'array' OR jsonb_array_length(_posts) > 500 THEN
    RAISE EXCEPTION 'Lote invalido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.opportunity_posts AS op
    (organization_id, source_key, kind, tipo, finalidade, bairro, valor_min, valor_max, valor, corretor, texto, posted_at)
  SELECT _org, x.source_key, x.kind, x.tipo, x.finalidade, left(x.bairro, 120), x.valor_min, x.valor_max, x.valor,
         left(regexp_replace(x.corretor, '\d', '', 'g'), 80), left(public.opportunity_clean_text(x.texto), 4000), x.posted_at
  FROM jsonb_to_recordset(_posts) AS x(source_key text, kind text, tipo text, finalidade text, bairro text,
       valor_min numeric, valor_max numeric, valor numeric, corretor text, texto text, posted_at timestamptz)
  ON CONFLICT (organization_id, source_key)
  DO UPDATE SET posted_at = greatest(op.posted_at, EXCLUDED.posted_at);
  GET DIAGNOSTICS _n = ROW_COUNT;

  -- Autor: recalculado a cada envio que traz telefone (corrige troca de celular, desligamento e
  -- celular repetido). Só liga com 1 membro ativo da imobiliária com o mesmo celular; 0 ou 2+ = sem
  -- autor. Envio sem telefone não mexe no autor já ligado. O telefone não é gravado em lugar nenhum.
  -- A chave de cada membro é calculada uma única vez (e não uma vez por post).
  WITH membros AS (
    SELECT k.chave, CASE WHEN count(*) = 1 THEN (array_agg(k.id))[1] END AS id
    FROM (
      SELECT p.id, public.opportunity_phone_key(p.telefone) AS chave
      FROM public.profiles p
      JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
      WHERE p.ativo IS TRUE
    ) k
    WHERE k.chave IS NOT NULL
    GROUP BY k.chave
  ), lote AS (
    SELECT x.source_key, public.opportunity_phone_key(x.autor_telefone) AS chave
    FROM jsonb_to_recordset(_posts) AS x(source_key text, autor_telefone text)
  )
  UPDATE public.opportunity_posts op SET author_profile_id = a.id
  FROM lote l
  LEFT JOIN membros a ON a.chave = l.chave
  WHERE op.organization_id = _org AND op.source_key = l.source_key
    AND l.chave IS NOT NULL
    AND op.author_profile_id IS DISTINCT FROM a.id;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.opportunity_ingest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_ingest(uuid, jsonb) TO service_role;

COMMIT;
