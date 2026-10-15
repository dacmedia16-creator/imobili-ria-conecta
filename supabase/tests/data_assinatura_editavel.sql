-- Suíte da migration 20261015150000 (data de assinatura editável). Roda DENTRO de transação revertida
-- (ver run-data-assinatura-editavel.sh), depois do "up". Banco local descartável (adm-mural):
-- Org A = 0a000000-…-0001; corretor captador = aaaa…000a; outro corretor = aaaa…000b;
-- gestor = aaaa…000c (recebe papel admin só nesta transação). Dados fictícios.
-- Saída: linhas "ok …" / "FALHA …" e "TOTAL=<falhas>".
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;

SELECT 'aaaaaaaa-0000-0000-0000-00000000000a' AS corretor, 'aaaaaaaa-0000-0000-0000-00000000000b' AS outro,
       'aaaaaaaa-0000-0000-0000-00000000000c' AS gestor, '0a000000-0000-0000-0000-000000000001' AS org_a \gset
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (:'org_a', 'captacao_exclusiva', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (:'gestor', 'admin', :'org_a');
UPDATE public.profiles SET ativo = true WHERE id IN (:'corretor', :'outro', :'gestor');
-- Captação normal (manual=false) cadastrada "hoje" — o contrato foi assinado antes.
INSERT INTO public.exclusive_captures (captor_id, created_by, template, organization_id, status)
  VALUES (:'corretor', :'corretor', 'campolim', :'org_a', 'enviada') RETURNING id AS cap \gset
INSERT INTO ids VALUES ('cap', :'cap');
SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje,
       ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1) AS amanha \gset

SET LOCAL ROLE authenticated;

-- 1) Corretor captador, antes da aprovação: data ANTERIOR ao cadastro é aceita.
SELECT pg_temp.as_user(:'corretor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', :'cap', '2026-03-10')) IS NULL,
  'corretor (enviada) grava data anterior ao cadastro (10/03/2026)');
-- 2) Data futura recusada; antes de 2000 recusada.
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', :'cap', :'amanha')) = 'Data de assinatura inválida',
  'data futura recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', :'cap', '1999-12-31')) = 'Data de assinatura inválida',
  'data antes de 2000 recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', :'cap', :'hoje')) IS NULL,
  'data de hoje aceita');

-- 3) Outro corretor da mesma organização: bloqueado.
SELECT pg_temp.as_user(:'outro');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', :'cap', '2026-03-11')) = 'Ação não permitida',
  'outro corretor bloqueado');

-- 4) Em assinatura: corretor ainda pode alterar.
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'em_assinatura' WHERE id = :'cap';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'corretor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', :'cap', '2026-03-12')) IS NULL,
  'corretor (em_assinatura) altera a data');

-- 5) Depois de aprovada: corretor bloqueado; gestor corrige.
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'aprovada' WHERE id = :'cap';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'corretor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', :'cap', '2026-03-13'))
  = 'Captação aprovada: só o gestor corrige a data de assinatura', 'corretor bloqueado depois de aprovada');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', :'cap', '2026-02-20')) IS NULL,
  'gestor corrige depois de aprovada (data anterior ao cadastro)');

-- 6) Rascunho: ninguém grava (regra mantida).
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'rascunho' WHERE id = :'cap';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'corretor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, %L::date)', :'cap', '2026-03-14')) = 'Captação ainda não foi enviada',
  'rascunho continua recusado');

-- 7) Histórico: uma linha data_assinatura por alteração aceita, com o autor certo.
RESET ROLE;
SELECT pg_temp.ok((SELECT signed_on = date '2026-02-20' FROM public.exclusive_captures WHERE id = :'cap'),
  'signed_on final = 20/02/2026');
SELECT pg_temp.ok((SELECT count(*) = 4 FROM public.exclusive_history WHERE capture_id = :'cap' AND action = 'data_assinatura'),
  'histórico: 4 alterações aceitas gravadas');
SELECT pg_temp.ok((SELECT count(*) = 3 FROM public.exclusive_history WHERE capture_id = :'cap' AND action = 'data_assinatura' AND actor_id = :'corretor'::uuid)
  AND (SELECT count(*) = 1 FROM public.exclusive_history WHERE capture_id = :'cap' AND action = 'data_assinatura' AND actor_id = :'gestor'::uuid AND detail = '20/02/2026'),
  'histórico com autor (3 corretor, 1 gestor) e data dd/mm/aaaa');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.exclusive_set_signed_on(uuid,date)', 'EXECUTE'), 'anon não executa');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) FROM r;
