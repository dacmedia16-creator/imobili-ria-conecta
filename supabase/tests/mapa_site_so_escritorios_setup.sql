-- Cenário ANTES da migration 20261013230000 (t_d017e87f), igual à produção: a Única (A) com os escritórios
-- 63059, 63060, 63183 e 63164 (este é a REMAX VOLUTE) e uma coleta com 1 anúncio de venda de cada.
-- Dados fictícios (IDs 630699xxx). Roda dentro da transação revertida do runner.
UPDATE public.organizations SET slug = 'unica-escolha' WHERE id = '00000000-0000-4000-8000-000000000001' AND slug IS DISTINCT FROM 'unica-escolha';
DELETE FROM public.remax_site_listings WHERE organization_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM public.remax_site_agents WHERE organization_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM public.remax_site_runs WHERE organization_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM public.remax_site_offices WHERE office_id IN (63059, 63060, 63183, 63164);
INSERT INTO public.remax_site_offices (organization_id, office_id)
SELECT '00000000-0000-4000-8000-000000000001', o FROM unnest(ARRAY[63059, 63060, 63183, 63164]) o;
SELECT public.remax_site_ingest('00000000-0000-4000-8000-000000000001', (
  SELECT jsonb_agg(jsonb_build_object('code', format('630699%s-1', lpad(n::text, 3, '0')), 'agent_id', format('630699%s', lpad(n::text, 3, '0')),
    'office_id', off, 'status_uid', 160, 'transacao', 'venda', 'tipo', 'casa', 'rua', 'Rua Fictícia', 'bairro', 'Bairro Teste',
    'cidade', 'Sorocaba', 'lat', -23.5, 'lon', -47.45, 'preco', 500000))
    FROM (VALUES (1, 63059), (2, 63060), (3, 63183), (4, 63164)) v(n, off)),
  (SELECT jsonb_agg(jsonb_build_object('agent_id', format('630699%s', lpad(n::text, 3, '0')), 'nome', 'Corretor Fictício ' || n, 'office_id', off))
    FROM (VALUES (1, 63059), (2, 63060), (3, 63183), (4, 63164)) v(n, off)), now()) IS NOT NULL AS coleta_ficticia \gset
