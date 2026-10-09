-- Rollback de 20261009020000_plano_marketing_semanas.sql (volta ao Plano com prazo por peso do PR #56).
-- ATENÇÃO: apaga as marcações feitas POR SEMANA (semana > 0) desde a publicação; exporte antes:
--   SELECT * FROM public.exclusive_plan_done WHERE semana > 0;
-- As provas no storage e o histórico da captação ficam guardados. form_data->'plano_semanas' fica no JSON
-- (ignorado pelas funções antigas). Depois, remover 20261009020000 de supabase_migrations.schema_migrations.
BEGIN;
DROP FUNCTION IF EXISTS public.exclusive_plan_view(uuid);
DROP FUNCTION IF EXISTS public.exclusive_plan_mark(uuid, uuid, date, text, text, integer);
DROP FUNCTION IF EXISTS public.exclusive_plan_unmark(uuid, uuid, integer);
DELETE FROM public.exclusive_plan_done WHERE semana > 0;
ALTER TABLE public.exclusive_plan_done DROP CONSTRAINT IF EXISTS exclusive_plan_done_capture_action_semana_key;
ALTER TABLE public.exclusive_plan_done DROP COLUMN IF EXISTS semana;
ALTER TABLE public.exclusive_plan_done
  ADD CONSTRAINT exclusive_plan_done_capture_id_action_id_key UNIQUE (capture_id, action_id);

CREATE OR REPLACE FUNCTION public.exclusive_plano_ok(_org uuid, _form jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT NOT (
      coalesce((SELECT m.enabled FROM public.organization_modules m
                WHERE m.organization_id = _org AND m.module = 'feedback_proprietario'), false)
      AND EXISTS (SELECT 1 FROM public.owner_feedback_actions a
                  WHERE a.organization_id = _org AND a.list = 'marketing' AND a.active))
    OR EXISTS (
      SELECT 1 FROM public.owner_feedback_actions a
      WHERE a.organization_id = _org AND a.list = 'marketing' AND a.active
        AND jsonb_typeof(_form->'dossie') = 'array'
        AND (_form->'dossie') ? a.id::text)
$function$;

CREATE OR REPLACE FUNCTION public.exclusive_plan_view(_capture uuid)
RETURNS TABLE(action_id uuid, category text, label text, weight text, sort integer, in_plan boolean,
  prazo date, done_on date, done_by_nome text, proof_path text, proof_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _base date;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture;
  IF NOT FOUND OR NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  _base := CASE WHEN _c.status = 'aprovada' THEN public.exclusive_aprovada_em(_capture) END;
  RETURN QUERY
  SELECT a.id, a.category, a.label, a.weight, a.sort,
         (_c.form_data->'dossie') ? a.id::text,
         _base + public.exclusive_plan_prazo_dias(a.weight),
         d.done_on, (SELECT p.nome FROM public.profiles p WHERE p.id = d.done_by), d.proof_path, d.proof_name
    FROM public.owner_feedback_actions a
    LEFT JOIN public.exclusive_plan_done d ON d.capture_id = _capture AND d.action_id = a.id
   WHERE a.organization_id = _c.organization_id AND a.list = 'marketing'
     AND (((_c.form_data->'dossie') ? a.id::text) OR d.id IS NOT NULL)
   ORDER BY a.sort;
END $$;

CREATE OR REPLACE FUNCTION public.exclusive_plan_mark(_capture uuid, _action uuid, _done_on date,
  _proof_path text DEFAULT NULL, _proof_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _label text; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _mime text;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  IF _c.status <> 'aprovada' OR _c.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'O plano é marcado depois da aprovação da captação';
  END IF;
  SELECT a.label INTO _label FROM public.owner_feedback_actions a
   WHERE a.id = _action AND a.organization_id = _c.organization_id AND a.list = 'marketing'
     AND (_c.form_data->'dossie') ? a.id::text;
  IF _label IS NULL THEN RAISE EXCEPTION 'Ação fora do Plano de Marketing desta captação'; END IF;
  IF _done_on IS NULL OR _done_on > _hoje OR _done_on < coalesce(_c.signed_on, _c.created_on_sp) - 30 THEN
    RAISE EXCEPTION 'Data inválida (não pode ser futura)';
  END IF;
  IF _proof_path IS NOT NULL THEN
    IF _proof_path !~ ('^' || _c.organization_id::text || '/' || _capture::text || '/plano/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$')
       OR nullif(btrim(coalesce(_proof_name, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Prova inválida';
    END IF;
    SELECT metadata->>'mimetype' INTO _mime FROM storage.objects
     WHERE bucket_id = 'exclusive-captures' AND name = _proof_path;
    IF NOT FOUND OR _mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
      RAISE EXCEPTION 'Arquivo da prova ausente ou formato inválido';
    END IF;
  END IF;
  INSERT INTO public.exclusive_plan_done (organization_id, capture_id, action_id, done_on, done_by, proof_path, proof_name)
  VALUES (_c.organization_id, _capture, _action, _done_on, auth.uid(), _proof_path, left(btrim(_proof_name), 180))
  ON CONFLICT (capture_id, action_id) DO UPDATE SET done_on = EXCLUDED.done_on, done_by = EXCLUDED.done_by,
    proof_path = coalesce(EXCLUDED.proof_path, public.exclusive_plan_done.proof_path),
    proof_name = CASE WHEN EXCLUDED.proof_path IS NOT NULL THEN EXCLUDED.proof_name
                      ELSE public.exclusive_plan_done.proof_name END;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (_capture, auth.uid(), 'plano_feito',
    _label || ' · ' || to_char(_done_on, 'DD/MM/YYYY') || CASE WHEN _proof_path IS NOT NULL THEN ' · com prova' ELSE '' END);
END $$;

CREATE OR REPLACE FUNCTION public.exclusive_plan_unmark(_capture uuid, _action uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _d public.exclusive_plan_done%ROWTYPE; _label text;
BEGIN
  IF NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.exclusive_plan_done WHERE capture_id = _capture AND action_id = _action RETURNING * INTO _d;
  IF _d.id IS NULL THEN RETURN; END IF;
  SELECT label INTO _label FROM public.owner_feedback_actions WHERE id = _action;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (_capture, auth.uid(), 'plano_desmarcado', coalesce(_label, 'ação') || ' (marcada em '
    || to_char(_d.done_on, 'DD/MM/YYYY') || ')');
END $$;

CREATE OR REPLACE FUNCTION public.exclusive_plan_change_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _add int; _rem int;
BEGIN
  IF (OLD.form_data->'dossie') IS NOT DISTINCT FROM (NEW.form_data->'dossie') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exclusive_history WHERE capture_id = NEW.id AND action = 'aprovar') THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _add FROM jsonb_array_elements_text(coalesce(NEW.form_data->'dossie', '[]')) n
   WHERE NOT coalesce(OLD.form_data->'dossie', '[]') ? n;
  SELECT count(*) INTO _rem FROM jsonb_array_elements_text(coalesce(OLD.form_data->'dossie', '[]')) o
   WHERE NOT coalesce(NEW.form_data->'dossie', '[]') ? o;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (NEW.id, coalesce(auth.uid(), NEW.captor_id), 'plano_alterado',
    format('Plano de Marketing alterado depois da aprovação: +%s / -%s ações (o que já foi feito fica guardado)', _add, _rem));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.exclusive_feedback_pendencias(_dias integer DEFAULT 7)
RETURNS TABLE(kind text, capture_id uuid, imovel text, corretor text, aprovada_em date, dias integer,
  listing_code text, link_id uuid, acao text, prazo date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; _d int := greatest(1, least(coalesce(_dias, 7), 90));
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['gestor','team_leader','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Somente gestor, team leader ou admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH caps AS (
    SELECT c.id, c.organization_id, c.form_data, public.exclusive_aprovada_em(c.id) AS ap,
      nullif(concat_ws(' — ', nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), ''),
        nullif(btrim(c.form_data->'imovel'->>'bairro'), '')), '') AS imovel,
      (SELECT p.nome FROM public.profiles p WHERE p.id = c.captor_id) AS corretor
      FROM public.exclusive_captures c
     WHERE c.organization_id = public.current_org_id() AND c.status = 'aprovada'
       AND c.archived_at IS NULL AND c.discarded_at IS NULL
       AND public.exclusive_is_manager(c.id, auth.uid()) AND public.exclusive_can_view(c.id, auth.uid())),
  lk AS (
    SELECT l.* FROM public.exclusive_listing_links l JOIN caps ON caps.id = l.capture_id
     WHERE l.status IN ('ativo', 'aguardando_gestor'))
  SELECT 'sem_anuncio', caps.id, caps.imovel, caps.corretor, caps.ap, (_hoje - caps.ap), NULL::text, NULL::uuid,
         NULL::text, NULL::date
    FROM caps WHERE NOT EXISTS (SELECT 1 FROM lk WHERE lk.capture_id = caps.id) AND _hoje - caps.ap > _d
  UNION ALL
  SELECT 'nao_coletado', caps.id, caps.imovel, caps.corretor, caps.ap,
         (_hoje - (lk.linked_at AT TIME ZONE 'America/Sao_Paulo')::date), lk.listing_code, lk.id, NULL, NULL
    FROM caps JOIN lk ON lk.capture_id = caps.id
   WHERE _hoje - (lk.linked_at AT TIME ZONE 'America/Sao_Paulo')::date > _d
     AND public.exclusive_listing_seen(caps.organization_id, lk.code_key) IS NULL
  UNION ALL
  SELECT 'confirmar', caps.id, caps.imovel, caps.corretor, caps.ap, NULL, lk.listing_code, lk.id,
         (SELECT p.nome FROM public.profiles p WHERE p.organization_id = caps.organization_id
            AND p.remax_id = substr(lk.code_key, 1, 9)), NULL
    FROM caps JOIN lk ON lk.capture_id = caps.id WHERE lk.status = 'aguardando_gestor'
  UNION ALL
  SELECT 'atrasada', caps.id, caps.imovel, caps.corretor, caps.ap,
         (_hoje - (caps.ap + public.exclusive_plan_prazo_dias(a.weight))), NULL, NULL, a.label,
         caps.ap + public.exclusive_plan_prazo_dias(a.weight)
    FROM caps JOIN public.owner_feedback_actions a
      ON a.organization_id = caps.organization_id AND a.list = 'marketing' AND (caps.form_data->'dossie') ? a.id::text
   WHERE caps.ap + public.exclusive_plan_prazo_dias(a.weight) < _hoje
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_plan_done d WHERE d.capture_id = caps.id AND d.action_id = a.id);
END $$;

REVOKE ALL ON FUNCTION public.exclusive_plan_change_log() FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.exclusive_plan_semanas(jsonb, uuid);
DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY[
    'public.exclusive_plan_view(uuid)', 'public.exclusive_plan_mark(uuid, uuid, date, text, text)',
    'public.exclusive_plan_unmark(uuid, uuid)', 'public.exclusive_feedback_pendencias(integer)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _f);
  END LOOP;
END $$;
COMMIT;
