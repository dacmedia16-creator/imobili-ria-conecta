-- Gestor só na PRÓPRIA equipe: Metas 2027 · Equipes, assinar/reabrir o pacto e Inteligência de gestão
-- (cartão t_82b66d41; decisão de Denis em 22/11/2026, tópico 6238, "3 sim / 4 sim"). Mesma regra do Painel da Equipe
-- (painel_equipe_permitido): admin/super_admin = imobiliária toda; gestor e Team Leader = só leads_team_or_parent.
--
-- Rollback: supabase/rollback/20261219120000_gestor_so_equipe_metas_pacto_1a1.sql
-- Teste:    supabase/tests/run-gestor-so-equipe-metas-pacto-1a1.sh (transação desfeita; SEM_MIGRATION=1 = controle negativo)
--
-- O que muda:
--   * metas_equipe_broker: só admin/super_admin (e super admin da plataforma). metas_equipe_times: gestor entra pelo
--     mesmo caminho do TL (equipes que lidera/co-lidera ou equipe-mãe); gestor sem equipe = painel vazio.
--     Efeito em metas_equipe_planos/escopo/realizado (usam as duas acima): "todas" = false para o gestor.
--   * carreira_plano_assinar_broker: gestor só assina o pacto de quem é da equipe dele (meu_plano_lider_ve).
--   * carreira_plano_reabrir: gestor com a mesma regra do TL (só a própria equipe).
--   * gestao_pode_ver (usada por gestao_pode_conduzir -> gestao_1a1_salvar/remarcar, política gestao_1a1_ler e
--     gestao_pendencias_corretor) e gestao_farol_dados: visão ampla só admin/super_admin; gestor sem equipe = vazio.
-- O que NÃO muda (de propósito): meu_plano_eh_broker (segue dizendo "gestor/admin"; agora só decide QUEM pode
-- assinar, não ONDE), carreira_plano_equipe, carreira_diario_equipe_semana, Painel da Equipe. Nenhum dado é alterado.
BEGIN;

CREATE OR REPLACE FUNCTION public.metas_equipe_broker()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(public.is_platform_super_admin(auth.uid()), false)
      OR (coalesce(public.has_any_role(auth.uid(), ARRAY['admin', 'super_admin']::public.app_role[]), false)
          AND EXISTS (SELECT 1 FROM public.user_roles r
                       WHERE r.user_id = auth.uid() AND r.organization_id = public.current_org_id()
                         AND r.role IN ('admin', 'super_admin')))
$function$;

CREATE OR REPLACE FUNCTION public.metas_equipe_times()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _times uuid[];
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF public.eh_so_locacao(_me) THEN RAISE EXCEPTION 'Sem acesso' USING ERRCODE = '42501'; END IF;
  IF public.metas_equipe_broker() THEN
    SELECT array_agg(t.id) INTO _times FROM public.teams t WHERE t.organization_id = _org;
    RETURN coalesce(_times, '{}'::uuid[]);
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _me AND r.organization_id = _org
               AND r.role IN ('gestor', 'team_leader')) THEN
    SELECT array_agg(t.id) INTO _times FROM public.teams t
     WHERE t.organization_id = _org
       AND coalesce(public.painel_equipe_permitido(t.id), false)
       AND coalesce(public.leads_team_or_parent(t.id, _me), false);
  END IF;
  -- Gestor sem equipe: painel vazio (não erro), igual ao Painel da Equipe e aos Planos 2027 (t_82b66d41).
  IF coalesce(cardinality(_times), 0) = 0
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _me AND r.organization_id = _org
                   AND r.role = 'gestor')
     AND coalesce(public.has_any_role(_me, ARRAY['gestor']::public.app_role[]), false) THEN
    RETURN '{}'::uuid[];
  END IF;
  IF coalesce(cardinality(_times), 0) = 0 THEN
    RAISE EXCEPTION 'Só gestor, administrador ou Team Leader vê o painel de metas das equipes' USING ERRCODE = '42501';
  END IF;
  RETURN _times;
END $function$;

CREATE OR REPLACE FUNCTION public.carreira_plano_assinar_broker(_corretor uuid, _ano integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid; _em timestamptz; _assin timestamptz; _achou boolean := false;
BEGIN
  _org := public.meu_plano_org_ok();
  -- t_82b66d41: admin/super_admin assinam na imobiliária toda; o gestor, só para quem é da equipe que lidera.
  IF NOT public.meu_plano_ve_imobiliaria(_me)
     AND NOT (public.meu_plano_eh_broker(_me) AND coalesce(public.meu_plano_lider_ve(_corretor), false)) THEN
    RAISE EXCEPTION 'Só o gestor da equipe do corretor ou o administrador assina como broker' USING ERRCODE = '42501';
  END IF;
  SELECT true, assinado_corretor_em INTO _achou, _assin FROM public.carreira_plano
   WHERE organization_id = _org AND user_id = _corretor AND ano = _ano FOR UPDATE;
  IF NOT coalesce(_achou, false) THEN RAISE EXCEPTION 'Plano não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF _assin IS NULL THEN RAISE EXCEPTION 'O corretor ainda não assinou o pacto' USING ERRCODE = '22023'; END IF;
  UPDATE public.carreira_plano
     SET assinado_broker_em = coalesce(assinado_broker_em, now()),
         assinado_broker_por = coalesce(assinado_broker_por, _me)
   WHERE organization_id = _org AND user_id = _corretor AND ano = _ano
  RETURNING assinado_broker_em INTO _em;
  RETURN _em;
END $function$;

CREATE OR REPLACE FUNCTION public.carreira_plano_reabrir(_corretor uuid, _ano integer, _motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _me uuid := auth.uid();
  _org uuid;
  -- Tira espaços, quebras de linha e espaços invisíveis das pontas (NBSP, zero-width).
  _mot text := regexp_replace(coalesce(_motivo, ''),
                 '^[[:space:]\u00a0\u200b\u200c\u200d\ufeff]+|[[:space:]\u00a0\u200b\u200c\u200d\ufeff]+$', '', 'g');
  _papel text;
  _plat boolean;
  _p public.carreira_plano%ROWTYPE;
BEGIN
  _org := public.meu_plano_org_ok();   -- login, usuário ativo, imobiliária e módulo ligado
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  IF _corretor IS NULL THEN RAISE EXCEPTION 'Plano não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF _corretor = _me THEN
    RAISE EXCEPTION 'Você não pode reabrir o seu próprio plano' USING ERRCODE = '42501';
  END IF;

  _plat := coalesce(public.is_platform_super_admin(_me), false);
  SELECT CASE WHEN bool_or(r.role = 'super_admin') THEN 'super_admin'
              WHEN bool_or(r.role = 'admin') THEN 'admin'
              WHEN bool_or(r.role = 'gestor') THEN 'gestor'
              WHEN bool_or(r.role = 'team_leader') THEN 'team_leader' END
    INTO _papel
    FROM public.user_roles r
   WHERE r.user_id = _me AND r.organization_id = _org
     AND r.role IN ('super_admin', 'admin', 'gestor', 'team_leader');
  -- Super admin da plataforma vale como broker (mesmo que também seja TL nesta imobiliária).
  IF _plat AND (_papel IS NULL OR _papel IN ('gestor', 'team_leader')) THEN _papel := 'plataforma'; END IF;
  -- t_82b66d41: gestor e TL só reabrem plano de quem é da equipe que lideram (admin: imobiliária toda).
  IF _papel IN ('gestor', 'team_leader') AND NOT EXISTS (
       SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
        WHERE tm.membro_id = _corretor AND t.organization_id = _org
          AND coalesce(public.leads_team_or_parent(t.id, _me), false)) THEN
    _papel := NULL;
  END IF;
  IF _papel IS NULL THEN
    RAISE EXCEPTION 'Só o gestor, o administrador ou o líder da equipe reabre o plano' USING ERRCODE = '42501';
  END IF;

  IF char_length(_mot) < 5 OR char_length(_mot) > 300 OR _mot !~ '[[:alnum:]]' THEN
    RAISE EXCEPTION 'Informe o motivo da reabertura (5 a 300 caracteres)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _p FROM public.carreira_plano
   WHERE organization_id = _org AND user_id = _corretor AND ano = _ano FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF _p.assinado_corretor_em IS NULL THEN
    RAISE EXCEPTION 'Este plano não está assinado' USING ERRCODE = '22023';
  END IF;

  -- Só as colunas de assinatura. respostas, meta_oficial e minhas_metas ficam como estão.
  UPDATE public.carreira_plano
     SET assinado_corretor_em = NULL, assinado_broker_em = NULL, assinado_broker_por = NULL
   WHERE id = _p.id;

  -- Histórico. Super admin da plataforma sem perfil nesta imobiliária: autor nulo + ator_plataforma_id
  -- (mesmo padrão de src/lib/platform-audit.server.ts; o gatilho recusa autor de outra imobiliária).
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload, organization_id)
  VALUES (
    CASE WHEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _me AND pr.organization_id = _org)
         THEN _me END,
    NULL, 'meu_plano_reaberto',
    jsonb_build_object(
      'corretor_id', _corretor, 'ano', _ano, 'motivo', _mot, 'papel', _papel,
      'ator_id', _me, 'ator_plataforma_id', CASE WHEN _papel = 'plataforma' THEN _me END,
      'assinado_corretor_em_anterior', _p.assinado_corretor_em,
      'assinado_broker_em_anterior', _p.assinado_broker_em,
      'assinado_broker_por_anterior', _p.assinado_broker_por,
      'meta_oficial_em', _p.meta_oficial_em),
    _org);

  RETURN jsonb_build_object('status', 'reaberto',
    'assinado_corretor_em_anterior', _p.assinado_corretor_em,
    'assinado_broker_em_anterior', _p.assinado_broker_em);
END $function$;

CREATE OR REPLACE FUNCTION public.gestao_pode_ver(_corretor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL OR _corretor IS NULL OR NOT coalesce(public.is_active_user(_me), false)
     OR NOT public.inteligencia_gestao_modulo_ligado(_org) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members m
                  WHERE m.organization_id = _org AND m.user_id = _corretor) THEN
    RETURN false;
  END IF;
  IF _corretor = _me THEN RETURN true; END IF;
  IF public.meu_plano_ve_imobiliaria(_me) THEN RETURN true; END IF;  -- t_82b66d41: só admin/super_admin
  RETURN EXISTS (SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
                  WHERE tm.membro_id = _corretor AND t.organization_id = _org
                    AND public.leads_team_or_parent(t.id, _me));
END $function$;

CREATE OR REPLACE FUNCTION public.gestao_farol_dados(_ano integer, _corretor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _broker boolean; _tl boolean;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _ini90 date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - 89;
  _leads boolean; _caps boolean; _reun boolean; _ids uuid[]; _res jsonb;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.inteligencia_gestao_modulo_ligado(_org) THEN
    RAISE EXCEPTION 'Inteligência de gestão não está ligada nesta imobiliária' USING ERRCODE = '42501';
  END IF;
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN
    RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023';
  END IF;
  _broker := public.meu_plano_ve_imobiliaria(_me);  -- t_82b66d41: imobiliária toda só admin/super_admin
  IF _corretor IS NOT NULL THEN
    IF NOT public.gestao_pode_ver(_corretor) THEN
      RAISE EXCEPTION 'Sem acesso a este corretor' USING ERRCODE = '42501';
    END IF;
    _ids := ARRAY[_corretor];
  ELSE
    _tl := EXISTS (SELECT 1 FROM public.teams t WHERE t.organization_id = _org AND public.leads_team_or_parent(t.id, _me));
    -- Gestor sem equipe: farol vazio (não erro), como no Painel da Equipe.
    IF NOT _broker AND NOT _tl AND NOT public.meu_plano_eh_broker(_me) THEN
      RAISE EXCEPTION 'Apenas gestor, administrador ou líder de equipe vê o farol da equipe' USING ERRCODE = '42501';
    END IF;
    SELECT coalesce(array_agg(pr.id ORDER BY pr.nome), '{}') INTO _ids
      FROM public.organization_members m
      JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
     WHERE m.organization_id = _org AND m.ativo AND pr.id <> _me
       AND CASE WHEN _broker THEN EXISTS (
                  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pr.id AND ur.organization_id = _org
                     AND ur.role IN ('corretor', 'team_leader'))
                ELSE EXISTS (
                  SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
                   WHERE tm.membro_id = pr.id AND t.organization_id = _org
                     AND public.leads_team_or_parent(t.id, _me)) END;
  END IF;

  _leads := coalesce((SELECT enabled FROM public.organization_modules WHERE organization_id = _org AND module = 'leads'), false);
  _caps := coalesce((SELECT enabled FROM public.organization_modules WHERE organization_id = _org AND module = 'captacao_exclusiva'), false);
  _reun := public.avisos_exclusividade_modulo_ligado(_org);

  WITH pessoas AS (
    SELECT pr.id, pr.nome,
      (SELECT tm.team_id FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
        WHERE tm.membro_id = pr.id AND t.organization_id = _org
        ORDER BY public.leads_team_or_parent(t.id, _me) DESC, tm.created_at LIMIT 1) AS team_id
      FROM public.profiles pr WHERE pr.id = ANY (_ids)),
  entrada AS (
    -- Entrada na equipe atual: vigência do histórico; senão, quando virou membro; sem equipe, entrada na imobiliária.
    SELECT p.id,
      coalesce(
        (SELECT max(h.vigente_de) FROM public.team_membership_history h
          WHERE h.membro_id = p.id AND h.team_id = p.team_id AND h.vigente_ate IS NULL),
        (SELECT min(tm.created_at) FROM public.team_members tm WHERE tm.membro_id = p.id AND tm.team_id = p.team_id),
        (SELECT min(m.created_at) FROM public.organization_members m WHERE m.user_id = p.id AND m.organization_id = _org)
      ) AS em
      FROM pessoas p),
  funil AS (
    -- Últimos 90 dias. "Visita (antiga)" fica de fora; captação = exclusiva aprovada pela data de assinatura
    -- (a mesma regra do Diário).
    SELECT x.uid,
      coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'ligacao'), 0)::integer AS lig,
      coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'v1'), 0)::integer AS v1,
      coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'v2'), 0)::integer AS v2
      FROM (SELECT DISTINCT unnest(_ids) AS uid
            UNION SELECT tm.membro_id FROM public.team_members tm
                   WHERE tm.team_id IN (SELECT team_id FROM pessoas) AND tm.organization_id = _org
            UNION SELECT m.user_id FROM public.organization_members m WHERE m.organization_id = _org AND m.ativo
                   AND EXISTS (SELECT 1 FROM pessoas WHERE team_id IS NULL)) x
      LEFT JOIN public.carreira_diario d ON d.user_id = x.uid AND d.organization_id = _org
       AND d.dia BETWEEN _ini90 AND _hoje AND d.tipo IN ('ligacao', 'v1', 'v2')
     GROUP BY x.uid),
  capt90 AS (
    SELECT coalesce(c.captador_original_id, c.captor_id) AS uid, count(*)::integer AS n
      FROM public.exclusive_captures c
     WHERE c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL
       AND (c.signed_on IS NULL OR c.signed_on BETWEEN _ini90 AND _hoje)
       AND coalesce(c.signed_on, public.exclusive_aprovada_em(c.id)) BETWEEN _ini90 AND _hoje
     GROUP BY 1),
  funil_cap AS (
    SELECT f.uid, f.lig, f.v1, f.v2, coalesce(c.n, 0) AS capt FROM funil f LEFT JOIN capt90 c ON c.uid = f.uid),
  ult AS (
    SELECT DISTINCT ON (g.corretor_id) g.corretor_id, g.id, g.data, g.proxima_data, g.combinados, pr.nome AS com
      FROM public.gestao_conversas_1a1 g LEFT JOIN public.profiles pr ON pr.id = g.conduzido_por
     WHERE g.organization_id = _org AND g.corretor_id = ANY (_ids)
     ORDER BY g.corretor_id, g.data DESC, g.created_at DESC)
  SELECT jsonb_build_object(
    'hoje', _hoje,
    'lead_config', CASE WHEN _leads THEN (SELECT jsonb_build_object(
        'prazo_aceite_min', c.prazo_aceite_min, 'prazo_primeira_interacao_dias', c.prazo_primeira_interacao_dias,
        'prazo_sem_interacao_dias', c.prazo_sem_interacao_dias)
        FROM public.lead_config c WHERE c.organization_id = _org) END,
    'taxas_em', (SELECT max(tx.updated_at) FROM public.carreira_taxas tx WHERE tx.organization_id = _org AND tx.user_id IS NULL),
    'pessoas', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'nome', p.nome, 'team_id', p.team_id,
      'entrou_em', ((SELECT e.em FROM entrada e WHERE e.id = p.id) AT TIME ZONE 'America/Sao_Paulo')::date,
      'metas_em', (SELECT (cp.updated_at AT TIME ZONE 'America/Sao_Paulo')::date FROM public.carreira_plano cp
                    WHERE cp.organization_id = _org AND cp.user_id = p.id AND cp.ano = _ano),
      'leads', CASE WHEN _leads THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
          'etapa', l.etapa, 'no_banco_desde', l.no_banco_desde, 'responsavel_id', l.responsavel_id,
          'atribuido_em', l.atribuido_em, 'aceito_em', l.aceito_em, 'ultima_interacao_em', l.ultima_interacao_em,
          'created_at', l.created_at))
          FROM (SELECT * FROM public.leads l WHERE l.organization_id = _org AND l.responsavel_id = p.id
                   AND l.etapa NOT IN ('ganho', 'perdido') AND l.no_banco_desde IS NULL
                 ORDER BY l.created_at LIMIT 300) l), '[]'::jsonb) END,
      'captacoes', CASE WHEN _caps THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', c.id, 'status', c.status, 'signed_on', c.signed_on,
          'prazo_dias', c.form_data->'condicoes'->>'prazo_dias_numero',
          'vendida', EXISTS (SELECT 1 FROM public.sales s WHERE s.exclusive_capture_id = c.id AND s.organization_id = _org
                               AND s.status::text IN ('contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
                                                      'ocorrencia_devolvida_gestor', 'ocorrencia_concluida')),
          'reunioes', CASE WHEN _reun THEN coalesce((SELECT jsonb_agg(r.met_on ORDER BY r.met_on)
                          FROM public.exclusive_owner_meetings r WHERE r.capture_id = c.id AND r.organization_id = _org),
                          '[]'::jsonb) END))
          FROM public.exclusive_captures c
         WHERE c.organization_id = _org AND c.captor_id = p.id AND c.status = 'aprovada'
           AND c.archived_at IS NULL AND c.discarded_at IS NULL AND c.signed_on IS NOT NULL), '[]'::jsonb) END,
      'funil90', (SELECT jsonb_build_object('ligacoes', f.lig, 'v1', f.v1, 'v2', f.v2, 'captacoes', f.capt)
                    FROM funil_cap f WHERE f.uid = p.id),
      'funil90_equipe', (SELECT jsonb_build_object('ligacoes', sum(f.lig), 'v1', sum(f.v1), 'v2', sum(f.v2),
                                                   'captacoes', sum(f.capt))
                           FROM funil_cap f
                          WHERE CASE WHEN p.team_id IS NOT NULL THEN
                                  f.uid IN (SELECT tm.membro_id FROM public.team_members tm WHERE tm.team_id = p.team_id)
                                ELSE f.uid IN (SELECT m.user_id FROM public.organization_members m
                                                WHERE m.organization_id = _org AND m.ativo) END),
      'ultima_1a1', (SELECT jsonb_build_object('id', u.id, 'data', u.data, 'proxima_data', u.proxima_data,
                                               'com', u.com, 'combinados', u.combinados)
                       FROM ult u WHERE u.corretor_id = p.id))
      ORDER BY p.nome) FROM pessoas p), '[]'::jsonb)
  ) INTO _res;
  RETURN _res;
END $function$;

COMMIT;
