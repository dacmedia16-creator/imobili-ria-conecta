-- Painel da Equipe para gestor, Team Leader, líder auxiliar e admin (maquete t_941da55a aprovada
-- por Denis em 08/10/2026).
--
-- Fonte única: a mesma base da Produção por pessoa (producao_por_pessoa_dados) — o frontend aplica
-- exatamente o mesmo cálculo de pontas (producao-por-pessoa-calc), então VGV, VGC e imóveis vendidos
-- batem por construção com a Produção por pessoa filtrada pela equipe e pelo mês.
--
-- Por que SECURITY DEFINER (dono mt_1b_definer, mesmo padrão de vendas_por_regiao_todos): a RLS de
-- quem lidera só alcança parte das vendas da equipe (ex.: a venda em parceria com outra equipe em que
-- o corretor principal é de fora). A função devolve SOMENTE o recorte da equipe pedida, depois de
-- checar a permissão:
--   * admin/super_admin: qualquer equipe da própria imobiliária (escolhe no filtro);
--   * gestor/Team Leader/líder auxiliar: só a equipe que lidera ou co-lidera (leads_team_or_parent).
-- Isolamento entre imobiliárias: toda leitura filtra organization_id = current_org_id().
--
-- Regras (decisões aplicadas pelo MAX Principal com as recomendações da maquete):
--   * Equipe da pessoa = equipe vigente NA DATA DA VENDA (mesma ordem de equipe_vigencias:
--     histórico com vigência → equipe que lidera → equipe em que é líder auxiliar).
--   * Mês da venda = mês da assinatura em America/Sao_Paulo (venda_em da base canônica).
--   * Ganho do líder = vendas pessoais + comissões de líder já lançadas por venda (lider_*, gestor,
--     team_leader). Nenhum percentual automático sobre a equipe.
--   * Andamento: vendas abertas de QUALQUER mês + concluídas assinadas no mês escolhido.
--
-- Nada é gravado: só leitura. Rollback: supabase/rollback/20261008180000_painel_equipe.sql
BEGIN;

-- Quem pode abrir o painel de uma equipe.
CREATE FUNCTION public.painel_equipe_permitido(_team_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT coalesce(
    auth.uid() IS NOT NULL
    AND public.current_org_id() IS NOT NULL
    AND public.mt_1b_gate()
    AND public.is_active_user(auth.uid())
    AND EXISTS (SELECT 1 FROM public.teams t
                 WHERE t.id = _team_id AND t.organization_id = public.current_org_id())
    AND (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[])
         OR (public.has_any_role(auth.uid(), ARRAY['gestor','team_leader']::public.app_role[])
             AND public.leads_team_or_parent(_team_id, auth.uid()))),
    false)
$function$;

-- A pessoa pertence à equipe no instante informado? Mesma ordem de equipe_vigencias()/criarResolverEquipe:
-- 1) histórico com vigência; 2) equipe que lidera (se tiver membros ou cargo team_leader);
-- 3) equipe em que é líder auxiliar. Uso interno (sem EXECUTE para usuários).
CREATE FUNCTION public.painel_equipe_pertence(_user uuid, _em timestamptz, _team_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  WITH hist AS (
    SELECT h.team_id FROM public.team_membership_history h
     WHERE h.membro_id = _user
       AND (h.vigente_de IS NULL OR h.vigente_de <= _em)
       AND (h.vigente_ate IS NULL OR h.vigente_ate > _em)
     ORDER BY h.vigente_de ASC NULLS LAST
     LIMIT 1
  ), lider AS (
    SELECT t.id AS team_id FROM public.teams t
     WHERE t.lider_id = _user
       AND (EXISTS (SELECT 1 FROM public.team_members m WHERE m.team_id = t.id)
            OR public.has_role(_user, 'team_leader'::public.app_role))
     ORDER BY t.created_at
     LIMIT 1
  )
  SELECT CASE
    WHEN _user IS NULL THEN false
    WHEN EXISTS (SELECT 1 FROM hist) THEN (SELECT team_id FROM hist) = _team_id
    WHEN EXISTS (SELECT 1 FROM lider) THEN (SELECT team_id FROM lider) = _team_id
    ELSE EXISTS (SELECT 1 FROM public.team_co_leaders c WHERE c.user_id = _user AND c.team_id = _team_id)
  END
$function$;

-- Equipes que a pessoa pode abrir no painel (admin: todas da imobiliária; demais: as que lidera).
CREATE FUNCTION public.painel_equipe_equipes()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  WITH eq AS (
    SELECT t.id, t.nome, t.lider_id, p.nome AS lider_nome,
      (t.lider_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.team_co_leaders c WHERE c.team_id = t.id AND c.user_id = auth.uid())) AS minha
    FROM public.teams t
    LEFT JOIN public.profiles p ON p.id = t.lider_id
    WHERE t.organization_id = public.current_org_id()
      AND public.painel_equipe_permitido(t.id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'nome', nome, 'lider_id', lider_id, 'lider_nome', lider_nome, 'minha', minha
  ) ORDER BY minha DESC, nome), '[]'::jsonb)
  FROM eq
$function$;

-- Dados do painel de UMA equipe. _mes = qualquer dia do mês escolhido (meta e concluídas do mês);
-- vendas, parcelas e ganhos vêm de todos os meses para o frontend comparar com o mês anterior.
CREATE FUNCTION public.painel_equipe_dados(_team_id uuid, _mes date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  _org uuid := public.current_org_id();
  _uid uuid := auth.uid();
  _lider uuid;
  _eu uuid;
  _mes_de timestamptz := (date_trunc('month', _mes)::date)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  _mes_ate timestamptz := ((date_trunc('month', _mes) + interval '1 month')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  _res jsonb;
BEGIN
  IF _mes IS NULL OR NOT public.painel_equipe_permitido(_team_id) THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;

  SELECT t.lider_id INTO _lider FROM public.teams t WHERE t.id = _team_id AND t.organization_id = _org;
  -- "Quanto EU vou ganhar": quem lidera/co-lidera vê o próprio ganho; o admin vê o do líder da equipe.
  _eu := CASE
    WHEN _uid = _lider
      OR EXISTS (SELECT 1 FROM public.team_co_leaders c WHERE c.team_id = _team_id AND c.user_id = _uid)
    THEN _uid ELSE _lider END;

  WITH prod AS (
    SELECT x.r, (x.r->>'sale_id')::uuid AS sale_id, (x.r->>'concluida_em')::timestamptz AS em
    FROM jsonb_array_elements(public.producao_por_pessoa_dados()) AS x(r)
    WHERE EXISTS (SELECT 1 FROM public.sales s
                   WHERE s.id = (x.r->>'sale_id')::uuid AND s.organization_id = _org)
  ),
  part AS (
    SELECT DISTINCT p.sale_id, p.em, y.uid
    FROM prod p
    CROSS JOIN LATERAL (
      SELECT nullif(p.r->>'captador_id', '')::uuid AS uid
      UNION ALL SELECT nullif(p.r->>'vendedor_id', '')::uuid
      UNION ALL SELECT nullif(v->>'user_id', '')::uuid
        FROM jsonb_array_elements(coalesce(p.r->'vendedor_participacoes', '[]'::jsonb)) v
    ) y
    WHERE y.uid IS NOT NULL
  ),
  part_eq AS (
    SELECT sale_id, em, uid, public.painel_equipe_pertence(uid, em, _team_id) AS da_equipe FROM part
  ),
  vendas_eq AS (SELECT DISTINCT sale_id FROM part_eq WHERE da_equipe),
  membros AS (
    SELECT DISTINCT ON (m.user_id) m.user_id, m.papel
    FROM (
      SELECT _lider AS user_id, 'lider'::text AS papel, 1 AS ordem WHERE _lider IS NOT NULL
      UNION ALL SELECT c.user_id, 'co_lider', 2 FROM public.team_co_leaders c WHERE c.team_id = _team_id
      UNION ALL SELECT tm.membro_id, 'membro', 3 FROM public.team_members tm WHERE tm.team_id = _team_id
    ) m
    JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo IS TRUE
    ORDER BY m.user_id, m.ordem
  ),
  oc_atual AS (
    SELECT DISTINCT ON (o.sale_id) o.*
    FROM public.occurrences o
    WHERE o.organization_id = _org AND o.sale_id IS NOT NULL
    ORDER BY o.sale_id, o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST, o.id DESC
  ),
  -- Comissão de cada pessoa por venda. Com ocorrência: occurrence_commissions (sincronizada da venda).
  -- Sem ocorrência ainda (contrato assinado): os campos da venda e a divisão de comissão (extras).
  ganho_linhas AS (
    SELECT p.sale_id, oc.user_id, oc.papel, greatest(coalesce(oc.valor, 0), 0) AS valor
    FROM prod p
    JOIN oc_atual o ON o.sale_id = p.sale_id
    JOIN public.occurrence_commissions oc ON oc.occurrence_id = o.id
    WHERE oc.user_id IS NOT NULL AND NOT coalesce(oc.sem_cadastro_confirmado, false)
    UNION ALL
    SELECT p.sale_id, f.user_id, f.papel, greatest(coalesce(f.valor, 0), 0)
    FROM prod p
    JOIN public.sales s ON s.id = p.sale_id
    CROSS JOIN LATERAL (VALUES
      (s.corretor_captador_id, 'corretor_captador', s.valor_comissao_captador),
      (s.corretor_vendedor_id, 'corretor_vendedor', s.valor_comissao_vendedor),
      (s.lider_captador_id, 'lider_captador', s.valor_comissao_lider_captador),
      (s.lider_vendedor_id, 'lider_vendedor', s.valor_comissao_lider_vendedor),
      (s.indicador_captador_id, 'indicador_captador', s.valor_comissao_indicador_captador),
      (s.indicador_vendedor_id, 'indicador_vendedor', s.valor_comissao_indicador_vendedor)
    ) AS f(user_id, papel, valor)
    WHERE f.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM oc_atual o WHERE o.sale_id = p.sale_id)
    UNION ALL
    SELECT p.sale_id, e.user_id, e.papel, greatest(coalesce(e.valor, 0), 0)
    FROM prod p
    JOIN public.sale_commission_extras e ON e.sale_id = p.sale_id
    WHERE e.user_id IS NOT NULL AND NOT coalesce(e.sem_cadastro_confirmado, false)
      AND NOT EXISTS (SELECT 1 FROM oc_atual o WHERE o.sale_id = p.sale_id)
  ),
  ganhos AS (
    SELECT g.sale_id, g.user_id,
      coalesce(sum(g.valor) FILTER (WHERE g.papel IN
        ('corretor_captador','corretor_vendedor','indicador_captador','indicador_vendedor')), 0) AS pessoal,
      coalesce(sum(g.valor) FILTER (WHERE g.papel IN
        ('lider_captador','lider_vendedor','gestor','team_leader')), 0) AS lider,
      coalesce(sum(g.valor) FILTER (WHERE g.papel NOT IN
        ('corretor_captador','corretor_vendedor','indicador_captador','indicador_vendedor',
         'lider_captador','lider_vendedor','gestor','team_leader')), 0) AS outros
    FROM ganho_linhas g
    JOIN prod p ON p.sale_id = g.sale_id
    WHERE g.user_id = _eu
       OR (g.sale_id IN (SELECT sale_id FROM vendas_eq)
           AND public.painel_equipe_pertence(g.user_id, p.em, _team_id))
    GROUP BY g.sale_id, g.user_id
  ),
  vendas_ret AS (
    SELECT sale_id FROM vendas_eq
    UNION SELECT sale_id FROM ganhos WHERE user_id = _eu
  ),
  parcelas AS (
    SELECT o.sale_id, x.n, x.valor, x.data, x.recebido_em, x.recebido_valor
    FROM oc_atual o
    CROSS JOIN LATERAL (VALUES
      (1, o.prev_recebimento_valor, o.prev_recebimento_data, o.prev_recebimento_recebido_em, o.prev_recebimento_recebido_valor),
      (2, o.prev_recebimento2_valor, o.prev_recebimento2_data, o.prev_recebimento2_recebido_em, o.prev_recebimento2_recebido_valor),
      (3, o.prev_recebimento3_valor, o.prev_recebimento3_data, o.prev_recebimento3_recebido_em, o.prev_recebimento3_recebido_valor)
    ) AS x(n, valor, data, recebido_em, recebido_valor)
    WHERE o.sale_id IN (SELECT sale_id FROM vendas_eq)
      AND (x.valor IS NOT NULL OR x.data IS NOT NULL OR x.recebido_em IS NOT NULL)
  ),
  -- Andamento: abertas de qualquer mês + concluídas assinadas no mês escolhido.
  abertas AS (
    SELECT s.id, s.status::text AS status, s.modalidade::text AS modalidade, s.valor_negociado,
      coalesce(nullif(s.codigo_interno, ''), s.imovel_id) AS codigo, s.imovel_bairro, s.midia,
      s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id,
      coalesce(s.parceria_externa_captacao, false) OR coalesce(s.parceria_externa_venda, false) AS parceria_externa,
      p.em
    FROM public.sales s
    LEFT JOIN prod p ON p.sale_id = s.id
    WHERE s.organization_id = _org
      AND (s.status::text NOT IN ('ocorrencia_concluida', 'cancelada', 'arquivada')
           OR (s.status::text = 'ocorrencia_concluida' AND p.em >= _mes_de AND p.em < _mes_ate))
  ),
  abertas_part AS (
    -- Venda já assinada: os mesmos participantes da Produção por pessoa, na data da assinatura.
    SELECT a.id AS sale_id, pe.uid, pe.da_equipe
    FROM abertas a JOIN part_eq pe ON pe.sale_id = a.id
    WHERE a.em IS NOT NULL
    UNION
    -- Ainda sem assinatura: corretor responsável, captador, vendedor(es), na equipe de hoje.
    SELECT a.id, y.uid, public.painel_equipe_pertence(y.uid, now(), _team_id)
    FROM abertas a
    CROSS JOIN LATERAL (
      SELECT a.corretor_id AS uid
      UNION SELECT a.corretor_captador_id
      UNION SELECT a.corretor_vendedor_id
      UNION SELECT e.user_id FROM public.sale_commission_extras e
        WHERE e.sale_id = a.id AND e.papel IN ('corretor_captador', 'corretor_vendedor')
    ) y
    WHERE a.em IS NULL AND y.uid IS NOT NULL
  ),
  andamento AS (
    SELECT a.*,
      (SELECT jsonb_agg(DISTINCT ap.uid) FROM abertas_part ap WHERE ap.sale_id = a.id AND ap.da_equipe) AS membros,
      a.parceria_externa OR EXISTS (SELECT 1 FROM abertas_part ap WHERE ap.sale_id = a.id AND NOT ap.da_equipe) AS parceria,
      (SELECT max(h.created_at) FROM public.sale_status_history h WHERE h.sale_id = a.id) AS etapa_desde,
      coalesce(btrim(a.midia), '') = '' AS midia_vazia,
      (a.status IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor')
        AND NOT EXISTS (SELECT 1 FROM public.sale_documents d
                         WHERE d.sale_id = a.id AND d.tipo = 'contrato_assinado' AND d.deleted_at IS NULL)) AS contrato_faltando,
      EXISTS (SELECT 1 FROM oc_atual o WHERE o.sale_id = a.id AND (
           (coalesce(o.prev_recebimento_valor, 0) > 0 AND o.prev_recebimento_data IS NULL)
        OR (coalesce(o.prev_recebimento2_valor, 0) > 0 AND o.prev_recebimento2_data IS NULL)
        OR (coalesce(o.prev_recebimento3_valor, 0) > 0 AND o.prev_recebimento3_data IS NULL))) AS recebimento_sem_data
    FROM abertas a
    WHERE EXISTS (SELECT 1 FROM abertas_part ap WHERE ap.sale_id = a.id AND ap.da_equipe)
  ),
  envolvidos AS (
    SELECT uid FROM part WHERE sale_id IN (SELECT sale_id FROM vendas_ret)
    UNION SELECT user_id FROM membros
    UNION SELECT _eu WHERE _eu IS NOT NULL
  )
  SELECT jsonb_build_object(
    'equipe', (SELECT jsonb_build_object('id', t.id, 'nome', t.nome, 'lider_id', t.lider_id, 'lider_nome', pr.nome)
                 FROM public.teams t LEFT JOIN public.profiles pr ON pr.id = t.lider_id WHERE t.id = _team_id),
    'viewer_id', _uid,
    'eu_id', _eu,
    'membros', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'nome', pr.nome, 'papel', m.papel,
        'ultima_venda_em', (SELECT max(pa.em) FROM part pa WHERE pa.uid = m.user_id))
        ORDER BY pr.nome)
      FROM membros m JOIN public.profiles pr ON pr.id = m.user_id), '[]'::jsonb),
    'vigencias', coalesce((SELECT jsonb_agg(v.x ORDER BY v.i)
      FROM jsonb_array_elements(public.equipe_vigencias()) WITH ORDINALITY AS v(x, i)
      WHERE (v.x->>'membro_id')::uuid IN (SELECT uid FROM envolvidos)), '[]'::jsonb),
    'vendas', coalesce((SELECT jsonb_agg(p.r ORDER BY p.em) FROM prod p
      WHERE p.sale_id IN (SELECT sale_id FROM vendas_ret)), '[]'::jsonb),
    'ganhos', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'sale_id', g.sale_id, 'user_id', g.user_id, 'pessoal', g.pessoal, 'lider', g.lider, 'outros', g.outros))
      FROM ganhos g), '[]'::jsonb),
    'parcelas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'sale_id', x.sale_id, 'n', x.n, 'valor', x.valor, 'data', x.data,
        'recebido_em', x.recebido_em, 'recebido_valor', x.recebido_valor) ORDER BY x.data, x.n)
      FROM parcelas x), '[]'::jsonb),
    'andamento', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'sale_id', a.id, 'codigo', a.codigo, 'bairro', a.imovel_bairro, 'modalidade', a.modalidade,
        'valor_negociado', a.valor_negociado, 'status', a.status, 'venda_em', a.em,
        'etapa_desde', a.etapa_desde, 'membros', coalesce(a.membros, '[]'::jsonb),
        'parceria', a.parceria, 'parceria_externa', a.parceria_externa,
        'midia_vazia', a.midia_vazia, 'contrato_faltando', a.contrato_faltando,
        'recebimento_sem_data', a.recebimento_sem_data) ORDER BY a.etapa_desde NULLS LAST)
      FROM andamento a), '[]'::jsonb),
    'exclusivas', CASE WHEN public.exclusive_capture_enabled() THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'captor_id', c.captor_id, 'signed_on', c.signed_on,
        'prazo_dias', c.form_data->'condicoes'->>'prazo_dias_numero',
        'tipo', c.form_data->'imovel'->>'tipo_imovel', 'bairro', c.form_data->'imovel'->>'bairro'))
      FROM public.exclusive_captures c
      WHERE c.organization_id = _org AND c.status = 'aprovada'
        AND c.archived_at IS NULL AND c.discarded_at IS NULL
        AND c.captor_id IN (SELECT user_id FROM membros)), '[]'::jsonb) END,
    'meta', (SELECT jsonb_build_object('meta_comissao', e->'meta_comissao', 'comissao_realizada', e->'comissao_realizada')
      FROM jsonb_array_elements(coalesce(public.metas_progresso(_mes)->'equipe', '[]'::jsonb)) e
      WHERE (e->>'team_id')::uuid = _team_id LIMIT 1)
  ) INTO _res;

  RETURN _res;
END
$function$;

GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.painel_equipe_permitido(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.painel_equipe_pertence(uuid, timestamptz, uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.painel_equipe_equipes() OWNER TO mt_1b_definer;
ALTER FUNCTION public.painel_equipe_dados(uuid, date) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.painel_equipe_permitido(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.painel_equipe_pertence(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.painel_equipe_equipes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.painel_equipe_dados(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.painel_equipe_permitido(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.painel_equipe_equipes() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.painel_equipe_dados(uuid, date) TO authenticated, service_role;

COMMIT;
