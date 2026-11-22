-- Complemento de oportunidades_encaixe_envolvidos.sql para 20261221120000 (t_b832cf00). Roda DEPOIS daquela suíte,
-- na mesma transação (usa pg_temp.id/ok/as_user e as captações capCaio/capB que ela cria). Só pelo runner:
--   supabase/tests/run-oportunidades-quartos-candidatos.sh
-- Cobre: a RPC devolve os quartos da ficha; ficha sem quartos = NULL; o acesso continua o mesmo.
RESET ROLE;
UPDATE public.exclusive_captures SET form_data = form_data || jsonb_build_object('ficha', jsonb_build_object('quartos', '3'))
 WHERE id = pg_temp.id('capCaio');

SELECT pg_temp.as_user('uCaio');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(101, (SELECT array_agg(quartos) = ARRAY['3'] FROM public.opportunity_capture_candidates()),
  'captador recebe os quartos da ficha da própria captação');
RESET ROLE;
SELECT pg_temp.as_user('uDavi');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(102, (SELECT count(*) = 0 FROM public.opportunity_capture_candidates()),
  'corretor de fora continua sem captação dos outros');
RESET ROLE;
SELECT pg_temp.as_user('uB');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(103, (SELECT array_agg(id) = ARRAY[pg_temp.id('capB')] AND bool_and(quartos IS NULL)
  FROM public.opportunity_capture_candidates()), 'outra imobiliária: só a própria, sem ficha = quartos NULL');
RESET ROLE;
SELECT pg_temp.ok(104, NOT has_function_privilege('anon', 'public.opportunity_capture_candidates()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.opportunity_capture_candidates()', 'EXECUTE'),
  'grants iguais: anon não executa, authenticated executa');

DO $$ BEGIN RAISE NOTICE 'OPORTUNIDADES QUARTOS CANDIDATOS: TODOS OS TESTES PASSARAM'; END $$;
