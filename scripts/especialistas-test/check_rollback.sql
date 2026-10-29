-- Depois do rollback: estrutura e dados voltam ao formato anterior.
\set ON_ERROR_STOP 1
SELECT 'RB01 tabela de vínculos removida: ' || (to_regclass('public.positioning_region_orgs') IS NULL);
SELECT 'RB02 coluna uf removida: ' || NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'positioning_regions' AND column_name = 'uf');
SELECT 'RB03 unique antigo de volta: ' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positioning_regions_org_unique');
SELECT 'RB04 FK região×org de volta: ' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'corretor_positioning_regions_region_org_fk');
SELECT 'RB05 escolhas preservadas (2): ' || (SELECT count(*) FROM public.corretor_positioning_regions);
SELECT 'RB06 sugestão pendente preservada (1): ' || (SELECT count(*) FROM public.positioning_region_suggestions WHERE status = 'pendente');
SELECT 'RB07 módulo removido: ' || NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE module = 'especialistas_publico');
SELECT 'RB08 dono antigo das RPCs: ' || (SELECT string_agg(DISTINCT proowner::regrole::text, ',') FROM pg_proc
  WHERE proname IN ('save_my_positioning', 'submit_positioning_region_suggestion', 'review_positioning_region_suggestion'));
SELECT 'RB09 RPC pública antiga (anon) lista: ' || (SELECT count(*) FROM public.list_public_specialists());
SELECT 'RB10 funções novas removidas: ' || NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN
  ('list_public_org_specialists', 'positioning_region_decidir', 'regiao_norm', 'positioning_region_obter_ou_criar'));
