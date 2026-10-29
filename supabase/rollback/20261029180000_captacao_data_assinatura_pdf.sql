-- Rollback de 20261029180000_captacao_data_assinatura_pdf (t_834c16c9): volta as 3 funções do plano/pendências à base "aprovação"
-- (definições de produção de 29/10/2026) e remove as 2 funções novas. Nenhum dado é apagado:
-- signed_on e o histórico gravados pela confirmação continuam como estão.
BEGIN;

CREATE OR REPLACE FUNCTION public.exclusive_plan_view(_capture uuid)
 RETURNS TABLE(action_id uuid, category text, label text, weight text, sort integer, in_plan boolean, prazo date, done_on date, done_by_nome text, proof_path text, proof_name text, semana smallint, semana_inicio date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.exclusive_feedback_pendencias(_dias integer DEFAULT 7)
 RETURNS TABLE(kind text, capture_id uuid, imovel text, corretor text, aprovada_em date, dias integer, listing_code text, link_id uuid, acao text, prazo date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.minhas_pendencias()
 RETURNS TABLE(kind text, capture_id uuid, imovel text, detalhe text, prazo date, dias integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH caps AS (
    SELECT c.id, c.organization_id, c.status, c.manual, c.form_data, c.signed_on,
      nullif(concat_ws(' — ', nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), ''),
        nullif(btrim(c.form_data->'imovel'->>'bairro'), '')), '') AS imovel
      FROM public.exclusive_captures c
     WHERE c.captor_id = _me AND c.organization_id = public.current_org_id()
       AND c.archived_at IS NULL AND c.discarded_at IS NULL
       AND public.exclusive_can_view(c.id, _me)),
  apr AS (SELECT caps.*, public.exclusive_aprovada_em(caps.id) AS ap FROM caps WHERE caps.status = 'aprovada'),
  docs AS (
    SELECT caps.id, array_remove(ARRAY[
      -- Todos os proprietários: 1º com o texto de antes; demais "do Nº proprietário" — t_58effd65.
      (SELECT CASE WHEN count(*) = 0 THEN NULL
                   WHEN count(*) = 1 AND min(g.n) = 1 THEN 'RG e CPF ou CNH do proprietário'
                   WHEN count(*) = 1 THEN 'RG e CPF ou CNH do ' || min(g.n) || 'º proprietário'
                   ELSE 'RG e CPF ou CNH dos proprietários ' || string_agg(g.n::text || 'º', ', ' ORDER BY g.n) END
         FROM generate_series(1, jsonb_array_length(public.exclusive_owner_list(caps.form_data))) g(n)
        WHERE NOT (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = g.n AND d.kind = 'cnh')
          OR (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = g.n AND d.kind = 'rg')
          AND EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = g.n AND d.kind = 'cpf')))),
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 0 AND d.kind = 'matricula')
        THEN 'matrícula' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 0 AND d.kind = 'iptu')
        THEN 'IPTU' END], NULL) AS falta
      FROM caps WHERE caps.status IN ('rascunho', 'devolvida') AND NOT caps.manual),
  venc AS (
    SELECT apr.*, apr.signed_on + (apr.form_data->'condicoes'->>'prazo_dias_numero')::int AS fim
      FROM apr
     WHERE apr.signed_on IS NOT NULL AND coalesce(apr.form_data->'condicoes'->>'prazo_dias_numero', '') ~ '^[0-9]{1,4}$'
       AND (apr.form_data->'condicoes'->>'prazo_dias_numero')::int > 0)
  SELECT 'devolvida'::text, caps.id, caps.imovel, 'Devolvida pela gestão: corrija e reenvie'::text, NULL::date, NULL::integer
    FROM caps WHERE caps.status = 'devolvida'
  UNION ALL
  SELECT 'documentos', docs.id, caps.imovel, 'Falta anexar: ' || array_to_string(docs.falta, ', '), NULL, NULL
    FROM docs JOIN caps ON caps.id = docs.id WHERE cardinality(docs.falta) > 0
  UNION ALL
  SELECT 'sem_anuncio', apr.id, apr.imovel, 'Aprovada sem anúncio ligado nos portais', NULL, (_hoje - apr.ap)
    FROM apr WHERE apr.ap IS NOT NULL AND _hoje - apr.ap > 7
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_listing_links l
                      WHERE l.capture_id = apr.id AND l.status IN ('ativo', 'aguardando_gestor'))
  UNION ALL
  SELECT 'atrasada', apr.id, apr.imovel,
         a.label || CASE WHEN it.sem > 0 THEN ' (Semana ' || it.sem || ')' ELSE '' END, it.prazo, (_hoje - it.prazo)
    FROM apr JOIN public.owner_feedback_actions a
      ON a.organization_id = apr.organization_id AND a.list = 'marketing' AND (apr.form_data->'dossie') ? a.id::text
    CROSS JOIN LATERAL (
      SELECT s.s AS sem,
             CASE WHEN s.s > 0 THEN apr.ap + 7 * s.s - 1 ELSE apr.ap + public.exclusive_plan_prazo_dias(a.weight) END AS prazo
        FROM public.exclusive_plan_semanas(apr.form_data, a.id) s(s)) it
   WHERE apr.ap IS NOT NULL AND it.prazo < _hoje
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_plan_done d
                      WHERE d.capture_id = apr.id AND d.action_id = a.id AND d.semana = it.sem)
  UNION ALL
  SELECT 'vencendo', venc.id, venc.imovel,
         CASE WHEN venc.fim < _hoje THEN 'Exclusividade vencida' ELSE 'Exclusividade vence em breve' END,
         venc.fim, (venc.fim - _hoje)
    FROM venc WHERE venc.fim - _hoje BETWEEN -30 AND 30;
END $function$;

DROP FUNCTION IF EXISTS public.exclusive_confirmar_data_assinatura(uuid, date, date);
DROP FUNCTION IF EXISTS public.exclusive_inicio_plano(uuid);

COMMIT;
