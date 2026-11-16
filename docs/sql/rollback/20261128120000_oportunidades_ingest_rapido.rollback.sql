-- Rollback de 20261128120000_oportunidades_ingest_rapido (t_88f986ce).
-- Volta opportunity_ingest ao texto que estava em producao em 16/11/2026
-- (pg_get_functiondef, md5 c05c093db0dbff946f4fa1530ff73bed; corpo = migration 20261101120000).
BEGIN;
CREATE OR REPLACE FUNCTION public.opportunity_ingest(_org uuid, _posts jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  UPDATE public.opportunity_posts op SET author_profile_id = a.id
  FROM jsonb_to_recordset(_posts) AS x(source_key text, autor_telefone text)
  CROSS JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN (array_agg(p.id))[1] END AS id
    FROM public.profiles p
    JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
    WHERE p.ativo IS TRUE
      AND public.opportunity_phone_key(p.telefone) = public.opportunity_phone_key(x.autor_telefone)
  ) a
  WHERE op.organization_id = _org AND op.source_key = x.source_key
    AND public.opportunity_phone_key(x.autor_telefone) IS NOT NULL
    AND op.author_profile_id IS DISTINCT FROM a.id;
  RETURN _n;
END $function$
;
REVOKE ALL ON FUNCTION public.opportunity_ingest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_ingest(uuid, jsonb) TO service_role;
COMMIT;
