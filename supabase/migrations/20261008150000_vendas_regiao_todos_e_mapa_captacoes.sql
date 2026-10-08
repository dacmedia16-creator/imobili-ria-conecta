-- "Vendas por região" para todos os perfis da imobiliária + mapa das captações no topo da tela
-- (pedido de Denis, 08/10/2026).
--
-- Por que funções novas (e não alterar vendas_por_regiao): a atual é security invoker e depende da RLS
-- de sales, então cada perfil veria um pedaço diferente e os números mudariam. As novas são
-- SECURITY DEFINER (dono mt_1b_definer, mesmo padrão de sale_set_geo/exclusive_set_geo), filtram
-- explicitamente pela imobiliária do usuário (current_org_id) e devolvem só o necessário para a tela.
-- vendas_por_regiao() fica intacta (o frontend publicado continua funcionando até o deploy).
--
-- Privacidade:
--  * Vendas que a pessoa JÁ pode abrir hoje (can_view_sale): linha completa como antes
--    (código, endereço, data, valor, coordenada).
--  * Demais vendas da imobiliária: só AGREGADO por cidade/bairro (quantidade e VGV somados) e um pino
--    com coordenada arredondada (~100 m) sem código, endereço, data nem valor.
--  * Nunca sai nome de corretor, cliente, comissão ou parceria.
--  * Captações: SOMENTE as com contrato de exclusividade assinado (status 'aprovada', que só é
--    alcançado com o PDF assinado anexado e a aprovação do gestor; a aprovação grava signed_on).
--    Rascunho, devolvida, enviada e em_assinatura ficam fora (decisão de Denis 08/10).
--    Código, tipo, bairro, cidade, captador e coordenada EXATA do imóvel para todos (decisão de Denis
--    08/10). Endereço por escrito e situação/vigência só para gestor/admin/super_admin ou para quem já
--    vê a captação (exclusive_can_view: o próprio captador e o líder da equipe). Nunca sai dado do
--    proprietário, valor do imóvel nem comissão.
-- Rollback: supabase/rollback/20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql
BEGIN;

-- Quem pode abrir o relatório: membro ativo da imobiliária atual com qualquer papel do sistema.
CREATE FUNCTION public.relatorio_regiao_permitido()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT coalesce(
    auth.uid() IS NOT NULL
    AND public.current_org_id() IS NOT NULL
    AND public.mt_1b_gate()
    AND public.is_active_user(auth.uid())
    AND public.has_any_role(auth.uid(), ARRAY['corretor','team_leader','gestor','financeiro','juridico',
      'lancamento','staff','admin','super_admin']::public.app_role[]),
    false)
$function$;

-- Vendas efetivadas da imobiliária (mesma base canônica dos demais relatórios). Período pela data da
-- assinatura (data_fechamento, America/Sao_Paulo), filtrado aqui para os agregados respeitarem o filtro.
-- tipo = 'venda'  -> venda que a pessoa pode abrir (qtd = 1, todos os campos)
-- tipo = 'grupo'  -> demais vendas somadas por cidade/UF/bairro (qtd e valor somados, sem identificação)
-- tipo = 'pino'   -> uma por venda das demais, só modalidade, bairro/cidade e coordenada arredondada
CREATE FUNCTION public.vendas_por_regiao_todos(_de date DEFAULT NULL, _ate date DEFAULT NULL)
 RETURNS TABLE (
  tipo text,
  sale_id uuid,
  data_fechamento date,
  modalidade text,
  codigo text,
  qtd integer,
  valor numeric,
  imovel_endereco text,
  imovel_bairro text,
  imovel_cidade text,
  imovel_uf text,
  geo_key text,
  geo_lat double precision,
  geo_lon double precision
 )
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF NOT public.relatorio_regiao_permitido() THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH v AS (
    SELECT c.sale_id, c.data_fechamento, c.modalidade, coalesce(c.valor_negociado, 0) AS valor,
           coalesce(nullif(c.codigo_interno, ''), c.imovel_id) AS codigo,
           s.imovel_endereco, s.imovel_bairro, s.imovel_cidade, s.imovel_uf,
           g.geo_key, g.geo_lat, g.geo_lon,
           coalesce(public.can_view_sale(auth.uid(), c.sale_id), false) AS det
    FROM public.vendas_comerciais_canonicas() c
    JOIN public.sales s ON s.id = c.sale_id AND s.organization_id = _org
    LEFT JOIN public.sale_geo g ON g.sale_id = s.id AND g.organization_id = _org
    WHERE (_de IS NULL OR c.data_fechamento >= _de)
      AND (_ate IS NULL OR c.data_fechamento <= _ate)
  )
  SELECT 'venda'::text, v.sale_id, v.data_fechamento, v.modalidade, v.codigo, 1, v.valor,
         v.imovel_endereco, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, v.geo_key, v.geo_lat, v.geo_lon
    FROM v WHERE v.det
  UNION ALL
  SELECT 'grupo'::text, NULL::uuid, NULL::date, NULL::text, NULL::text, count(*)::integer, sum(v.valor),
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text, NULL::double precision,
         NULL::double precision
    FROM v WHERE NOT v.det
    GROUP BY v.imovel_bairro, v.imovel_cidade, v.imovel_uf
  UNION ALL
  SELECT 'pino'::text, NULL::uuid, NULL::date, v.modalidade, NULL::text, 1, NULL::numeric,
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text,
         round(v.geo_lat::numeric, 3)::double precision, round(v.geo_lon::numeric, 3)::double precision
    FROM v WHERE NOT v.det AND v.geo_lat IS NOT NULL AND v.geo_lon IS NOT NULL;
END $function$;

-- Captações assinadas (status 'aprovada') da imobiliária para o mapa; descartadas e arquivadas fora.
-- O futuro "cadastro manual" de contrato já assinado deve gravar status 'aprovada' + signed_on para
-- entrar aqui sem nenhuma mudança nesta função.
CREATE FUNCTION public.mapa_captacoes()
 RETURNS TABLE (
  id uuid,
  codigo text,
  tipo_imovel text,
  bairro text,
  cidade text,
  captador text,
  geo_lat double precision,
  geo_lon double precision,
  detalhe boolean,
  pode_abrir boolean,
  endereco text,
  status text,
  signed_on date,
  prazo_dias text,
  estado text,
  geo_key text
 )
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  _org uuid := public.current_org_id();
  _amplo boolean;
BEGIN
  IF NOT public.relatorio_regiao_permitido() THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(public.exclusive_capture_enabled(), false) THEN
    RETURN;  -- módulo de captação desligado nesta imobiliária: mapa vazio
  END IF;
  _amplo := coalesce(public.has_any_role(auth.uid(),
    ARRAY['gestor','admin','super_admin']::public.app_role[]), false);
  RETURN QUERY
  WITH c AS (
    SELECT x.id, x.form_data, x.broker_name, x.geo_lat, x.geo_lon, x.geo_key, x.status, x.signed_on,
           x.created_at,
           coalesce(public.exclusive_can_view(x.id, auth.uid()), false) AS abre
    FROM public.exclusive_captures x
    WHERE x.organization_id = _org AND x.status = 'aprovada'
      AND x.discarded_at IS NULL AND x.archived_at IS NULL
  ), d AS (
    SELECT c.*, (_amplo OR c.abre) AS det FROM c
  )
  SELECT d.id,
         upper(left(d.id::text, 8)),
         nullif(btrim(d.form_data->'imovel'->>'tipo_imovel'), ''),
         nullif(btrim(d.form_data->'imovel'->>'bairro'), ''),
         nullif(btrim(d.form_data->'imovel'->>'municipio'), ''),
         nullif(btrim(d.broker_name), ''),
         d.geo_lat,
         d.geo_lon,
         d.det,
         d.abre,
         CASE WHEN d.det THEN nullif(btrim(d.form_data->'imovel'->>'endereco'), '') END,
         CASE WHEN d.det THEN d.status END,
         CASE WHEN d.det THEN d.signed_on END,
         CASE WHEN d.det THEN d.form_data->'condicoes'->>'prazo_dias_numero' END,
         -- estado e geo_key só para quem pode abrir: a tela localiza no mapa (OpenStreetMap, grátis)
         -- as captações dela que ainda não têm coordenada, gravando por exclusive_set_geo.
         CASE WHEN d.abre THEN nullif(btrim(d.form_data->'imovel'->>'estado'), '') END,
         CASE WHEN d.abre THEN d.geo_key END
  FROM d
  ORDER BY d.created_at DESC;
END $function$;

GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.relatorio_regiao_permitido() OWNER TO mt_1b_definer;
ALTER FUNCTION public.vendas_por_regiao_todos(date, date) OWNER TO mt_1b_definer;
ALTER FUNCTION public.mapa_captacoes() OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.relatorio_regiao_permitido() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vendas_por_regiao_todos(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mapa_captacoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_regiao_permitido() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vendas_por_regiao_todos(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mapa_captacoes() TO authenticated, service_role;

COMMIT;
