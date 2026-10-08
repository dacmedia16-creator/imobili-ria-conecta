-- Checagens extras da migration 20261008200000 (valor no pino). Roda logo depois de vendas_regiao_todos.sql,
-- no mesmo SAVEPOINT (usa as variáveis :a_* / :b_admin e os papéis dados lá). Tudo é desfeito no fim.
-- Garante coordenada para TODAS as vendas da A (só na transação), para que todo pino exista e a soma
-- "pinos + vendas completas" possa ser comparada com o VGV total da tela.
RESET ROLE;
CREATE TEMP TABLE r2(ok bool, msg text);
CREATE TEMP TABLE res2(papel text, uid uuid, vgv numeric, venda_valor numeric, pino_valor numeric,
  pino_qtd int, pino_lista text, pino_sem_valor int, pino_ident bool, pino_exato bool);
GRANT ALL ON r2, res2 TO authenticated;

INSERT INTO public.sale_geo (sale_id, organization_id, geo_key, geo_lat, geo_lon)
SELECT s.id, s.organization_id, 'qa-valor-pino|' || s.id, -23.5 - random() / 10, -47.4 - random() / 10
  FROM public.sales s
 WHERE s.organization_id = '00000000-0000-4000-8000-000000000001'
   AND NOT EXISTS (SELECT 1 FROM public.sale_geo g WHERE g.sale_id = s.id)
ON CONFLICT DO NOTHING;
UPDATE public.sale_geo g SET geo_lat = -23.5 - random() / 10, geo_lon = -47.4 - random() / 10
 WHERE g.organization_id = '00000000-0000-4000-8000-000000000001' AND (g.geo_lat IS NULL OR g.geo_lon IS NULL);

CREATE FUNCTION pg_temp.coleta2(_papel text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _v jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') INTO _v FROM public.vendas_por_regiao_todos() t;
  INSERT INTO res2 SELECT _papel, auth.uid(),
    (SELECT coalesce(sum((e->>'valor')::numeric), 0) FROM jsonb_array_elements(_v) e WHERE e->>'tipo' IN ('venda', 'grupo')),
    (SELECT coalesce(sum((e->>'valor')::numeric), 0) FROM jsonb_array_elements(_v) e WHERE e->>'tipo' = 'venda'),
    (SELECT coalesce(sum((e->>'valor')::numeric), 0) FROM jsonb_array_elements(_v) e WHERE e->>'tipo' = 'pino'),
    (SELECT count(*) FROM jsonb_array_elements(_v) e WHERE e->>'tipo' = 'pino'),
    (SELECT string_agg(e->>'valor', ',' ORDER BY (e->>'valor')::numeric) FROM jsonb_array_elements(_v) e WHERE e->>'tipo' = 'pino'),
    (SELECT count(*) FROM jsonb_array_elements(_v) e WHERE e->>'tipo' = 'pino' AND e->>'valor' IS NULL),
    EXISTS (SELECT 1 FROM jsonb_array_elements(_v) e WHERE e->>'tipo' = 'pino' AND (e->>'sale_id' IS NOT NULL
      OR e->>'codigo' IS NOT NULL OR e->>'imovel_endereco' IS NOT NULL OR e->>'data_fechamento' IS NOT NULL
      OR e->>'geo_key' IS NOT NULL)),
    EXISTS (SELECT 1 FROM jsonb_array_elements(_v) e WHERE e->>'tipo' = 'pino'
      AND ((e->>'geo_lat')::numeric <> round((e->>'geo_lat')::numeric, 3)
        OR (e->>'geo_lon')::numeric <> round((e->>'geo_lon')::numeric, 3)));
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.coleta2(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_corretor', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_corretor', true);
SELECT pg_temp.coleta2('corretor');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_gestor', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_gestor', true);
SELECT pg_temp.coleta2('gestor');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_admin', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'a_admin', true);
SELECT pg_temp.coleta2('admin');
SELECT set_config('request.jwt.claims', json_build_object('sub', :'b_admin', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'b_admin', true);
SELECT pg_temp.coleta2('B_admin');
CREATE TEMP TABLE b_da_a AS SELECT count(*) AS n FROM public.vendas_por_regiao_todos() t
  WHERE t.tipo = 'pino' AND t.geo_lat BETWEEN -23.61 AND -23.49 AND t.geo_lon BETWEEN -47.51 AND -47.39;
RESET ROLE;

-- Referência (dono): valor de cada venda da A que o papel NÃO abre (vira pino), em ordem.
INSERT INTO r2 SELECT
  x.pino_lista IS NOT DISTINCT FROM (
    SELECT string_agg(coalesce(c.valor_negociado, 0)::text, ',' ORDER BY coalesce(c.valor_negociado, 0))
      FROM public.vendas_comerciais_canonicas() c JOIN public.sales s ON s.id = c.sale_id
     WHERE s.organization_id = '00000000-0000-4000-8000-000000000001'
       AND NOT coalesce(public.can_view_sale(x.uid, c.sale_id), false)),
  x.papel || ': cada pino traz o valor exato de uma venda que ele não abre (' || x.pino_qtd || ' pinos, R$ ' || x.pino_valor || ')'
  FROM res2 x WHERE x.papel <> 'B_admin';
INSERT INTO r2 SELECT x.pino_sem_valor = 0, x.papel || ': nenhum pino sem valor' FROM res2 x;
INSERT INTO r2 SELECT NOT x.pino_ident AND NOT x.pino_exato,
  x.papel || ': pino sem código/endereço/data/geo_key e com coordenada arredondada' FROM res2 x;
INSERT INTO r2 SELECT x.pino_valor + x.venda_valor = x.vgv,
  x.papel || ': pinos R$ ' || x.pino_valor || ' + vendas completas R$ ' || x.venda_valor || ' = VGV total R$ ' || x.vgv
  FROM res2 x;
INSERT INTO r2 SELECT count(DISTINCT x.vgv) = 1, 'corretor, gestor e admin veem o mesmo VGV total (' || min(x.vgv) || ')'
  FROM res2 x WHERE x.papel <> 'B_admin';
INSERT INTO r2 SELECT n = 0, 'B_admin (como REMAX-TESTE): 0 pinos com valor da A' FROM b_da_a;
-- Exposição: as colunas de identificação continuam nulas no pino também no catálogo (corpo da função)
INSERT INTO r2 SELECT position('''pino''::text, NULL::uuid, NULL::date, v.modalidade, NULL::text, 1, v.valor,' IN p.prosrc) > 0,
  'corpo da função: pino devolve só modalidade, valor, bairro/cidade/UF e coordenada'
  FROM pg_proc p WHERE p.oid = 'public.vendas_por_regiao_todos(date,date)'::regprocedure;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r2;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) FROM r2;
