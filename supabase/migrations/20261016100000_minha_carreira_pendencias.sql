-- Minha carreira, PR 1 (card t_07d196a7; "pode executar" de Denis no tópico 6238 em 15/10/2026).
-- Duas consultas SÓ DE LEITURA, sempre do próprio usuário logado (captor_id = auth.uid()) e da
-- organização ativa (current_org_id()). Respeitam o módulo de captação (exclusive_can_view).
--   1) minhas_pendencias(): bloco "O que fazer hoje".
--      devolvida | documentos (falta RG+CPF/CNH, matrícula ou IPTU, só fluxo normal) |
--      sem_anuncio (aprovada há mais de 7 dias sem anúncio ligado) | atrasada (ação do Plano vencida) |
--      vencendo (exclusividade vence em até 30 dias ou venceu há até 30 dias).
--   2) minhas_captacoes(_dias, _min_views): bloco "Minhas captações" com números dos portais.
--      "Parado" = menos de _min_views visualizações E 0 contatos nos últimos _dias (padrão 50 / 30).
--      Só decide "parado" quando há base confiável (janela last30 ou acumulado com coleta antiga
--      para subtrair); sem base devolve parado = NULL ("sem dado"), nunca inventa número.
-- Nenhuma tabela, venda ou captação é alterada.
-- Rollback: supabase/rollback/20261016100000_minha_carreira_pendencias.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.minhas_pendencias()
RETURNS TABLE(kind text, capture_id uuid, imovel text, detalhe text, prazo date, dias integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
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
      CASE WHEN NOT (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 1 AND d.kind = 'cnh')
        OR (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 1 AND d.kind = 'rg')
        AND EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 1 AND d.kind = 'cpf')))
        THEN 'RG e CPF ou CNH do proprietário' END,
      CASE WHEN coalesce(caps.form_data->'proprietario_2', '{}'::jsonb) <> '{}'::jsonb AND NOT (
        EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 2 AND d.kind = 'cnh')
        OR (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 2 AND d.kind = 'rg')
        AND EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 2 AND d.kind = 'cpf')))
        THEN 'RG e CPF ou CNH do 2º proprietário' END,
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

CREATE OR REPLACE FUNCTION public.minhas_captacoes(_dias integer DEFAULT 30, _min_views integer DEFAULT 50)
RETURNS TABLE(capture_id uuid, imovel text, status text, listing_code text, coletado_em date,
  views integer, contacts integer, parado boolean, vence_em date, dias_restantes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _d int := greatest(7, least(coalesce(_dias, 30), 90)); _mv int := greatest(0, least(coalesce(_min_views, 50), 100000));
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH caps AS (
    SELECT c.id, c.organization_id, c.status, c.form_data, c.signed_on,
      nullif(concat_ws(' — ', nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), ''),
        nullif(btrim(c.form_data->'imovel'->>'bairro'), '')), '') AS imovel
      FROM public.exclusive_captures c
     WHERE c.captor_id = _me AND c.organization_id = public.current_org_id()
       AND c.archived_at IS NULL AND c.discarded_at IS NULL
       AND public.exclusive_can_view(c.id, _me)),
  lk AS (
    SELECT DISTINCT ON (l.capture_id) l.capture_id, l.listing_code, l.code_key, l.organization_id
      FROM public.exclusive_listing_links l JOIN caps ON caps.id = l.capture_id
     WHERE l.status IN ('ativo', 'aguardando_gestor') ORDER BY l.capture_id, l.linked_at DESC),
  -- Último snapshot válido de cada portal do anúncio.
  ult AS (
    SELECT DISTINCT ON (lk.capture_id, s.portal) lk.capture_id, s.portal, s.collected_on, s.window_kind,
           s.views, s.contacts
      FROM lk JOIN public.portal_listing_snapshots s
        ON s.organization_id = lk.organization_id AND public.portal_code_key(s.listing_code) = lk.code_key
     WHERE s.error IS NULL
     ORDER BY lk.capture_id, s.portal, s.collected_on DESC),
  -- Números do período por portal: last30 direto; acumulado = atual menos a coleta de _d dias antes.
  per AS (
    SELECT ult.capture_id, ult.collected_on,
      CASE WHEN ult.window_kind = 'last30' AND _d = 30 THEN ult.views
           WHEN ult.window_kind = 'cumulative' AND b.views IS NOT NULL THEN greatest(0, ult.views - b.views) END AS v,
      CASE WHEN ult.window_kind = 'last30' AND _d = 30 THEN ult.contacts
           WHEN ult.window_kind = 'cumulative' AND b.contacts IS NOT NULL THEN greatest(0, ult.contacts - b.contacts) END AS ct
      FROM ult JOIN lk ON lk.capture_id = ult.capture_id
      LEFT JOIN LATERAL (
        SELECT s.views, s.contacts FROM public.portal_listing_snapshots s
         WHERE s.organization_id = lk.organization_id AND public.portal_code_key(s.listing_code) = lk.code_key
           AND s.portal = ult.portal AND s.error IS NULL AND s.window_kind = 'cumulative'
           AND s.collected_on <= ult.collected_on - _d
         ORDER BY s.collected_on DESC LIMIT 1) b ON ult.window_kind = 'cumulative'),
  tot AS (
    SELECT per.capture_id, max(per.collected_on) AS coletado,
      CASE WHEN bool_and(per.v IS NOT NULL) THEN sum(per.v)::int END AS v,
      CASE WHEN bool_and(per.ct IS NOT NULL) THEN sum(per.ct)::int END AS ct
      FROM per GROUP BY per.capture_id)
  SELECT caps.id, caps.imovel, caps.status, lk.listing_code, tot.coletado, tot.v, tot.ct,
         CASE WHEN tot.v IS NULL OR tot.ct IS NULL THEN NULL ELSE (tot.v < _mv AND tot.ct = 0) END,
         venc.fim, (venc.fim - _hoje)
    FROM caps
    LEFT JOIN lk ON lk.capture_id = caps.id
    LEFT JOIN tot ON tot.capture_id = caps.id
    LEFT JOIN LATERAL (
      SELECT caps.signed_on + (caps.form_data->'condicoes'->>'prazo_dias_numero')::int AS fim
       WHERE caps.status = 'aprovada' AND caps.signed_on IS NOT NULL
         AND coalesce(caps.form_data->'condicoes'->>'prazo_dias_numero', '') ~ '^[0-9]{1,4}$'
         AND (caps.form_data->'condicoes'->>'prazo_dias_numero')::int > 0) venc ON true
   ORDER BY (caps.status = 'aprovada') DESC, venc.fim NULLS LAST, caps.imovel;
END $function$;

REVOKE ALL ON FUNCTION public.minhas_pendencias() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_pendencias() TO authenticated;
REVOKE ALL ON FUNCTION public.minhas_captacoes(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_captacoes(integer, integer) TO authenticated;

COMMIT;
