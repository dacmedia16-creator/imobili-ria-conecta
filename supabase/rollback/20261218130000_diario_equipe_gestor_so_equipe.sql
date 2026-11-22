-- Rollback de 20261218130000_diario_equipe_gestor_so_equipe.sql (t_0fe0f09f): devolve carreira_diario_equipe_semana
-- exatamente como na migration 20261108160000 (gestor via meu_plano_eh_broker vê a imobiliária toda).
BEGIN;

CREATE OR REPLACE FUNCTION public.carreira_diario_equipe_semana(_ano integer)
RETURNS TABLE(user_id uuid, nome text,
              lig_sem integer, v1_sem integer, v2_sem integer, acm_sem integer, comprador_sem integer,
              lig_mes integer, v1_mes integer, v2_mes integer, acm_mes integer, comprador_mes integer,
              antigas_mes integer, capt_mes integer, metas jsonb, respostas jsonb, ultimo_dia date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid; _broker boolean;
  _d date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _seg date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  _mes date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
BEGIN
  _org := public.meu_plano_org_ok();  -- login, usuário ativo, imobiliária ativa e módulo ligado
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN
    RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023';
  END IF;
  _broker := public.meu_plano_eh_broker(_me);
  IF NOT _broker AND NOT EXISTS (SELECT 1 FROM public.teams t
                                  WHERE t.organization_id = _org AND public.leads_team_or_parent(t.id, _me)) THEN
    RAISE EXCEPTION 'Apenas gestor, administrador ou líder de equipe vê o diário da equipe' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH pessoas AS (
    SELECT pr.id, pr.nome
      FROM public.organization_members m
      JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
     WHERE m.organization_id = _org AND m.ativo AND pr.id <> _me
       AND CASE WHEN _broker THEN EXISTS (
                  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pr.id AND ur.organization_id = _org
                     AND ur.role IN ('corretor', 'team_leader'))
                ELSE EXISTS (
                  SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
                   WHERE tm.membro_id = pr.id AND t.organization_id = _org
                     AND public.leads_team_or_parent(t.id, _me)) END),
  dia AS (
    SELECT d.user_id AS uid,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'ligacao'), 0)::integer AS lig_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'v1'), 0)::integer AS v1_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'v2'), 0)::integer AS v2_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'acm'), 0)::integer AS acm_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'visita_comprador'), 0)::integer AS comp_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'ligacao'), 0)::integer AS lig_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'v1'), 0)::integer AS v1_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'v2'), 0)::integer AS v2_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'acm'), 0)::integer AS acm_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'visita_comprador'), 0)::integer AS comp_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'visita'), 0)::integer AS ant_m,
           max(d.dia) AS ult
      FROM public.carreira_diario d
     WHERE d.organization_id = _org AND d.user_id IN (SELECT id FROM pessoas)
       AND d.dia >= least(_seg, _mes) AND d.dia <= _d
     GROUP BY d.user_id),
  cap AS (
    SELECT coalesce(c.captador_original_id, c.captor_id) AS uid, count(*)::integer AS n
      FROM public.exclusive_captures c
     WHERE c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL
       AND coalesce(c.captador_original_id, c.captor_id) IN (SELECT id FROM pessoas)
       AND (c.signed_on IS NULL OR c.signed_on BETWEEN _mes AND _d)
       AND coalesce(c.signed_on, public.exclusive_aprovada_em(c.id)) BETWEEN _mes AND _d
     GROUP BY 1)
  SELECT p.id, p.nome,
         coalesce(x.lig_s, 0), coalesce(x.v1_s, 0), coalesce(x.v2_s, 0), coalesce(x.acm_s, 0), coalesce(x.comp_s, 0),
         coalesce(x.lig_m, 0), coalesce(x.v1_m, 0), coalesce(x.v2_m, 0), coalesce(x.acm_m, 0), coalesce(x.comp_m, 0),
         coalesce(x.ant_m, 0), coalesce(c.n, 0),
         (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(cp.respostas) e WHERE e.key LIKE 'ms.%'),
         CASE WHEN _broker THEN cp.respostas END,
         x.ult
    FROM pessoas p
    LEFT JOIN dia x ON x.uid = p.id
    LEFT JOIN cap c ON c.uid = p.id
    LEFT JOIN public.carreira_plano cp ON cp.organization_id = _org AND cp.user_id = p.id AND cp.ano = _ano
   ORDER BY p.nome;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_diario_equipe_semana(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_diario_equipe_semana(integer) TO authenticated, service_role;

COMMIT;
