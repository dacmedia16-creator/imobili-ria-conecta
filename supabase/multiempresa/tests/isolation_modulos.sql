-- Módulos por imobiliária (20261002000005). Tudo desfeito por ROLLBACK; saída sem PII.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE SCHEMA mod_test;
CREATE TABLE mod_test.r (name text, ok boolean);
GRANT USAGE ON SCHEMA mod_test TO authenticated;
GRANT ALL ON mod_test.r TO authenticated;
CREATE FUNCTION mod_test.ck(n text, ok boolean) RETURNS void LANGUAGE sql
AS $$ INSERT INTO mod_test.r VALUES (n, coalesce(ok, false)) $$;
CREATE FUNCTION mod_test.try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'try %: %', SQLSTATE, SQLERRM; RETURN 'erro:'||SQLSTATE; END $$;
CREATE FUNCTION mod_test.login(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('organization_id', (SELECT id FROM public.organizations
      WHERE legacy_default)))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE TABLE mod_test.ids AS SELECT
  (SELECT user_id FROM public.platform_admins LIMIT 1) AS owner,
  -- super-admin da agência; sem ele (ex.: homologação), qualquer membro ativo que não seja da plataforma.
  coalesce((SELECT r.user_id FROM public.user_roles r WHERE r.role = 'super_admin'
     AND r.user_id NOT IN (SELECT user_id FROM public.platform_admins) LIMIT 1),
   (SELECT m.user_id FROM public.organization_members m JOIN public.organizations o
      ON o.id = m.organization_id AND o.legacy_default
    WHERE m.ativo AND m.user_id NOT IN (SELECT user_id FROM public.platform_admins) LIMIT 1)) AS agency_sa,
  (SELECT id FROM public.organizations WHERE legacy_default) AS org;
GRANT SELECT ON mod_test.ids TO authenticated;

SELECT mod_test.ck('estado inicial: reserva ligada', (SELECT bool_and(enabled) FROM public.organization_modules WHERE module = 'reserva_salas'));
SELECT mod_test.ck('estado inicial: captação = configuração antiga', NOT EXISTS (
  SELECT 1 FROM public.exclusive_capture_settings s JOIN public.organization_modules m
    ON m.organization_id = s.organization_id AND m.module = 'captacao_exclusiva'
  WHERE s.enabled IS DISTINCT FROM m.enabled));

-- Super-admin de agência: não liga/desliga nada.
SELECT mod_test.login((SELECT agency_sa FROM mod_test.ids));
SELECT mod_test.ck('agência: lê módulo da própria imobiliária', public.room_reservation_enabled());
SELECT mod_test.ck('agência: não desliga reserva', mod_test.try(format(
  'SELECT public.platform_set_organization_module(%L, %L, false)', (SELECT org FROM mod_test.ids), 'reserva_salas')) = 'erro:42501');
SELECT mod_test.ck('agência: não desliga captação (RPC antiga)', mod_test.try(
  'SELECT public.exclusive_capture_set_enabled(false)') = 'erro:42501');
SELECT mod_test.ck('agência: não grava direto na tabela', mod_test.try(
  'UPDATE public.organization_modules SET enabled = false') LIKE 'erro:%');
SELECT mod_test.ck('agência: não lê histórico', mod_test.try(
  'SELECT 1 FROM public.organization_module_history') LIKE 'erro:%');
SELECT mod_test.ck('ligado: agência cria reserva (controle)', mod_test.try(format(
  $q$INSERT INTO public.room_reservations (room, reserved_date, start_time, end_time, responsible_id,
     responsible_name, purpose) VALUES ('Campolim Sala 2', current_date + 400, '06:00', '06:30', %L, 'Teste', 'Outra finalidade')$q$,
  (SELECT agency_sa FROM mod_test.ids))) = 'ok');

-- Dono da plataforma: desliga reserva -> bloqueia novas reservas e grava histórico.
SELECT mod_test.login((SELECT owner FROM mod_test.ids));
SELECT mod_test.ck('dono: desliga reserva', public.platform_set_organization_module(
  (SELECT org FROM mod_test.ids), 'reserva_salas', false) = false);
SELECT mod_test.ck('dono: módulo mínimo inválido recusado', mod_test.try(format(
  'SELECT public.platform_set_organization_module(%L, %L, true)', (SELECT org FROM mod_test.ids), 'xpto')) = 'erro:22023');
SELECT mod_test.login((SELECT agency_sa FROM mod_test.ids));
SELECT mod_test.ck('desligado: agência vê false', NOT public.room_reservation_enabled());
SELECT mod_test.ck('desligado: nova reserva recusada', mod_test.try(format(
  $q$INSERT INTO public.room_reservations (room, reserved_date, start_time, end_time, responsible_id,
     responsible_name, purpose) VALUES ('Campolim Sala 2', current_date + 401, '06:00', '06:30', %L, 'Teste', 'Outra finalidade')$q$,
  (SELECT agency_sa FROM mod_test.ids))) = 'erro:42501');
SET LOCAL role postgres;
SELECT mod_test.ck('desligado: reservas existentes preservadas', (SELECT count(*) FROM public.room_reservations) > 0);
SELECT mod_test.ck('histórico registrado com o dono', EXISTS (SELECT 1 FROM public.organization_module_history h
  WHERE h.module = 'reserva_salas' AND NOT h.enabled AND h.actor_id = (SELECT owner FROM mod_test.ids)));
SELECT mod_test.login((SELECT owner FROM mod_test.ids));
SELECT mod_test.ck('dono: religa reserva', public.platform_set_organization_module(
  (SELECT org FROM mod_test.ids), 'reserva_salas', true));
SELECT mod_test.ck('dono: captação pela RPC antiga', public.exclusive_capture_set_enabled(
  (SELECT NOT public.exclusive_capture_enabled())) IS NOT NULL);

SET LOCAL role postgres;
SELECT 'MODULOS ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || name FROM mod_test.r;
SELECT 'TOTAL=' || count(*) || ' OK=' || count(*) FILTER (WHERE ok) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM mod_test.r;
ROLLBACK;
