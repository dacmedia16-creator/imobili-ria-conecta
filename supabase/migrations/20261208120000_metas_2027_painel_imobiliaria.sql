-- Painéis de metas 2027 — ETAPA 4 (cartão t_69d29df6, Denis 20/11/2026, tópico 6238): painel da imobiliária.
-- ADITIVA: cria 1 tabela e 5 funções novas. Não altera tabela, função, policy nem dado existente.
-- Reaproveita as RPCs da etapa 3 (metas_equipe_planos / metas_equipe_realizado) para meta, realizado e ranking.
--
-- 1) metas_direcao: meta da DIREÇÃO do ano (comissão, VGV, vendas e captações; sem mês a mês por enquanto).
--    Uma linha por imobiliária e ano (UNIQUE). LEITURA: admin, gestor e Team Leader DESTA imobiliária (o papel tem
--    de ser desta imobiliária) ou super admin da plataforma. GRAVAÇÃO: só o administrador, só pela RPC
--    metas_direcao_salvar (authenticated não tem INSERT/UPDATE/DELETE na tabela). Isolamento por imobiliária e
--    usuário ativo são RESTRITIVOS. Anon sem acesso.
-- 2) metas_comissao_quebra(_inicio, _fim): quebra da comissão venda a venda, montada sobre
--    calcular_distribuicao_venda: bruta → imobiliária → líderes → indicador → parceria/extras → corretores.
--    SÓ admin/gestor desta imobiliária (o corretor e o Team Leader NÃO recebem a bruta). Mesma base de vendas de
--    meu_realizado (vendas_comerciais_canonicas, venda na assinatura, dia de SP).
-- 3) metas_imobiliaria_estoque(): estoque de hoje (exclusividades ativas, novas em 30 dias, anúncios do XML).
--    Só admin/gestor desta imobiliária.
-- Rollback: supabase/rollback/20261208120000_metas_2027_painel_imobiliaria.sql
BEGIN;

-- 1) Meta da direção ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metas_direcao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ano integer NOT NULL CHECK (ano BETWEEN 2026 AND 2100),
  meta_comissao numeric(14, 2) CHECK (meta_comissao IS NULL OR meta_comissao >= 0),
  meta_vgv numeric(16, 2) CHECK (meta_vgv IS NULL OR meta_vgv >= 0),
  meta_vendas integer CHECK (meta_vendas IS NULL OR meta_vendas BETWEEN 0 AND 1000000),
  meta_captacoes integer CHECK (meta_captacoes IS NULL OR meta_captacoes BETWEEN 0 AND 1000000),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metas_direcao_org_ano UNIQUE (organization_id, ano)
);

-- Quem chama tem um destes papéis NESTA imobiliária (ou é super admin da plataforma)? Uso interno.
-- (has_any_role sozinho aceita o papel de OUTRA imobiliária: por isso confere user_roles.organization_id.)
CREATE OR REPLACE FUNCTION public.metas_direcao_papel(_roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT auth.uid() IS NOT NULL AND public.current_org_id() IS NOT NULL
     AND coalesce(public.is_active_user(auth.uid()), false)
     AND (coalesce(public.is_platform_super_admin(auth.uid()), false)
          OR (coalesce(public.has_any_role(auth.uid(), _roles), false)
              AND EXISTS (SELECT 1 FROM public.user_roles r
                           WHERE r.user_id = auth.uid() AND r.organization_id = public.current_org_id()
                             AND r.role = ANY (_roles))))
$function$;
REVOKE ALL ON FUNCTION public.metas_direcao_papel(public.app_role[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_direcao_papel(public.app_role[]) TO service_role;

-- Leitura da meta da direção (usada na policy): admin, gestor e Team Leader desta imobiliária.
CREATE OR REPLACE FUNCTION public.metas_direcao_pode_ler()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT public.metas_direcao_papel(ARRAY['admin', 'super_admin', 'gestor', 'team_leader']::public.app_role[])
$function$;
REVOKE ALL ON FUNCTION public.metas_direcao_pode_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metas_direcao_pode_ler() TO authenticated, service_role;

ALTER TABLE public.metas_direcao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.metas_direcao FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.metas_direcao TO authenticated;      -- só leitura direta; gravação só pela RPC
GRANT ALL ON public.metas_direcao TO service_role;
DROP POLICY IF EXISTS org_isolation ON public.metas_direcao;
CREATE POLICY org_isolation ON public.metas_direcao AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
DROP POLICY IF EXISTS usuario_ativo ON public.metas_direcao;
CREATE POLICY usuario_ativo ON public.metas_direcao AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_active_user((SELECT auth.uid()))));
DROP POLICY IF EXISTS metas_direcao_ler ON public.metas_direcao;
CREATE POLICY metas_direcao_ler ON public.metas_direcao FOR SELECT TO authenticated
  USING ((SELECT public.metas_direcao_pode_ler()));

-- Gravação: só o administrador da imobiliária. Campo vazio (NULL) = "sem meta da direção neste indicador".
CREATE OR REPLACE FUNCTION public.metas_direcao_salvar(_ano integer, _comissao numeric, _vgv numeric,
                                                      _vendas integer, _captacoes integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _row public.metas_direcao;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.metas_direcao_papel(ARRAY['admin', 'super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só o administrador da imobiliária define a meta da direção' USING ERRCODE = '42501';
  END IF;
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  IF _comissao < 0 OR round(_comissao, 2) >= 1e12 OR _vgv < 0 OR round(_vgv, 2) >= 1e14
     OR _vendas < 0 OR _vendas > 1000000 OR _captacoes < 0 OR _captacoes > 1000000 THEN
    RAISE EXCEPTION 'Valor inválido na meta da direção' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.metas_direcao AS m (organization_id, ano, meta_comissao, meta_vgv, meta_vendas, meta_captacoes,
                                         updated_by)
  VALUES (_org, _ano, round(_comissao, 2), round(_vgv, 2), _vendas, _captacoes, _me)
  ON CONFLICT (organization_id, ano) DO UPDATE
     SET meta_comissao = EXCLUDED.meta_comissao, meta_vgv = EXCLUDED.meta_vgv, meta_vendas = EXCLUDED.meta_vendas,
         meta_captacoes = EXCLUDED.meta_captacoes, updated_by = _me, updated_at = now()
  RETURNING m.* INTO _row;
  RETURN jsonb_build_object('ano', _row.ano, 'meta_comissao', _row.meta_comissao, 'meta_vgv', _row.meta_vgv,
                            'meta_vendas', _row.meta_vendas, 'meta_captacoes', _row.meta_captacoes,
                            'updated_at', _row.updated_at);
END $function$;
REVOKE ALL ON FUNCTION public.metas_direcao_salvar(integer, numeric, numeric, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metas_direcao_salvar(integer, numeric, numeric, integer, integer)
  TO authenticated, service_role;

-- 2) Quebra da comissão, venda a venda (admin/gestor) ---------------------------------------------------------
-- Para cada venda válida da imobiliária no período (pela assinatura), a partir de calcular_distribuicao_venda:
--   bruta (+ prêmio no lançamento) = imobiliária + líderes + indicador + parceria + extras + corretores + diferença
--   * imobiliária = saldo líquido da imobiliária (o que fica com a casa);
--   * líderes     = gestores e Team Leaders (repasse da imobiliária);
--   * indicador   = indicador do captador + do vendedor;
--   * parceria    = parceria externa;
--   * corretores  = líquido do captador + do vendedor + outros corretores captadores/vendedores da divisão
--                   (sale_commission_extras com papel corretor_captador/corretor_vendedor);
--   * extras      = o resto dos extras + comissões manuais.
--   No lançamento, a divisão (sale_commission_extras) é separada pelo papel: gestor/TL → líderes; corretor
--   captador/vendedor → corretores; o resto → extras. Linhas "sem cadastro" entram como parceria (base).
CREATE OR REPLACE FUNCTION public.metas_comissao_quebra(_inicio date, _fim date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _out jsonb;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF public.eh_so_locacao(_me) THEN RAISE EXCEPTION 'Sem acesso' USING ERRCODE = '42501'; END IF;
  IF NOT public.metas_direcao_papel(ARRAY['admin', 'super_admin', 'gestor']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só gestor e administrador veem a comissão bruta' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.metas_comissao_quebra(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metas_comissao_quebra(date, date) TO authenticated, service_role;

-- 3) Estoque de hoje (admin/gestor) -------------------------------------------------------------------------
-- exclusivas_ativas = captações aprovadas, não arquivadas nem descartadas; novas_30d = aprovadas nos últimos 30
-- dias (SP); anuncios_xml = anúncios da última leitura boa do XML RE/MAX da imobiliária (null = sem XML).
CREATE OR REPLACE FUNCTION public.metas_imobiliaria_estoque()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _caps boolean; _run public.remax_xml_runs;
        _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; _out jsonb;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF public.eh_so_locacao(_me) THEN RAISE EXCEPTION 'Sem acesso' USING ERRCODE = '42501'; END IF;
  IF NOT public.metas_direcao_papel(ARRAY['admin', 'super_admin', 'gestor']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só gestor e administrador veem o estoque da imobiliária' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.metas_imobiliaria_estoque() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metas_imobiliaria_estoque() TO authenticated, service_role;

COMMIT;
