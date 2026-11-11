-- Suíte "Ajuda MAX acompanha a Locação" (migration 20261118120000, t_8fd40b23). Roda DENTRO de transação
-- revertida (run-ajuda-max-segue-locacao.sh), na homologação: A = Agência A (fictícia), B = Agência B (fictícia).
-- Perfis: QA A Corretor Dois (A) e QA B Corretor Um (B). Tudo é desfeito no ROLLBACK. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;
-- Estado das chaves da org (como postgres; o teste é revertido).
CREATE FUNCTION pg_temp.chaves(_org uuid, _loc boolean, _ajuda boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.organization_modules WHERE organization_id = _org AND module IN ('locacao', 'ajuda_max_locacao');
  IF _loc IS NOT NULL THEN
    INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (_org, 'locacao', _loc);
  END IF;
  IF _ajuda IS NOT NULL THEN
    INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (_org, 'ajuda_max_locacao', _ajuda);
  END IF;
END $$;
-- Resposta de ajuda_max_locacao_enabled() vista pelo usuário.
CREATE FUNCTION pg_temp.ve(_uid text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE _r boolean;
BEGIN
  PERFORM pg_temp.as_user(_uid);
  SET LOCAL ROLE authenticated;
  _r := public.ajuda_max_locacao_enabled();
  RESET ROLE;
  RETURN _r;
END $$;
CREATE FUNCTION pg_temp.reserva_erro(_uid text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _e text;
BEGIN
  PERFORM pg_temp.as_user(_uid);
  SET LOCAL ROLE authenticated;
  _e := pg_temp.err('SELECT public.ajuda_max_locacao_reservar()');
  RESET ROLE;
  RETURN _e;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b,
       'ebffaded-075c-493f-89e2-1d3d62901dc4' AS ua, '23e65aaf-2614-463e-baec-cf562bb94244' AS ub \gset

-- 1) Locação ligada, sem linha do Ajuda MAX → ligado
SELECT pg_temp.chaves(:'org_a', true, NULL);
SELECT pg_temp.ok(pg_temp.ve(:'ua') IS TRUE, 'A: Locação ligada e sem linha → Ajuda MAX ligado');
-- 2) Desligador
SELECT pg_temp.chaves(:'org_a', true, false);
SELECT pg_temp.ok(pg_temp.ve(:'ua') IS FALSE, 'A: linha enabled=false → desligado (desligador)');
SELECT pg_temp.ok(pg_temp.reserva_erro(:'ua') = '42501', 'A desligada: banco recusa reservar pergunta (42501)');
-- 3) Linha enabled=true (caso Conferência) → ligado
SELECT pg_temp.chaves(:'org_a', true, true);
SELECT pg_temp.ok(pg_temp.ve(:'ua') IS TRUE, 'A: linha enabled=true → ligado (Conferência continua)');
-- 4) Locação desligada → desligado, com ou sem linha
SELECT pg_temp.chaves(:'org_a', false, NULL);
SELECT pg_temp.ok(pg_temp.ve(:'ua') IS FALSE, 'A: Locação desligada e sem linha → desligado');
SELECT pg_temp.chaves(:'org_a', false, true);
SELECT pg_temp.ok(pg_temp.ve(:'ua') IS FALSE, 'A: Locação desligada mesmo com linha true → desligado');
SELECT pg_temp.ok(pg_temp.reserva_erro(:'ua') = '42501', 'A sem Locação: banco recusa reservar pergunta (42501)');
SELECT pg_temp.chaves(:'org_a', NULL, NULL);
SELECT pg_temp.ok(pg_temp.ve(:'ua') IS FALSE, 'A: sem linha de Locação (nunca ligada) → desligado');
-- 5) Imobiliária "nova" que liga a Locação depois → ligado sem passo extra
SELECT pg_temp.chaves(:'org_b', NULL, NULL);
SELECT pg_temp.ok(pg_temp.ve(:'ub') IS FALSE, 'B nova: sem Locação → desligado');
SELECT pg_temp.chaves(:'org_b', true, NULL);
SELECT pg_temp.ok(pg_temp.ve(:'ub') IS TRUE, 'B nova: liga a Locação → Ajuda MAX ligado sem passo manual');
-- 6) Isolamento: desligador de A não afeta B e vice-versa
SELECT pg_temp.chaves(:'org_a', true, false);
SELECT pg_temp.chaves(:'org_b', true, NULL);
SELECT pg_temp.ok(pg_temp.ve(:'ua') IS FALSE AND pg_temp.ve(:'ub') IS TRUE, 'isolamento: desligar A não desliga B');
SELECT pg_temp.chaves(:'org_a', true, NULL);
SELECT pg_temp.chaves(:'org_b', true, false);
SELECT pg_temp.ok(pg_temp.ve(:'ua') IS TRUE AND pg_temp.ve(:'ub') IS FALSE, 'isolamento: desligar B não desliga A');
-- 7) Sem login → falso; anon não executa
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.ajuda_max_locacao_enabled()', 'EXECUTE'),
  'anon não executa ajuda_max_locacao_enabled');
SELECT pg_temp.ok(public.ajuda_max_locacao_enabled() IS FALSE, 'sem usuário (sem org) → falso');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
