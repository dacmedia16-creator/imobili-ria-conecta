-- Reversão de 20261101120000_oportunidades_encaixe_envolvidos.sql (t_6dd4a31b).
-- Volta ao comportamento de 20261014120000: todos os membros leem os pares ocultos e as captações
-- candidatas; a ingestão deixa de ligar o autor. Apaga a coluna author_profile_id (só um vínculo
-- calculado; os posts continuam). Reverter junto o front (revert do PR), senão o mural fica sem selos.
BEGIN;

DROP POLICY IF EXISTS opportunity_hidden_read ON public.opportunity_hidden_pairs;
CREATE POLICY opportunity_hidden_read ON public.opportunity_hidden_pairs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS opportunity_hidden_insert ON public.opportunity_hidden_pairs;
CREATE POLICY opportunity_hidden_insert ON public.opportunity_hidden_pairs FOR INSERT TO authenticated
  WITH CHECK (hidden_by = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.opportunity_posts p WHERE p.id = post_id AND p.organization_id = opportunity_hidden_pairs.organization_id));

CREATE OR REPLACE FUNCTION public.opportunity_capture_candidates()
RETURNS TABLE (id uuid, captor_id uuid, captor_nome text, tipo_imovel text, bairro text, municipio text, valor_imovel text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT c.id, c.captor_id, coalesce(nullif(c.broker_name, ''), p.nome),
         c.form_data->'imovel'->>'tipo_imovel', c.form_data->'imovel'->>'bairro',
         c.form_data->'imovel'->>'municipio', c.form_data->'imovel'->>'valor_imovel'
  FROM public.exclusive_captures c
  LEFT JOIN public.profiles p ON p.id = c.captor_id
  WHERE public.opportunities_enabled()
    AND c.organization_id = public.current_org_id()
    AND c.status = 'aprovada' AND c.archived_at IS NULL AND c.discarded_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.opportunity_capture_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opportunity_capture_candidates() TO authenticated, service_role;

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
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.opportunity_ingest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_ingest(uuid, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.opportunity_pair_involves_me(uuid, uuid);
DROP FUNCTION IF EXISTS public.opportunity_viewer();
DROP FUNCTION IF EXISTS public.opportunity_is_staff();
DROP FUNCTION IF EXISTS public.opportunity_phone_key(text);

DROP INDEX IF EXISTS public.opportunity_posts_author_idx;
ALTER TABLE public.opportunity_posts DROP COLUMN IF EXISTS author_profile_id;
REVOKE SELECT ON public.opportunity_posts FROM authenticated;
GRANT SELECT ON public.opportunity_posts TO authenticated;

COMMIT;
