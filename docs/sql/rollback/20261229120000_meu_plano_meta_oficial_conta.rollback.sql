-- Rollback de 20261229120000_meu_plano_meta_oficial_conta (t_bd480fee): volta os corpos de produção de 23/11/2026 e devolve as metas oficiais
-- limpas pela migration (só onde o plano continua sem assinatura e sem meta oficial nova).
BEGIN;

CREATE OR REPLACE FUNCTION public.metas_equipe_planos(_ano integer, _team_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.current_org_id(); _modulo boolean; _out jsonb; _uids uuid[]; _tids uuid[]; _times uuid[];
BEGIN
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  -- Permissão SEMPRE antes de ler (recusa quem não pode, mesmo sem ninguém no escopo).
  SELECT coalesce(array_agg(e.user_id), '{}'), coalesce(array_agg(e.team_id), '{}') INTO _uids, _tids
    FROM public.metas_equipe_escopo(_team_id) e;
  _times := public.metas_equipe_times();
  _modulo := public.meu_plano_modulo_ligado(_org);
  WITH esc AS (SELECT * FROM unnest(_uids, _tids) AS x(user_id, team_id))
  SELECT jsonb_build_object(
    'todas', public.metas_equipe_broker(),
    'modulo_plano', _modulo,
    'equipes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'lider_id', t.lider_id, 'lider_nome', lp.nome)
                       ORDER BY t.nome)
        FROM public.teams t LEFT JOIN public.profiles lp ON lp.id = t.lider_id
       WHERE t.organization_id = _org AND t.id = ANY (_times)
         AND (_team_id IS NULL OR t.id = _team_id)), '[]'::jsonb),
    'pessoas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', e.user_id, 'nome', pr.nome, 'avatar_url', pr.avatar_url, 'team_id', e.team_id,
               'papeis', coalesce((SELECT jsonb_agg(DISTINCT ur.role::text) FROM public.user_roles ur
                                    WHERE ur.user_id = e.user_id AND ur.organization_id = _org), '[]'::jsonb),
               'tem_plano', cp.id IS NOT NULL,
               'respostas', public.metas_respostas_meta(cp.respostas),
               'assinado_em', cp.assinado_corretor_em)
             ORDER BY pr.nome)
        FROM esc e
        JOIN public.profiles pr ON pr.id = e.user_id
        LEFT JOIN public.carreira_plano cp ON _modulo AND cp.organization_id = _org AND cp.user_id = e.user_id
                                          AND cp.ano = _ano), '[]'::jsonb))
    INTO _out;
  RETURN _out;
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

REVOKE ALL ON FUNCTION public.carreira_plano_reabrir(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_reabrir(uuid, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.metas_equipe_planos(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metas_equipe_planos(integer, uuid) TO authenticated, service_role;

UPDATE public.carreira_plano cp
   SET meta_oficial = a.payload->'meta_oficial', meta_oficial_em = (a.payload->>'meta_oficial_em')::timestamptz
  FROM public.activity_logs a
 WHERE a.acao = 'meu_plano_meta_oficial_limpa' AND a.organization_id = cp.organization_id
   AND a.payload->>'corretor_id' = cp.user_id::text AND (a.payload->>'ano')::int = cp.ano
   AND cp.assinado_corretor_em IS NULL AND cp.meta_oficial IS NULL;

COMMIT;
