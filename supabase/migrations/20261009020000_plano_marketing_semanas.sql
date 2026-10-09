-- Plano de Marketing por SEMANAS (pedido de Denis 09/10, tópico 6238; t_9a21f3e6).
--
-- O corretor escolhe, para cada ação do plano, em quais semanas vai fazê-la:
--   form_data->'plano_semanas' = { "<id da ação>": [1, 2, 3], ... }
-- Semana 1 começa na aprovação; semana N = aprovação + 7*(N-1) até aprovação + 7*N - 1; prazo = último dia.
-- As semanas vão até a última semana da exclusividade (a tela calcula; o banco aceita 1 a 104).
-- Cada semana escolhida vira um item próprio do checklist (exclusive_plan_done.semana).
--
-- Planos antigos (sem 'plano_semanas', ou ação sem semanas) continuam com o prazo automático por peso
-- (essencial 7 dias, importante 14, complementar 30): semana = 0. Nenhum dado existente é reescrito;
-- a coluna nova entra com 0 nas marcações já feitas.
-- Trava: com 'plano_semanas' presente, enviar/aprovar exige ao menos 1 semana por ação marcada.
-- Rollback: supabase/rollback/20261009020000_plano_marketing_semanas.sql
BEGIN;

-- Marcação por semana (0 = plano antigo, sem semana) --------------------------------------------------
ALTER TABLE public.exclusive_plan_done
  ADD COLUMN IF NOT EXISTS semana smallint NOT NULL DEFAULT 0 CHECK (semana BETWEEN 0 AND 104);
ALTER TABLE public.exclusive_plan_done DROP CONSTRAINT IF EXISTS exclusive_plan_done_capture_id_action_id_key;
ALTER TABLE public.exclusive_plan_done
  ADD CONSTRAINT exclusive_plan_done_capture_action_semana_key UNIQUE (capture_id, action_id, semana);

-- Semanas escolhidas para a ação (1..104, sem repetição); sem escolha válida = {0} (prazo automático).
CREATE OR REPLACE FUNCTION public.exclusive_plan_semanas(_form jsonb, _action uuid) RETURNS SETOF smallint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH w AS (
    SELECT DISTINCT x::int AS s
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(_form->'plano_semanas'->(_action::text)) = 'array'
                                          THEN _form->'plano_semanas'->(_action::text) ELSE '[]'::jsonb END) x
     WHERE x ~ '^[0-9]{1,3}$')
  SELECT s::smallint FROM w WHERE s BETWEEN 1 AND 104
  UNION ALL
  SELECT 0::smallint WHERE NOT EXISTS (SELECT 1 FROM w WHERE s BETWEEN 1 AND 104)
  ORDER BY 1
$$;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_semanas(jsonb, uuid) TO authenticated, service_role;

-- Plano obrigatório (20261008210000) + semanas: plano novo exige ao menos 1 semana em cada ação marcada.
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
    OR (EXISTS (
      SELECT 1 FROM public.owner_feedback_actions a
      WHERE a.organization_id = _org AND a.list = 'marketing' AND a.active
        AND jsonb_typeof(_form->'dossie') = 'array'
        AND (_form->'dossie') ? a.id::text)
      AND (jsonb_typeof(_form->'plano_semanas') IS DISTINCT FROM 'object' OR NOT EXISTS (
        SELECT 1 FROM public.owner_feedback_actions a
        WHERE a.organization_id = _org AND a.list = 'marketing' AND a.active
          AND jsonb_typeof(_form->'dossie') = 'array' AND (_form->'dossie') ? a.id::text
          AND NOT EXISTS (SELECT 1 FROM public.exclusive_plan_semanas(_form, a.id) s WHERE s > 0))))
$function$;

-- Checklist: um item por ação + semana (ou um por ação no plano antigo) -----------------------------
DROP FUNCTION IF EXISTS public.exclusive_plan_view(uuid);
CREATE FUNCTION public.exclusive_plan_view(_capture uuid)
RETURNS TABLE(action_id uuid, category text, label text, weight text, sort integer, in_plan boolean,
  prazo date, done_on date, done_by_nome text, proof_path text, proof_name text,
  semana smallint, semana_inicio date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _base date;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture;
  IF NOT FOUND OR NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  _base := CASE WHEN _c.status = 'aprovada' THEN public.exclusive_aprovada_em(_capture) END;
  RETURN QUERY
  WITH plano AS (
    SELECT a.id AS aid, s.s AS sem
      FROM public.owner_feedback_actions a
      CROSS JOIN LATERAL public.exclusive_plan_semanas(_c.form_data, a.id) s(s)
     WHERE a.organization_id = _c.organization_id AND a.list = 'marketing'
       AND (_c.form_data->'dossie') ? a.id::text),
  itens AS (
    SELECT p.aid, p.sem, true AS no_plano FROM plano p
    UNION ALL
    SELECT d.action_id, d.semana, false FROM public.exclusive_plan_done d
     WHERE d.capture_id = _capture
       AND NOT EXISTS (SELECT 1 FROM plano p WHERE p.aid = d.action_id AND p.sem = d.semana))
  SELECT a.id, a.category, a.label, a.weight, a.sort, i.no_plano,
         CASE WHEN i.sem > 0 THEN _base + 7 * i.sem - 1 ELSE _base + public.exclusive_plan_prazo_dias(a.weight) END,
         d.done_on, (SELECT p.nome FROM public.profiles p WHERE p.id = d.done_by), d.proof_path, d.proof_name,
         i.sem, CASE WHEN i.sem > 0 THEN _base + 7 * (i.sem - 1) END
    FROM itens i
    JOIN public.owner_feedback_actions a ON a.id = i.aid AND a.organization_id = _c.organization_id
    LEFT JOIN public.exclusive_plan_done d ON d.capture_id = _capture AND d.action_id = i.aid AND d.semana = i.sem
   ORDER BY a.sort, i.sem;
END $$;

DROP FUNCTION IF EXISTS public.exclusive_plan_mark(uuid, uuid, date, text, text);
CREATE FUNCTION public.exclusive_plan_mark(_capture uuid, _action uuid, _done_on date,
  _proof_path text DEFAULT NULL, _proof_name text DEFAULT NULL, _semana integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _label text; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _mime text; _sem smallint := coalesce(_semana, 0);
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
  IF NOT EXISTS (SELECT 1 FROM public.exclusive_plan_semanas(_c.form_data, _action) s WHERE s = _sem) THEN
    RAISE EXCEPTION 'Semana fora do Plano de Marketing desta ação';
  END IF;
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
  INSERT INTO public.exclusive_plan_done (organization_id, capture_id, action_id, semana, done_on, done_by, proof_path, proof_name)
  VALUES (_c.organization_id, _capture, _action, _sem, _done_on, auth.uid(), _proof_path, left(btrim(_proof_name), 180))
  ON CONFLICT (capture_id, action_id, semana) DO UPDATE SET done_on = EXCLUDED.done_on, done_by = EXCLUDED.done_by,
    proof_path = coalesce(EXCLUDED.proof_path, public.exclusive_plan_done.proof_path),
    proof_name = CASE WHEN EXCLUDED.proof_path IS NOT NULL THEN EXCLUDED.proof_name
                      ELSE public.exclusive_plan_done.proof_name END;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (_capture, auth.uid(), 'plano_feito',
    _label || CASE WHEN _sem > 0 THEN ' (Semana ' || _sem || ')' ELSE '' END || ' · ' || to_char(_done_on, 'DD/MM/YYYY')
    || CASE WHEN _proof_path IS NOT NULL THEN ' · com prova' ELSE '' END);
END $$;

DROP FUNCTION IF EXISTS public.exclusive_plan_unmark(uuid, uuid);
CREATE FUNCTION public.exclusive_plan_unmark(_capture uuid, _action uuid, _semana integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _d public.exclusive_plan_done%ROWTYPE; _label text;
BEGIN
  IF NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.exclusive_plan_done
   WHERE capture_id = _capture AND action_id = _action AND semana = coalesce(_semana, 0) RETURNING * INTO _d;
  IF _d.id IS NULL THEN RETURN; END IF;
  SELECT label INTO _label FROM public.owner_feedback_actions WHERE id = _action;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (_capture, auth.uid(), 'plano_desmarcado', coalesce(_label, 'ação')
    || CASE WHEN _d.semana > 0 THEN ' (Semana ' || _d.semana || ')' ELSE '' END
    || ' (marcada em ' || to_char(_d.done_on, 'DD/MM/YYYY') || ')');
END $$;

-- Plano mudou depois da aprovação (ações ou semanas): registra no histórico.
CREATE OR REPLACE FUNCTION public.exclusive_plan_change_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _add int; _rem int;
BEGIN
  IF (OLD.form_data->'dossie') IS NOT DISTINCT FROM (NEW.form_data->'dossie')
     AND (OLD.form_data->'plano_semanas') IS NOT DISTINCT FROM (NEW.form_data->'plano_semanas') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exclusive_history WHERE capture_id = NEW.id AND action = 'aprovar') THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _add FROM jsonb_array_elements_text(coalesce(NEW.form_data->'dossie', '[]')) n
   WHERE NOT coalesce(OLD.form_data->'dossie', '[]') ? n;
  SELECT count(*) INTO _rem FROM jsonb_array_elements_text(coalesce(OLD.form_data->'dossie', '[]')) o
   WHERE NOT coalesce(NEW.form_data->'dossie', '[]') ? o;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (NEW.id, coalesce(auth.uid(), NEW.captor_id), 'plano_alterado',
    format('Plano de Marketing alterado depois da aprovação: +%s / -%s ações%s (o que já foi feito fica guardado)', _add, _rem,
      CASE WHEN (OLD.form_data->'plano_semanas') IS DISTINCT FROM (NEW.form_data->'plano_semanas')
           THEN ', semanas alteradas' ELSE '' END));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_plan_change_log() FROM PUBLIC, anon, authenticated;

-- Painel do gestor: atrasada = passou do fim da semana escolhida (plano antigo: prazo por peso). ----
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
  SELECT 'atrasada', caps.id, caps.imovel, caps.corretor, caps.ap, (_hoje - it.prazo), NULL, NULL,
         a.label || CASE WHEN it.sem > 0 THEN ' (Semana ' || it.sem || ')' ELSE '' END, it.prazo
    FROM caps JOIN public.owner_feedback_actions a
      ON a.organization_id = caps.organization_id AND a.list = 'marketing' AND (caps.form_data->'dossie') ? a.id::text
    CROSS JOIN LATERAL (
      SELECT s.s AS sem,
             CASE WHEN s.s > 0 THEN caps.ap + 7 * s.s - 1 ELSE caps.ap + public.exclusive_plan_prazo_dias(a.weight) END AS prazo
        FROM public.exclusive_plan_semanas(caps.form_data, a.id) s(s)) it
   WHERE it.prazo < _hoje
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_plan_done d
                      WHERE d.capture_id = caps.id AND d.action_id = a.id AND d.semana = it.sem);
END $$;

DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY[
    'public.exclusive_plan_view(uuid)', 'public.exclusive_plan_mark(uuid, uuid, date, text, text, integer)',
    'public.exclusive_plan_unmark(uuid, uuid, integer)', 'public.exclusive_feedback_pendencias(integer)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _f);
  END LOOP;
END $$;

COMMIT;
