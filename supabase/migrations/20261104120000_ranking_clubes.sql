-- Ranking e Clubes REMAX (card t_481a3f26; maquete v2 aprovada e "pode publicar" de Denis em 04/11/2026).
-- Regras: ranking.minharemax.com/conceitos (Comitê de Dados REMAX Brasil).
-- SÓ ADITIVA: 3 funções novas de leitura + faixas 2026 oficiais apenas nas imobiliárias que ainda não
-- têm tabela de 2026. Não altera carreira_ranking, carreira_clube, vendas, comissões, times nem permissões.
--
-- Base (ranking_clubes_base): vendas comerciais válidas da imobiliária (vendas_comerciais_canonicas,
--   data = mês da assinatura em SP) e, por venda, os corretores de cada lado:
--   lado captação = occurrence_commissions papel corretor_captador + sales.corretor_captador_id;
--   lado venda    = occurrence_commissions papel corretor_vendedor + sales.corretor_vendedor_id.
--   transação  = 1 por lado, dividida igualmente entre os corretores do lado (máx. 2 por negócio).
--   comissão   = comissão "como corretor" (papéis corretor_captador/corretor_vendedor, sem líder, gestor,
--                indicação ou coordenação), a mesma do "Como corretor" da Visão Executiva.
-- carreira_ranking_clubes(_inicio, _fim): corretores e times da imobiliária ATIVA (current_org_id).
--   comissao_ano = de 1º de janeiro até _fim (define o clube). Time = equipe vigente na data de cada venda
--   (equipe_vigente / team_membership_history); tamanho = membros vigentes no fim do período + líder.
--   Valores de colegas: visíveis com a chave "ranking_valores" ligada OU para admin/super_admin/gestor/
--   team_leader/financeiro (decisão de Denis: gestor vê a empresa toda). Senão, comissão de colega = NULL.
-- carreira_clube_selos(_ano, _mes): clube de cada pessoa (jan até o fim do mês) para o selo do Mural.
BEGIN;

-- 1) Faixas 2026 oficiais onde ainda não existe tabela de 2026 -------------------------------------
INSERT INTO public.clube_remax_faixas (organization_id, ano, ordem, nome, vgc_minimo, origem)
SELECT o.id, 2026, f.ordem, f.nome, f.minimo, 'Regra REMAX Brasil 2026'
  FROM public.organizations o
 CROSS JOIN (VALUES (1, 'Executive', 167224), (2, '100%', 334448), (3, 'Platinum', 836120),
                    (4, 'Chairman''s', 1672241), (5, 'Titan', 2508361), (6, 'Diamond', 3344482),
                    (7, 'Pinnacle', 6688963)) AS f(ordem, nome, minimo)
 WHERE NOT EXISTS (SELECT 1 FROM public.clube_remax_faixas x
                    WHERE x.organization_id = o.id AND x.ano = 2026);

-- 2) Base interna (sem acesso direto pelo app) --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ranking_clubes_base(_org uuid, _de date, _ate date)
RETURNS TABLE(sale_id uuid, dia date, venda_em timestamptz, user_id uuid, comissao numeric,
              capt numeric, venda numeric)
LANGUAGE sql STABLE SET search_path TO '' AS $function$
  WITH canon AS (
    SELECT v.sale_id, v.venda_em, v.data_fechamento AS dia
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _de AND _ate),
  com AS (
    SELECT o.sale_id, oc.user_id AS uid, sum(oc.valor) AS valor
      FROM public.occurrence_commissions oc
      JOIN public.occurrences o ON o.id = oc.occurrence_id
      JOIN canon c ON c.sale_id = o.sale_id
     WHERE oc.papel::text IN ('corretor_captador', 'corretor_vendedor')
       AND oc.user_id IS NOT NULL AND coalesce(oc.sem_cadastro_confirmado, false) = false
     GROUP BY o.sale_id, oc.user_id),
  lado AS (
    SELECT o.sale_id, oc.papel::text AS lado, oc.user_id AS uid
      FROM public.occurrence_commissions oc
      JOIN public.occurrences o ON o.id = oc.occurrence_id
      JOIN canon c ON c.sale_id = o.sale_id
     WHERE oc.papel::text IN ('corretor_captador', 'corretor_vendedor')
       AND oc.user_id IS NOT NULL AND coalesce(oc.sem_cadastro_confirmado, false) = false
    UNION
    SELECT s.id, 'corretor_captador', s.corretor_captador_id
      FROM public.sales s JOIN canon c ON c.sale_id = s.id WHERE s.corretor_captador_id IS NOT NULL
    UNION
    SELECT s.id, 'corretor_vendedor', s.corretor_vendedor_id
      FROM public.sales s JOIN canon c ON c.sale_id = s.id WHERE s.corretor_vendedor_id IS NOT NULL),
  tx AS (
    SELECT l.sale_id, l.uid,
           sum(CASE WHEN l.lado = 'corretor_captador' THEN l.fr ELSE 0 END) AS capt,
           sum(CASE WHEN l.lado = 'corretor_vendedor' THEN l.fr ELSE 0 END) AS venda
      FROM (SELECT x.*, 1.0 / count(*) OVER (PARTITION BY x.sale_id, x.lado) AS fr FROM lado x) l
     GROUP BY l.sale_id, l.uid),
  pessoa AS (
    SELECT coalesce(com.sale_id, tx.sale_id) AS sale_id, coalesce(com.uid, tx.uid) AS uid,
           coalesce(com.valor, 0) AS valor, coalesce(tx.capt, 0) AS capt, coalesce(tx.venda, 0) AS venda
      FROM com FULL JOIN tx ON tx.sale_id = com.sale_id AND tx.uid = com.uid)
  SELECT p.sale_id, c.dia, c.venda_em, p.uid, p.valor, p.capt, p.venda
    FROM pessoa p JOIN canon c ON c.sale_id = p.sale_id;
$function$;
REVOKE ALL ON FUNCTION public.ranking_clubes_base(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_clubes_base(uuid, date, date) TO service_role;

-- 3) Ranking e Clubes -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.carreira_ranking_clubes(_inicio date, _fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  _me uuid := auth.uid();
  _org uuid := public.current_org_id();
  _staff boolean;
  _ver boolean;
  _ano integer;
  _ref timestamptz;
  _faixas jsonb;
  _faixas_ano integer;
  _primeira date;
  _ini_base date;
  _corretores jsonb;
  _times jsonb;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;

  _staff := coalesce(public.has_any_role(_me,
              ARRAY['admin', 'super_admin', 'gestor', 'team_leader', 'financeiro']::public.app_role[]), false);
  _ver := _staff OR coalesce((SELECT om.enabled FROM public.organization_modules om
                               WHERE om.organization_id = _org AND om.module = 'ranking_valores'), false);
  _ano := extract(year FROM _fim)::integer;
  -- Fim do período (último instante do dia _fim em SP), limitado a agora.
  _ref := least(((_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo') - interval '1 second', now());

  SELECT max(f.ano) INTO _faixas_ano FROM public.clube_remax_faixas f
   WHERE f.organization_id = _org AND f.ano <= _ano;
  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', f.nome, 'minimo', f.vgc_minimo) ORDER BY f.vgc_minimo), '[]'::jsonb)
    INTO _faixas
    FROM public.clube_remax_faixas f
   WHERE f.organization_id = _org AND f.ano = _faixas_ano;

  _ini_base := least(_inicio, make_date(_ano, 1, 1));
  -- Primeira venda da imobiliária no ano (a previsão usa o ritmo desde que há vendas no sistema).
  SELECT min(v.data_fechamento) INTO _primeira
    FROM public.vendas_comerciais_canonicas() v JOIN public.sales s ON s.id = v.sale_id
   WHERE s.organization_id = _org AND v.data_fechamento BETWEEN make_date(_ano, 1, 1) AND _fim;

  WITH _rc_base AS (SELECT * FROM public.ranking_clubes_base(_org, _ini_base, _fim)),
  ap AS (
    SELECT b.user_id AS uid,
           sum(b.comissao) FILTER (WHERE b.dia >= _inicio) AS cp,
           sum(b.comissao) FILTER (WHERE b.dia >= make_date(_ano, 1, 1)) AS ca,
           sum(b.capt) FILTER (WHERE b.dia >= _inicio) AS capt,
           sum(b.venda) FILTER (WHERE b.dia >= _inicio) AS vend
      FROM _rc_base b GROUP BY b.user_id),
  tam AS (
    SELECT t.id, t.nome,
           (SELECT count(*) FROM (
              SELECT h.membro_id FROM public.team_membership_history h
               WHERE h.team_id = t.id AND h.vigente_de <= _ref
                 AND (h.vigente_ate IS NULL OR h.vigente_ate > _ref)
              UNION SELECT t.lider_id WHERE t.lider_id IS NOT NULL) z)::integer AS n
      FROM public.teams t WHERE t.organization_id = _org)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', a.uid, 'nome', coalesce(pr.nome, 'Corretor'), 'avatar_url', pr.avatar_url,
           'eu', a.uid = _me,
           'comissao', CASE WHEN _ver OR a.uid = _me THEN round(coalesce(a.cp, 0), 2) END,
           'comissao_ano', CASE WHEN _ver OR a.uid = _me THEN round(coalesce(a.ca, 0), 2) END,
           'capt', round(coalesce(a.capt, 0), 2), 'venda', round(coalesce(a.vend, 0), 2),
           'team_id', tm.id, 'team_nome', tm.nome, 'tamanho_time', tm.n)
         ORDER BY coalesce(a.cp, 0) DESC, coalesce(a.capt, 0) + coalesce(a.vend, 0) DESC, pr.nome), '[]'::jsonb)
    INTO _corretores
    FROM ap a
    JOIN public.profiles pr ON pr.id = a.uid
    LEFT JOIN tam tm ON tm.id = public.equipe_vigente(a.uid, _ref)
   WHERE coalesce(a.cp, 0) <> 0 OR coalesce(a.capt, 0) + coalesce(a.vend, 0) > 0;

  WITH bt AS (
    SELECT public.equipe_vigente(b.user_id, b.venda_em) AS team_id, b.*
      FROM public.ranking_clubes_base(_org, _ini_base, _fim) b),
  tp AS (
    SELECT bt.team_id,
           sum(bt.comissao) FILTER (WHERE bt.dia >= _inicio) AS cp,
           sum(bt.comissao) FILTER (WHERE bt.dia >= make_date(_ano, 1, 1)) AS ca,
           sum(bt.capt) FILTER (WHERE bt.dia >= _inicio) AS capt,
           sum(bt.venda) FILTER (WHERE bt.dia >= _inicio) AS vend
      FROM bt WHERE bt.team_id IS NOT NULL GROUP BY bt.team_id),
  tam AS (
    SELECT t.id, t.nome,
           (SELECT count(*) FROM (
              SELECT h.membro_id FROM public.team_membership_history h
               WHERE h.team_id = t.id AND h.vigente_de <= _ref
                 AND (h.vigente_ate IS NULL OR h.vigente_ate > _ref)
              UNION SELECT t.lider_id WHERE t.lider_id IS NOT NULL) z)::integer AS n
      FROM public.teams t WHERE t.organization_id = _org)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'team_id', tm.id, 'nome', tm.nome, 'tamanho_time', tm.n,
           'comissao', CASE WHEN _ver THEN round(coalesce(tp.cp, 0), 2) END,
           'comissao_ano', CASE WHEN _ver THEN round(coalesce(tp.ca, 0), 2) END,
           'capt', round(coalesce(tp.capt, 0), 2), 'venda', round(coalesce(tp.vend, 0), 2))
         ORDER BY coalesce(tp.cp, 0) DESC, coalesce(tp.capt, 0) + coalesce(tp.vend, 0) DESC, tm.nome), '[]'::jsonb)
    INTO _times
    FROM tp JOIN tam tm ON tm.id = tp.team_id
   WHERE coalesce(tp.cp, 0) <> 0 OR coalesce(tp.capt, 0) + coalesce(tp.vend, 0) > 0;

  RETURN jsonb_build_object(
    'inicio', _inicio, 'fim', _fim, 'ano', _ano,
    'valores_visiveis', _ver, 'staff', _staff,
    'faixas', _faixas, 'faixas_ano', _faixas_ano, 'primeira_venda', _primeira,
    'corretores', _corretores, 'times', _times);
END $function$;
REVOKE ALL ON FUNCTION public.carreira_ranking_clubes(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_ranking_clubes(date, date) TO authenticated, service_role;

-- 4) Selo do clube no Mural -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.carreira_clube_selos(_ano integer, _mes integer)
RETURNS TABLE(user_id uuid, clube text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE
  _me uuid := auth.uid();
  _org uuid := public.current_org_id();
  _ver boolean;
  _fa integer;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF _ano IS NULL OR _mes IS NULL OR _ano < 2000 OR _ano > 2100 OR _mes < 1 OR _mes > 12 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  _ver := coalesce(public.has_any_role(_me,
            ARRAY['admin', 'super_admin', 'gestor', 'team_leader', 'financeiro']::public.app_role[]), false)
          OR coalesce((SELECT om.enabled FROM public.organization_modules om
                        WHERE om.organization_id = _org AND om.module = 'ranking_valores'), false);
  SELECT max(f.ano) INTO _fa FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano <= _ano;
  RETURN QUERY
  WITH soma AS (
    SELECT b.user_id AS uid, sum(b.comissao) AS ca
      FROM public.ranking_clubes_base(_org, make_date(_ano, 1, 1),
             (make_date(_ano, _mes, 1) + interval '1 month' - interval '1 day')::date) b
     GROUP BY b.user_id)
  SELECT x.uid,
         (SELECT f.nome FROM public.clube_remax_faixas f
           WHERE f.organization_id = _org AND f.ano = _fa AND f.vgc_minimo <= x.ca
           ORDER BY f.vgc_minimo DESC LIMIT 1)
    FROM soma x
   WHERE (_ver OR x.uid = _me)
     AND EXISTS (SELECT 1 FROM public.clube_remax_faixas f
                  WHERE f.organization_id = _org AND f.ano = _fa AND f.vgc_minimo <= x.ca);
END $function$;
REVOKE ALL ON FUNCTION public.carreira_clube_selos(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_clube_selos(integer, integer) TO authenticated, service_role;

COMMIT;
