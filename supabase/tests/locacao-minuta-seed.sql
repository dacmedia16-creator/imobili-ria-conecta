-- Preparo fictício da suíte locacao-minuta (roda como dono do banco, dentro da transação revertida).
-- Locação L (Agência A, seguro-fiança residencial) já na etapa Minuta, com todos os documentos obrigatórios entregues e
-- minuta "elaborando"; locação P (mesma imobiliária) só para provar o isolamento entre locações.
-- Homologação: c2 = QA A Corretor Dois (dono), a1 = outro corretor da A, ges = QA A Corretor Tres (gestora),
-- con = QA A Dono Plataforma (setor de contratos), adm = QA A Admin, b1/admB = pessoas da Agência B.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
GRANT ALL ON r, ids, js TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('ges', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('con', 'b316b223-da46-4c2c-9952-25096d5ae5ff'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'),
  ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
INSERT INTO ids SELECT k, gen_random_uuid() FROM unnest(ARRAY['L', 'P']) k;

INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true),
  (pg_temp.id('orgB'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('ges'), 'gestora'),
  (pg_temp.id('orgA'), pg_temp.id('con'), 'contratos')
ON CONFLICT DO NOTHING;
INSERT INTO public.locacoes (id, organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, minuta, candidato)
SELECT pg_temp.id(k), pg_temp.id('orgA'), pg_temp.id('c2'), 'minuta', 'Rua Fictícia das Flores, 100 — Sorocaba/SP', 2000,
       'seguro_fianca', 'residencial', '{"estado":"elaborando","externa":false}', '{"nome":"Locatário Exemplo (fictício)"}'
  FROM unnest(ARRAY['L', 'P']) k;
INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo)
SELECT pg_temp.id('orgA'), l.id, x, 'minuta-teste/' || l.id || '/' || md5(x) || '.pdf', 'doc-ficticio.pdf'
  FROM public.locacoes l, unnest(public.locacao_checklist_l(l)) x WHERE l.id IN (pg_temp.id('L'), pg_temp.id('P'));
SELECT public.locacao_docs_situacao(v) FROM ids WHERE k IN ('L', 'P');
SET LOCAL ROLE authenticated;
