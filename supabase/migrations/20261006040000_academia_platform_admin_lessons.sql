-- Recuperado de supabase_migrations.schema_migrations (versão 20261006040000) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Academia: admin da plataforma assiste qualquer aula (inclusive curso/aula em rascunho)
-- e salva o próprio progresso mesmo sem organização.
-- Escopo: somente schema academia. Não altera colunas, constraints, triggers, policies nem dados.
-- Para todos os demais usuários, o comportamento é idêntico ao anterior (sequencial e só publicados).
-- Rollback: 20261006040000_academia_platform_admin_lessons.down.sql (definições anteriores literais).

CREATE OR REPLACE FUNCTION academia.is_lesson_unlocked(_lesson uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _course uuid; _ids uuid[]; _idx int; _prev boolean;
BEGIN
  -- Admin da plataforma: qualquer aula existente, publicada ou não, sem sequência.
  IF academia.is_platform() THEN
    RETURN EXISTS (SELECT 1 FROM academia.lessons l WHERE l.id = _lesson);
  END IF;
  IF academia.current_org() IS NULL THEN RETURN false; END IF;
  SELECT m.course_id INTO _course FROM academia.lessons l JOIN academia.modules m ON m.id = l.module_id
   JOIN academia.courses c ON c.id = m.course_id
   WHERE l.id = _lesson AND l.is_published AND c.is_published;
  IF _course IS NULL THEN RETURN false; END IF;
  SELECT array_agg(l.id ORDER BY m.sort_order, l.sort_order, l.created_at) INTO _ids
    FROM academia.lessons l JOIN academia.modules m ON m.id = l.module_id
   WHERE m.course_id = _course AND l.is_published;
  _idx := array_position(_ids, _lesson);
  IF _idx IS NULL THEN RETURN false; END IF;
  IF _idx = 1 THEN RETURN true; END IF;
  SELECT lp.completed INTO _prev FROM academia.lesson_progress lp
   WHERE lp.user_id = auth.uid() AND lp.lesson_id = _ids[_idx - 1];
  RETURN coalesce(_prev, false);
END;
$function$;

CREATE OR REPLACE FUNCTION academia.save_progress(_lesson uuid, _percent numeric, _position integer)
 RETURNS academia.lesson_progress
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _org uuid := academia.current_org(); _pct numeric; _done boolean;
        _course uuid; _row academia.lesson_progress; _platform_no_org boolean := false;
BEGIN
  -- Admin da plataforma sem organização: grava o próprio progresso com o marcador
  -- "plataforma" (UUID nulo; organization_id não tem FK) e não cria matrícula,
  -- pois enrollments exige organização ativa (trigger set_org).
  IF _uid IS NOT NULL AND _org IS NULL AND academia.is_platform() THEN
    _org := '00000000-0000-0000-0000-000000000000'::uuid;
    _platform_no_org := true;
  END IF;
  IF _uid IS NULL OR _org IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT academia.is_lesson_unlocked(_lesson) THEN RAISE EXCEPTION 'lesson locked' USING ERRCODE = '42501'; END IF;
  _pct := greatest(0, least(100, coalesce(_percent, 0)));
  _done := _pct >= 90;
  SELECT m.course_id INTO _course FROM academia.lessons l JOIN academia.modules m ON m.id = l.module_id
   WHERE l.id = _lesson;
  IF NOT _platform_no_org THEN
    INSERT INTO academia.enrollments (organization_id, user_id, course_id, enrolled_by)
    VALUES (_org, _uid, _course, _uid) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO academia.lesson_progress AS lp
    (organization_id, user_id, lesson_id, percent, position_seconds, completed, completed_at, last_watched_at)
  VALUES (_org, _uid, _lesson, _pct, greatest(0, coalesce(_position, 0)), _done,
          CASE WHEN _done THEN now() END, now())
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET
    percent = greatest(lp.percent, excluded.percent),
    position_seconds = excluded.position_seconds,
    completed = lp.completed OR excluded.completed,
    completed_at = coalesce(lp.completed_at, CASE WHEN excluded.completed THEN now() END),
    last_watched_at = now()
  WHERE lp.last_watched_at < now() - interval '30 seconds' OR (excluded.completed AND NOT lp.completed)
  RETURNING * INTO _row;
  IF _row IS NULL THEN
    SELECT * INTO _row FROM academia.lesson_progress WHERE user_id = _uid AND lesson_id = _lesson;
  END IF;
  RETURN _row;
END;
$function$;
