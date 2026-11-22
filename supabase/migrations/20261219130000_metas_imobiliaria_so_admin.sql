-- Metas 2027 · Imobiliária só para admin/super_admin (cartão t_82b66d41). Consequência da regra de Denis de 22/11/2026
-- ("gestor só na própria equipe"): com 20261219120000 o gestor deixa de receber a imobiliária inteira em metas_equipe_planos,
-- e esta tela mostra a imobiliária inteira (comissão bruta, estoque). Menu e rota passam a ser só admin/dono.
-- Separada de propósito: pode ser revertida sozinha.
--
-- Rollback: supabase/rollback/20261219130000_metas_imobiliaria_so_admin.sql
-- Teste:    supabase/tests/run-gestor-so-equipe-metas-pacto-1a1.sh (mesma suíte)
BEGIN;

CREATE OR REPLACE FUNCTION public.metas_comissao_quebra(_inicio date, _fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _out jsonb;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF public.eh_so_locacao(_me) THEN RAISE EXCEPTION 'Sem acesso' USING ERRCODE = '42501'; END IF;
  IF NOT public.metas_direcao_papel(ARRAY['admin', 'super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só o administrador da imobiliária vê a comissão bruta' USING ERRCODE = '42501';
  END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  WITH canon AS (
    SELECT v.sale_id, v.data_fechamento
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _inicio AND _fim),
  d AS (
    SELECT c.sale_id, c.data_fechamento, public.calcular_distribuicao_venda(s) AS j
      FROM canon c JOIN public.sales s ON s.id = c.sale_id),
  n AS (
    SELECT d.sale_id, d.data_fechamento, d.j,
           (d.j ->> 'modalidade') = 'lancamento' AS lanc,
           (SELECT coalesce(jsonb_object_agg(e.key, coalesce((e.value #>> '{}')::numeric, 0)), '{}'::jsonb)
              FROM jsonb_each(d.j) e WHERE jsonb_typeof(e.value) = 'number') AS v,
           -- Divisão por papel (mesmos filtros de calcular_distribuicao_venda): coautores e líderes.
           (SELECT coalesce(sum(x.valor), 0) FROM public.sale_commission_extras x
             WHERE x.sale_id = d.sale_id AND x.papel IN ('corretor_captador', 'corretor_vendedor')
               AND NOT coalesce(x.sem_cadastro_confirmado, false)) AS ext_corretor,
           (SELECT coalesce(sum(x.valor), 0) FROM public.sale_commission_extras x
             WHERE x.sale_id = d.sale_id AND x.papel IN ('gestor', 'team_leader')
               AND NOT coalesce(x.sem_cadastro_confirmado, false)) AS ext_lider
      FROM d),
  q AS (
    SELECT n.sale_id, n.data_fechamento, n.lanc, coalesce((n.j ->> 'calculo_valido')::boolean, false) AS valido,
           coalesce((n.v ->> 'comissao_bruta')::numeric, 0) AS bruta,
           CASE WHEN n.lanc THEN coalesce((n.v ->> 'premio_valor')::numeric, 0) ELSE 0 END AS premio,
           CASE WHEN n.lanc THEN coalesce((n.v ->> 'saldo_imobiliaria')::numeric, 0)
                ELSE coalesce((n.v ->> 'saldo_liquido_imobiliaria')::numeric, 0) END AS imobiliaria,
           CASE WHEN n.lanc THEN n.ext_lider
                ELSE coalesce((n.v ->> 'gestores_team_leaders')::numeric, 0) END AS lideres,
           CASE WHEN n.lanc THEN 0 ELSE coalesce((n.v ->> 'indicador_captador')::numeric, 0)
                                       + coalesce((n.v ->> 'indicador_vendedor')::numeric, 0) END AS indicador,
           coalesce((n.v ->> 'parceria_externa')::numeric, 0) AS parceria,
           CASE WHEN n.lanc THEN coalesce((n.v ->> 'total_pessoas')::numeric, 0) - n.ext_lider - n.ext_corretor
                ELSE coalesce((n.v ->> 'outros_extras')::numeric, 0) - n.ext_corretor
                   + coalesce((n.v ->> 'comissoes_manuais_imobiliaria')::numeric, 0) END AS extras,
           CASE WHEN n.lanc THEN n.ext_corretor
                ELSE coalesce((n.v ->> 'liquido_captador')::numeric, 0)
                   + coalesce((n.v ->> 'liquido_vendedor')::numeric, 0) + n.ext_corretor END AS corretores,
           CASE WHEN n.lanc THEN 0 ELSE coalesce((n.v ->> 'diferenca_restante')::numeric, 0) END AS diferenca
      FROM n)
  SELECT jsonb_build_object('vendas', coalesce(jsonb_agg(jsonb_build_object(
           'sale_id', q.sale_id, 'venda_em', q.data_fechamento,
           'modalidade', CASE WHEN q.lanc THEN 'lancamento' ELSE 'padrao' END,
           'bruta', round(q.bruta, 2), 'premio', round(q.premio, 2), 'imobiliaria', round(q.imobiliaria, 2),
           'lideres', round(q.lideres, 2), 'indicador', round(q.indicador, 2), 'parceria', round(q.parceria, 2),
           'extras', round(q.extras, 2), 'corretores', round(q.corretores, 2), 'diferenca', round(q.diferenca, 2),
           'valido', q.valido)
         ORDER BY q.data_fechamento DESC, q.sale_id), '[]'::jsonb))
    INTO _out FROM q;
  RETURN _out;
END $function$;

CREATE OR REPLACE FUNCTION public.metas_imobiliaria_estoque()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _caps boolean; _run public.remax_xml_runs;
        _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; _out jsonb;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF public.eh_so_locacao(_me) THEN RAISE EXCEPTION 'Sem acesso' USING ERRCODE = '42501'; END IF;
  IF NOT public.metas_direcao_papel(ARRAY['admin', 'super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só o administrador da imobiliária vê o estoque da imobiliária' USING ERRCODE = '42501';
  END IF;
  _caps := EXISTS (SELECT 1 FROM public.organization_modules om
                    WHERE om.organization_id = _org AND om.module = 'captacao_exclusiva' AND om.enabled);
  _run := public.remax_xml_last_ok(_org);
  SELECT jsonb_build_object(
    'captacoes_ligadas', _caps,
    'exclusivas_ativas', CASE WHEN _caps THEN (
       SELECT count(*) FROM public.exclusive_captures c
        WHERE c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL AND c.archived_at IS NULL)
     END,
    'exclusivas_novas_30d', CASE WHEN _caps THEN (
       SELECT count(*) FROM public.exclusive_captures c
        WHERE c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL
          AND public.exclusive_aprovada_em(c.id) > _hoje - 30)
     END,
    'anuncios_xml', CASE WHEN _run.id IS NOT NULL THEN (
       SELECT count(*) FROM public.remax_xml_listings l WHERE l.organization_id = _org AND l.last_run = _run.id)
     END,
    'xml_em', _run.finished_at)
    INTO _out;
  RETURN _out;
END $function$;

COMMIT;
