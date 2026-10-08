-- Setup (ANTES da migration 20261008230000, dentro da transação revertida): perfis com ID RE/MAX
-- fictício e uma semana gravada pela regra ANTIGA (só hífen), para provar o acerto do que já existe.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('corretor', '10000000-0000-4000-8000-000000000003'), ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('colega', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('outra', 'cab7391a-463f-4d97-b99b-ced6e4696796'),
  ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
INSERT INTO public.organization_modules (organization_id, module, enabled)
  SELECT o, 'feedback_proprietario', true FROM unnest(ARRAY[:'org_a', :'org_b']::uuid[]) o
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
-- Isola o teste: semanas fictícias de jan/2026 e IDs fictícios só destes dois perfis.
DELETE FROM public.portal_listing_snapshots WHERE collected_on IN ('2026-01-05', '2026-01-12');
UPDATE public.profiles SET remax_id = NULL WHERE remax_id IN ('630601901', '630601902');
UPDATE public.profiles SET remax_id = '630601901' WHERE id = pg_temp.id('corretor');
UPDATE public.profiles SET remax_id = '630601902' WHERE id = pg_temp.id('colega');

SELECT public.portal_ingest(:'org_a'::uuid, 'zap', '2026-01-05', 'unknown',
  '[{"code":"630601901-5","views":1,"contacts":0,"impressions":1},
    {"code":"630601901x16","views":1,"contacts":0,"impressions":1},
    {"code":"630601901xx7","views":1,"contacts":0,"impressions":1},
    {"code":"630601901XX6","views":1,"contacts":0,"impressions":1},
    {"code":"630601902x3","views":1,"contacts":0,"impressions":1},
    {"code":"63060190x72","views":1,"contacts":0,"impressions":1},
    {"code":"630601901","views":1,"contacts":0,"impressions":1},
    {"code":"630601901y4","views":1,"contacts":0,"impressions":1},
    {"code":"6306019011x2","views":1,"contacts":0,"impressions":1},
    {"code":"630591555x9","views":1,"contacts":0,"impressions":1},
    {"code":"631831777-2","views":1,"contacts":0,"impressions":1},
    {"code":"630601901x20","error":"timeout"},
    {"code":"630601902-8","views":1,"contacts":0,"impressions":1}]'::jsonb, 13, now());
SELECT pg_temp.ok((SELECT count(*) FROM public.portal_listing_snapshots WHERE collected_on = '2026-01-05' AND broker_id IS NOT NULL) = 2,
  'pré (regra antiga): só os 2 códigos com hífen ligados');
