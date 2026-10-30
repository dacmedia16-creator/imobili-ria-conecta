-- Teste da função clicksign_sale_corretores (t_bc726348). Rodar SOMENTE em banco local/clone
-- estrutural (ex.: psql -v ON_ERROR_STOP=1 -f este_arquivo). Tudo dentro de BEGIN ... ROLLBACK.
-- A própria migration é aplicada dentro da transação (e desfeita no ROLLBACK).
\set ON_ERROR_STOP 1
BEGIN;
\ir ../migrations/20261030150000_clicksign_sale_corretores.sql
SET LOCAL session_replication_role = replica; -- só para montar o cenário sem gatilhos de negócio

-- Reproduz o dono de produção de sale_corretores (sem BYPASSRLS) para provar o bug original.
-- (rodar como superusuário do clone; em produção mt_1b_definer já tem estes GRANTs e é membro de
-- authenticated, logo a política restritiva org_isolation vale para ele).
ALTER FUNCTION public.sale_corretores(uuid) OWNER TO mt_1b_definer;
GRANT ALL ON public.sales, public.sale_commission_extras TO mt_1b_definer;
GRANT authenticated TO mt_1b_definer WITH INHERIT TRUE; -- igual a produção (inherit_option = true)

INSERT INTO public.organizations (id, nome, slug) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Org A', 'org-a-teste'),
  ('b0000000-0000-4000-8000-000000000002', 'Org B', 'org-b-teste');
INSERT INTO public.profiles (id, organization_id, nome, email, ativo) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Renata Teste', 'r@example.com', true),
  ('a2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Extra A', 'x@example.com', true),
  ('a3000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Corretor Legado', 'l@example.com', true),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'Corretor B', 'b@example.com', true);
-- Venda 1 (Org A): captadora = vendedora (como a 630601310-29) + 1 extra corretor_vendedor
--   + 1 extra de OUTRA org apontando para a mesma venda (não pode vazar) + extra de papel não corretor.
-- Venda 2 (Org A): sem captador/vendedor, só corretor_id (legado).
-- Venda 3 (Org B): corretor da Org B.
INSERT INTO public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_vendedor_id) VALUES
  ('5a1e0000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('5a1e0000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'a3000000-0000-4000-8000-000000000003', NULL, NULL),
  ('5a1e0000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002',
   'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', NULL);
INSERT INTO public.sale_commission_extras (sale_id, organization_id, papel, user_id) VALUES
  ('5a1e0000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'corretor_vendedor', 'a2000000-0000-4000-8000-000000000002'),
  ('5a1e0000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'corretor_captador', 'b1000000-0000-4000-8000-000000000001'),
  ('5a1e0000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'gestor', 'a3000000-0000-4000-8000-000000000003');
SET LOCAL session_replication_role = origin;

DO $$
DECLARE _r uuid[]; _ok boolean;
BEGIN
  -- Contexto da edge: service_role, SEM JWT de usuário.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;

  -- T0 (bug original): sale_corretores devolve vazio sem usuário logado.
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO _r FROM public.sale_corretores('5a1e0000-0000-4000-8000-000000000001') x;
  IF _r <> '{}' THEN RAISE EXCEPTION 'T0 esperava vazio (bug reproduzido), veio %', _r; END IF;
  RAISE NOTICE 'T0 ok: sale_corretores sem JWT = vazio (bug reproduzido)';

  -- T1: nova função devolve captadora/vendedora (uma vez) + extra corretor da mesma org.
  SELECT array_agg(x ORDER BY x) INTO _r
    FROM public.clicksign_sale_corretores('a0000000-0000-4000-8000-000000000001', '5a1e0000-0000-4000-8000-000000000001') x;
  IF _r IS DISTINCT FROM ARRAY['a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002']::uuid[] THEN
    RAISE EXCEPTION 'T1 falhou: %', _r; END IF;
  RAISE NOTICE 'T1 ok: service_role sem JWT devolve captadora/vendedora + extra (sem vazar Org B, sem papel gestor)';

  -- T2: legado — sem captador/vendedor cai no corretor_id.
  SELECT array_agg(x) INTO _r
    FROM public.clicksign_sale_corretores('a0000000-0000-4000-8000-000000000001', '5a1e0000-0000-4000-8000-000000000002') x;
  IF _r IS DISTINCT FROM ARRAY['a3000000-0000-4000-8000-000000000003']::uuid[] THEN RAISE EXCEPTION 'T2 falhou: %', _r; END IF;
  RAISE NOTICE 'T2 ok: venda legada usa corretor_id';

  -- T3: isolamento — pedir a venda da Org B com a org A (e vice-versa) não devolve nada.
  SELECT coalesce(array_agg(x), '{}') INTO _r
    FROM public.clicksign_sale_corretores('a0000000-0000-4000-8000-000000000001', '5a1e0000-0000-4000-8000-000000000003') x;
  IF _r <> '{}' THEN RAISE EXCEPTION 'T3 falhou (vazou Org B): %', _r; END IF;
  SELECT coalesce(array_agg(x), '{}') INTO _r
    FROM public.clicksign_sale_corretores('b0000000-0000-4000-8000-000000000002', '5a1e0000-0000-4000-8000-000000000001') x;
  IF _r <> '{}' THEN RAISE EXCEPTION 'T3b falhou (vazou Org A): %', _r; END IF;
  RAISE NOTICE 'T3 ok: org errada = lista vazia';

  RESET ROLE;

  -- T4: permissões — anon e authenticated NÃO executam; service_role executa; dona postgres.
  IF has_function_privilege('anon', 'public.clicksign_sale_corretores(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.clicksign_sale_corretores(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.clicksign_sale_corretores(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T4 falhou: anon/authenticated/PUBLIC podem executar'; END IF;
  IF NOT has_function_privilege('service_role', 'public.clicksign_sale_corretores(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T4 falhou: service_role sem EXECUTE'; END IF;
  SELECT pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND proconfig = ARRAY['search_path=""']
    INTO _ok FROM pg_proc WHERE oid = 'public.clicksign_sale_corretores(uuid,uuid)'::regprocedure;
  IF NOT _ok THEN RAISE EXCEPTION 'T4 falhou: dona/security definer/search_path'; END IF;
  RAISE NOTICE 'T4 ok: só service_role executa; dona postgres; SECURITY DEFINER; search_path vazio';
END $$;

-- T5: chamada real como authenticated recebe 42501.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.clicksign_sale_corretores('a0000000-0000-4000-8000-000000000001', '5a1e0000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'T5 falhou: authenticated executou';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'T5 ok: authenticated recebe permission denied';
  END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.clicksign_sale_corretores('a0000000-0000-4000-8000-000000000001', '5a1e0000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'T5b falhou: anon executou';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'T5b ok: anon recebe permission denied';
  END;
  RESET ROLE;
END $$;

ROLLBACK;
