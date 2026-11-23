-- Meu Plano 2027: a meta oficial conta na meta da equipe/imobiliária a partir do clique "Usar como minha meta
-- oficial", mesmo sem assinatura (cartão t_bd480fee; Denis 23/11/2026, tópico 6238: "Passar a contar da minha meta
-- oficial sim / Mostrar selo sim"). A regra fica no front (src/lib/metas-2027/consolidado.ts); aqui só o banco:
--
-- 1) metas_equipe_planos passa a devolver meta_oficial e meta_oficial_em (Metas 2027 · Equipes/Imobiliária).
--    Corpo, dono, SECURITY DEFINER, search_path e ACL iguais; só 2 campos a mais no JSON de cada pessoa.
-- 2) carreira_plano_reabrir também apaga meta_oficial/meta_oficial_em (guarda a anterior no histórico
--    'meu_plano_reaberto' → payload.meta_oficial_anterior). Sem isso, plano reaberto continuaria contando na meta.
--    minhas_metas (meta do "Meu mês") NÃO muda, como antes. Ao assinar de novo, o app regrava a meta oficial.
-- 3) Limpeza ÚNICA das metas fantasma já existentes: planos reabertos depois da meta gravada e ainda sem
--    assinatura (3 em 23/11, todos da Única). Antes de limpar, cada valor vai para activity_logs
--    ('meu_plano_meta_oficial_limpa'), de onde o rollback devolve.
--
-- Rollback: docs/sql/rollback/20261229120000_meu_plano_meta_oficial_conta.rollback.sql (corpos de produção de 23/11 + devolve as metas limpas).
-- Ensaio: transação desfeita (termina em raise), sem aplicar. Publicar só no pacote único com t_3d55d20c e
-- t_91ec7aa3, depois da revisão do MAX Principal.
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
               'assinado_em', cp.assinado_corretor_em,
               -- t_bd480fee: meta oficial gravada em "Usar como minha meta oficial" (conta mesmo sem assinar).
               'meta_oficial', cp.meta_oficial,
               'meta_oficial_em', cp.meta_oficial_em)
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

  -- Assinatura e meta oficial (t_bd480fee: a meta oficial conta na meta da equipe mesmo sem assinatura, então
  -- reabrir tem de tirá-la, senão fica uma "meta fantasma" contando). respostas e minhas_metas ficam como estão;
  -- a meta anterior fica no histórico abaixo.
  UPDATE public.carreira_plano
     SET assinado_corretor_em = NULL, assinado_broker_em = NULL, assinado_broker_por = NULL,
         meta_oficial = NULL, meta_oficial_em = NULL
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
      'meta_oficial_em', _p.meta_oficial_em,
      'meta_oficial_anterior', _p.meta_oficial),
    _org);

  RETURN jsonb_build_object('status', 'reaberto',
    'assinado_corretor_em_anterior', _p.assinado_corretor_em,
    'assinado_broker_em_anterior', _p.assinado_broker_em);
END $function$;

REVOKE ALL ON FUNCTION public.carreira_plano_reabrir(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_reabrir(uuid, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.metas_equipe_planos(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metas_equipe_planos(integer, uuid) TO authenticated, service_role;

-- 3) Metas fantasma de planos já reabertos: cópia no histórico e limpeza.
INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload, organization_id)
SELECT NULL, NULL, 'meu_plano_meta_oficial_limpa',
       jsonb_build_object('corretor_id', cp.user_id, 'ano', cp.ano, 'meta_oficial', cp.meta_oficial,
                          'meta_oficial_em', cp.meta_oficial_em, 'motivo', 'plano reaberto (t_bd480fee)'),
       cp.organization_id
  FROM public.carreira_plano cp
 WHERE cp.assinado_corretor_em IS NULL AND cp.meta_oficial IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.activity_logs a
                WHERE a.acao = 'meu_plano_reaberto' AND a.organization_id = cp.organization_id
                  AND a.payload->>'corretor_id' = cp.user_id::text AND (a.payload->>'ano')::int = cp.ano
                  AND (cp.meta_oficial_em IS NULL OR a.created_at >= cp.meta_oficial_em));

UPDATE public.carreira_plano cp SET meta_oficial = NULL, meta_oficial_em = NULL
 WHERE cp.id IN (SELECT cp.id
  FROM public.carreira_plano cp
 WHERE cp.assinado_corretor_em IS NULL AND cp.meta_oficial IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.activity_logs a
                WHERE a.acao = 'meu_plano_reaberto' AND a.organization_id = cp.organization_id
                  AND a.payload->>'corretor_id' = cp.user_id::text AND (a.payload->>'ano')::int = cp.ano
                  AND (cp.meta_oficial_em IS NULL OR a.created_at >= cp.meta_oficial_em)));

COMMIT;
