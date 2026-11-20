-- Painéis de metas 2027 — ETAPA 3 (cartão t_863b7590, Denis 20/11/2026, tópico 6238): painel do gestor/broker/TL.
-- ADITIVA: cria 7 funções novas. Não altera tabela, função, policy nem dado existente.
--
-- Quem vê o quê (decisão de Denis):
--   * broker = admin ou gestor com o papel NESTA imobiliária (ou super admin da plataforma): todas as equipes da
--     imobiliária, quem está sem equipe e o total da imobiliária (inclusive a produção de quem já saiu);
--   * Team Leader (papel team_leader nesta imobiliária): só a(s) equipe(s) que lidera ou co-lidera. Confere
--     painel_equipe_permitido E leads_team_or_parent (a 1ª sozinha aceita papel admin de OUTRA imobiliária);
--   * corretor e demais papéis: recusado (42501). Só-Locação: recusado (mesma trava de meu_realizado).
-- Equipe da pessoa = equipe_vigente(pessoa, agora). Meta e realizado da equipe somam as MESMAS pessoas.
-- Isolamento: toda leitura filtra organization_id = current_org_id(); equipe de outra imobiliária = "sem equipe".
--
-- 1) metas_equipe_planos(_ano, _team_id): pessoas do escopo + o plano de cada uma, devolvendo SÓ as respostas que
--    a conta da meta usa (metaDoPlano em src/lib/metas-2027) e a data de assinatura. Despesas pessoais nunca saem
--    item a item: quando a conta precisa delas (transações ou novas captações em branco), saem só as SOMAS.
-- 2) metas_equipe_realizado(_inicio, _fim, _team_id): realizado venda a venda (uma linha por pessoa e venda) e
--    captações aprovadas, com a MESMA base de meu_realizado (vendas_comerciais_canonicas + occurrence_commissions
--    sem "sem cadastro"; captação na aprovação, para o captador original). O VGV vem por linha e a regra soma
--    1 vez por venda (venda dividida conta 1 vez no VGV).
-- Rollback: supabase/rollback/20261207120000_metas_2027_painel_gestor.sql
BEGIN;

-- Número digitado no padrão brasileiro (espelho de num() em src/lib/meu-plano-2027/regras.ts). NULL = vazio/inválido.
CREATE OR REPLACE FUNCTION public.metas_num(_v jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $function$
DECLARE s text;
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) NOT IN ('number', 'string') THEN RETURN NULL; END IF;
  IF jsonb_typeof(_v) = 'number' THEN RETURN (_v #>> '{}')::numeric; END IF;
  s := regexp_replace(_v #>> '{}', 'R\$|\s|%', '', 'g');
  IF s = '' THEN RETURN NULL; END IF;
  IF position(',' IN s) > 0 THEN s := replace(replace(s, '.', ''), ',', '.');
  ELSIF s ~ '^\d{1,3}(\.\d{3})+$' THEN s := replace(s, '.', '');
  END IF;
  IF s !~ '^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$' THEN RETURN NULL; END IF;
  RETURN s::numeric;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.metas_num(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_num(jsonb) TO service_role;

-- Respostas do plano usadas na meta (espelho de respostasDaMeta em src/lib/metas-2027/painel-gestor.ts).
CREATE OR REPLACE FUNCTION public.metas_respostas_meta(_r jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
  WITH r AS (SELECT CASE WHEN jsonb_typeof(_r) = 'object' THEN _r ELSE '{}'::jsonb END AS j),
  precisa AS (  -- a conta só chega nas despesas se faltar transação de captação/venda ou novas captações
    SELECT bool_or(public.metas_num(r.j -> k) IS NULL) AS p
      FROM r, unnest(ARRAY['mt.tCapt', 'mt.tVenda', 'mt.novas']) k),
  soma AS (SELECT x.k, (SELECT sum(public.metas_num(e.value)) FROM r, jsonb_each(r.j) e WHERE e.key ~ x.re) AS v
             FROM (VALUES ('op.0', '^op\.[0-7]$'), ('on.0', '^on\.[0-5]$'), ('so.0.v', '^so\.[0-2]\.v$')) x(k, re)),
  saida AS (
    SELECT e.key AS k, e.value AS v FROM r, jsonb_each(r.j) e
     WHERE e.key ~ '^(mt\.(tCapt|tVenda|comMedia|novas)|mt\.mes\.(novas|tcapt|tvenda|com)\.([1-9]|1[0-2])|m\.(ticket|pct)|d\.ticket)$'
    UNION ALL
    SELECT e.key, e.value FROM r, precisa, jsonb_each(r.j) e
     WHERE precisa.p AND e.key ~ '^(m\.(faixa|conv)|d\.conv|es\.aliq)$'
    UNION ALL
    SELECT soma.k, to_jsonb(soma.v) FROM precisa, soma WHERE precisa.p AND soma.v IS NOT NULL)
  SELECT coalesce(jsonb_object_agg(saida.k, saida.v), '{}'::jsonb) FROM saida
$function$;
REVOKE ALL ON FUNCTION public.metas_respostas_meta(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_respostas_meta(jsonb) TO service_role;

-- Quem chama vê TODAS as equipes da imobiliária? (broker). Uso interno.
CREATE OR REPLACE FUNCTION public.metas_equipe_broker()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce(public.is_platform_super_admin(auth.uid()), false)
      OR (coalesce(public.has_any_role(auth.uid(), ARRAY['admin', 'gestor', 'super_admin']::public.app_role[]), false)
          AND EXISTS (SELECT 1 FROM public.user_roles r
                       WHERE r.user_id = auth.uid() AND r.organization_id = public.current_org_id()
                         AND r.role IN ('admin', 'gestor', 'super_admin')))
$function$;
REVOKE ALL ON FUNCTION public.metas_equipe_broker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_equipe_broker() TO service_role;

-- Equipes que quem chama pode abrir. Recusa (42501) quem não pode. Uso interno.
CREATE OR REPLACE FUNCTION public.metas_equipe_times()
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
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
               AND r.role = 'team_leader') THEN
    SELECT array_agg(t.id) INTO _times FROM public.teams t
     WHERE t.organization_id = _org
       AND coalesce(public.painel_equipe_permitido(t.id), false)
       AND coalesce(public.leads_team_or_parent(t.id, _me), false);
  END IF;
  IF coalesce(cardinality(_times), 0) = 0 THEN
    RAISE EXCEPTION 'Só gestor, administrador ou Team Leader vê o painel de metas das equipes' USING ERRCODE = '42501';
  END IF;
  RETURN _times;
END $function$;
REVOKE ALL ON FUNCTION public.metas_equipe_times() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_equipe_times() TO service_role;

-- Pessoas que quem chama pode ver: (pessoa, equipe vigente). Só colaboradores ativos com papel de venda
-- (corretor, Team Leader, gestor) nesta imobiliária. Uso interno.
CREATE OR REPLACE FUNCTION public.metas_equipe_escopo(_team_id uuid)
RETURNS TABLE(user_id uuid, team_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _org uuid := public.current_org_id(); _times uuid[]; _broker boolean;
BEGIN
  _times := public.metas_equipe_times();   -- recusa quem não pode
  _broker := public.metas_equipe_broker();
  IF _team_id IS NOT NULL AND NOT (_team_id = ANY (_times)) THEN
    RAISE EXCEPTION 'Sem acesso a esta equipe' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH gente AS (
    SELECT m.user_id, public.equipe_vigente(m.user_id, now()) AS ev
      FROM public.organization_members m
      JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
     WHERE m.organization_id = _org AND m.ativo
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = m.user_id AND ur.organization_id = _org
                     AND ur.role IN ('corretor', 'team_leader', 'gestor'))),
  g AS (SELECT gente.user_id, CASE WHEN gente.ev = ANY (_times) THEN gente.ev END AS team_id FROM gente)
  SELECT g.user_id, g.team_id
    FROM g
   WHERE (_team_id IS NULL OR g.team_id = _team_id)
     AND (_broker OR g.team_id = ANY (_times));
END $function$;
REVOKE ALL ON FUNCTION public.metas_equipe_escopo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_equipe_escopo(uuid) TO service_role;

-- 1) Plano das pessoas da equipe (ou da imobiliária) -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.metas_equipe_planos(_ano integer, _team_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
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
REVOKE ALL ON FUNCTION public.metas_equipe_planos(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metas_equipe_planos(integer, uuid) TO authenticated, service_role;

-- 2) Realizado da equipe (ou da imobiliária), venda a venda ----------------------------------------------------
-- Broker sem _team_id = imobiliária inteira (inclui quem já saiu ou não tem papel de venda, para o total bater com
-- os relatórios). TL ou equipe escolhida = só as pessoas do escopo.
CREATE OR REPLACE FUNCTION public.metas_equipe_realizado(_inicio date, _fim date, _team_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _org uuid := public.current_org_id(); _caps boolean; _out jsonb; _uids uuid[]; _todos boolean;
BEGIN
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  -- Permissão SEMPRE antes de ler (recusa quem não pode, mesmo sem venda no período).
  SELECT coalesce(array_agg(e.user_id), '{}') INTO _uids FROM public.metas_equipe_escopo(_team_id) e;
  _todos := _team_id IS NULL AND public.metas_equipe_broker();
  _caps := EXISTS (SELECT 1 FROM public.organization_modules om
                    WHERE om.organization_id = _org AND om.module = 'captacao_exclusiva' AND om.enabled);
  WITH canon AS (                 -- vendas válidas da imobiliária, pela data da assinatura (SP) — base de meu_realizado
    SELECT v.sale_id, v.data_fechamento, v.vgv_proprio, s.corretor_captador_id, s.corretor_vendedor_id
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _inicio AND _fim),
  part AS (                       -- parte de cada pessoa (mesmo filtro de participacoes_comerciais_validas)
    SELECT o.sale_id, oc.user_id, sum(oc.valor) AS valor,
           bool_or(oc.papel <> 'coordenador_lancamento') AS conta_equipe,
           bool_or(oc.papel IN ('corretor_captador', 'corretor_vendedor')) AS ponta
      FROM canon c
      JOIN public.occurrences o ON o.sale_id = c.sale_id
      JOIN public.occurrence_commissions oc ON oc.occurrence_id = o.id
     WHERE oc.user_id IS NOT NULL AND (_todos OR oc.user_id = ANY (_uids))
       AND coalesce(oc.sem_cadastro_confirmado, false) = false
     GROUP BY o.sale_id, oc.user_id),
  caps AS (
    SELECT c.id, coalesce(c.captador_original_id, c.captor_id) AS user_id, public.exclusive_aprovada_em(c.id) AS em
      FROM public.exclusive_captures c
     WHERE _caps AND c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL
       AND (_todos OR coalesce(c.captador_original_id, c.captor_id) = ANY (_uids)))
  SELECT jsonb_build_object(
    'captacoes_ligadas', _caps,
    'vendas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'sale_id', p.sale_id, 'user_id', p.user_id, 'venda_em', c.data_fechamento,
               'comissao', round(p.valor, 2), 'vgv', round(c.vgv_proprio, 2),
               -- Lados (captou = 1, vendeu = 1): mesma regra de minha_comissao_vendas (painel do corretor).
               'lados', coalesce(c.corretor_captador_id = p.user_id, false)::integer
                        + coalesce(c.corretor_vendedor_id = p.user_id, false)::integer,
               'conta_equipe', p.conta_equipe, 'ponta', p.ponta)
             ORDER BY c.data_fechamento DESC, p.sale_id, p.user_id)
        FROM part p JOIN canon c ON c.sale_id = p.sale_id), '[]'::jsonb),
    'captacoes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('capture_id', k.id, 'user_id', k.user_id, 'aprovada_em', k.em)
             ORDER BY k.em DESC, k.id)
        FROM caps k WHERE k.em BETWEEN _inicio AND _fim), '[]'::jsonb))
    INTO _out;
  RETURN _out;
END $function$;
REVOKE ALL ON FUNCTION public.metas_equipe_realizado(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metas_equipe_realizado(date, date, uuid) TO authenticated, service_role;

COMMIT;
