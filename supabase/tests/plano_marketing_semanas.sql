-- Suíte do Plano de Marketing por semanas (migration 20261009020000). Roda DENTRO de transação revertida
-- (run-plano-marketing-semanas.sh). Homologação: A = Única (00000000-…-0001), B = agencia-b-homolog.
-- Perfis: captador (UE Corretor), gestor da equipe (UE Gestor), corretor de outra equipe (QA A Corretor Dois),
-- admin (QA A Admin) e admin da imobiliária B. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
-- Dia da aprovação no calendário de SP (a homologação roda em UTC).
CREATE FUNCTION pg_temp.ap() RETURNS date LANGUAGE sql AS
  $$ SELECT ((now() - interval '20 days') AT TIME ZONE 'America/Sao_Paulo')::date $$;
CREATE FUNCTION pg_temp.atr(_cap text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.exclusive_feedback_pendencias(7) WHERE kind = 'atrasada' AND capture_id = pg_temp.id(_cap) $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('outra', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
UPDATE public.organization_modules SET enabled = true
 WHERE module IN ('captacao_exclusiva', 'feedback_proprietario') AND organization_id IN (:'org_a', :'org_b');
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
INSERT INTO ids SELECT 'a_vital', id FROM public.owner_feedback_actions WHERE organization_id = :'org_a' AND list = 'marketing' AND active AND weight = 'vital' ORDER BY sort LIMIT 1;
INSERT INTO ids SELECT 'a_imp', id FROM public.owner_feedback_actions WHERE organization_id = :'org_a' AND list = 'marketing' AND active AND weight = 'importante' ORDER BY sort LIMIT 1;
INSERT INTO ids SELECT 'a_comp', id FROM public.owner_feedback_actions WHERE organization_id = :'org_a' AND list = 'marketing' AND active AND weight = 'complementar' ORDER BY sort LIMIT 1;

-- c1 = plano novo (por semanas); c2 = plano antigo (sem semanas). Aprovadas há 20 dias.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'c' || g, public.exclusive_create_unit(pg_temp.id('unit_a')) FROM generate_series(1, 2) g;
RESET ROLE;
SELECT jsonb_build_array(pg_temp.id('a_vital'), pg_temp.id('a_imp'), pg_temp.id('a_comp')) AS dossie \gset
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 20,
  form_data = form_data || jsonb_build_object('imovel', jsonb_build_object('tipo_imovel', 'Casa', 'bairro', 'Jardim Fictício'),
    'dossie', :'dossie'::jsonb)
 WHERE id IN (pg_temp.id('c1'), pg_temp.id('c2'));
INSERT INTO public.exclusive_history (capture_id, actor_id, action, created_at)
  SELECT v, pg_temp.id('gestor'), 'aprovar', now() - interval '20 days' FROM ids WHERE k IN ('c1', 'c2');
-- Semanas do plano novo: essencial S1; importante S1, S2, S3; complementar S4 (gravado antes da aprovação
-- no fluxo real; aqui direto, sem disparar o histórico de alteração).
ALTER TABLE public.exclusive_captures DISABLE TRIGGER trg_zz_exclusive_plan_change;
UPDATE public.exclusive_captures SET form_data = form_data || jsonb_build_object('plano_semanas', jsonb_build_object(
    pg_temp.id('a_vital')::text, '[1]'::jsonb, pg_temp.id('a_imp')::text, '[3, 1, 2, 2]'::jsonb, pg_temp.id('a_comp')::text, '[4]'::jsonb))
 WHERE id = pg_temp.id('c1');
ALTER TABLE public.exclusive_captures ENABLE TRIGGER trg_zz_exclusive_plan_change;

-- 0) Regras puras e trava de envio/aprovação
SELECT pg_temp.ok(ARRAY(SELECT public.exclusive_plan_semanas('{"plano_semanas":{"00000000-0000-0000-0000-000000000001":[3,1,2,2,0,999,"x"]}}', '00000000-0000-0000-0000-000000000001')) = '{1,2,3}'::smallint[],
  'semanas: ordena, tira repetidas e ignora inválidas');
SELECT pg_temp.ok(ARRAY(SELECT public.exclusive_plan_semanas('{}', gen_random_uuid())) = '{0}'::smallint[], 'sem semanas = item único com prazo automático (plano antigo)');
SELECT pg_temp.ok(public.exclusive_plano_ok(:'org_a', (SELECT form_data FROM public.exclusive_captures WHERE id = pg_temp.id('c1'))), 'trava: plano novo com semana em cada ação passa');
SELECT pg_temp.ok(NOT public.exclusive_plano_ok(:'org_a', jsonb_build_object('dossie', :'dossie'::jsonb,
  'plano_semanas', jsonb_build_object(pg_temp.id('a_vital')::text, '[1]'::jsonb, pg_temp.id('a_imp')::text, '[]'::jsonb))), 'trava: ação marcada sem semana bloqueia enviar/aprovar');
SELECT pg_temp.ok(public.exclusive_plano_ok(:'org_a', jsonb_build_object('dossie', :'dossie'::jsonb)), 'trava: plano antigo (sem semanas) continua aceito');
SELECT pg_temp.ok(NOT public.exclusive_plano_ok(:'org_a', jsonb_build_object('plano_semanas', '{}'::jsonb)), 'trava: plano vazio continua bloqueado');

SET LOCAL ROLE authenticated;
-- 1) Captador: checklist por semana
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE in_plan) = 5, 'plano novo: 1 item por ação + semana (1 + 3 + 1 = 5)');
SELECT pg_temp.ok((SELECT semana_inicio = pg_temp.ap() + 7 AND prazo = pg_temp.ap() + 13
  FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE action_id = pg_temp.id('a_imp') AND semana = 2), 'semana 2: aprovação + 7 até aprovação + 13 (prazo = último dia)');
SELECT pg_temp.ok((SELECT prazo FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE action_id = pg_temp.id('a_vital')) = pg_temp.ap() + 6, 'semana 1 começa na aprovação (prazo = aprovação + 6)');
SELECT pg_temp.ok((SELECT count(*) = 3 AND bool_and(semana = 0) AND min(prazo) = pg_temp.ap() + 7 FROM public.exclusive_plan_view(pg_temp.id('c2'))), 'plano antigo intacto: 3 itens, prazo por peso');
SELECT public.exclusive_plan_mark(pg_temp.id('c1'), pg_temp.id('a_imp'), current_date - 10, NULL, NULL, 2);
SELECT pg_temp.ok((SELECT count(*) FILTER (WHERE done_on IS NOT NULL) = 1 AND bool_or(semana = 2 AND done_on = current_date - 10 AND done_by_nome IS NOT NULL)
  FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE action_id = pg_temp.id('a_imp')), 'marcar semana 2: só ela fica feita, com data e quem marcou');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plan_mark(%L,%L,%L,NULL,NULL,5)', pg_temp.id('c1'), pg_temp.id('a_imp'), current_date)) LIKE '%Semana fora%', 'semana não escolhida: recusa');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plan_mark(%L,%L,%L)', pg_temp.id('c1'), pg_temp.id('a_imp'), current_date)) LIKE '%Semana fora%', 'plano novo: marcação sem semana recusada');
SELECT public.exclusive_plan_mark(pg_temp.id('c2'), pg_temp.id('a_vital'), current_date - 15);
SELECT pg_temp.ok((SELECT done_on = current_date - 15 FROM public.exclusive_plan_view(pg_temp.id('c2')) WHERE action_id = pg_temp.id('a_vital')), 'plano antigo: marcar sem semana continua funcionando');
SELECT pg_temp.ok((SELECT detail FROM public.exclusive_history WHERE capture_id = pg_temp.id('c1') AND action = 'plano_feito' ORDER BY id DESC LIMIT 1) LIKE '%(Semana 2)%', 'histórico registra a semana');

-- 2) Outra equipe e imobiliária B
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plan_mark(%L,%L,%L,NULL,NULL,1)', pg_temp.id('c1'), pg_temp.id('a_vital'), current_date)) LIKE '42501%', 'outra equipe: não marca semana');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plan_unmark(%L,%L,2)', pg_temp.id('c1'), pg_temp.id('a_imp'))) LIKE '42501%', 'outra equipe: não desmarca');
SELECT pg_temp.ok(pg_temp.err(format('SELECT * FROM public.exclusive_plan_view(%L)', pg_temp.id('c1'))) LIKE '42501%', 'outra equipe: não vê o plano');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT * FROM public.exclusive_plan_view(%L)', pg_temp.id('c1'))) LIKE '42501%', 'imobiliária B: não vê o plano');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_plan_done) = 0, 'imobiliária B: nenhuma marcação visível');

-- 3) Gestor: atrasada = passou do fim da semana escolhida
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
-- c1: S1 essencial (fim há 14 dias) e S1 importante atrasadas; S2 feita; S3 termina hoje; S4 no futuro.
SELECT pg_temp.ok(pg_temp.atr('c1') = 2, 'painel: c1 com 2 atrasadas (semana 1 das duas ações)');
SELECT pg_temp.ok((SELECT bool_and(acao LIKE '%(Semana 1)') FROM public.exclusive_feedback_pendencias(7) WHERE kind = 'atrasada' AND capture_id = pg_temp.id('c1')), 'painel: mostra a semana da ação atrasada');
SELECT pg_temp.ok(pg_temp.atr('c2') = 1, 'painel: plano antigo segue o prazo por peso (importante atrasada; essencial feita)');
SELECT public.exclusive_plan_mark(pg_temp.id('c1'), pg_temp.id('a_vital'), current_date - 1, NULL, NULL, 1);
SELECT pg_temp.ok(pg_temp.atr('c1') = 1, 'gestor da equipe marca a semana 1: sai do painel');
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok(pg_temp.atr('c1') = 1, 'admin vê o painel da imobiliária');
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT public.exclusive_plan_unmark(pg_temp.id('c1'), pg_temp.id('a_imp'), 2);
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE done_on IS NOT NULL) = 1, 'desmarcar semana 2 não mexe na semana 1');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.exclusive_feedback_pendencias(7)') LIKE '42501%', 'corretor não abre o painel do gestor');

-- 4) Semanas alteradas depois da aprovação: registra e guarda o que foi feito
RESET ROLE;
UPDATE public.exclusive_captures SET form_data = jsonb_set(form_data, ARRAY['plano_semanas', pg_temp.id('a_vital')::text], '[2]'::jsonb)
 WHERE id = pg_temp.id('c1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT detail FROM public.exclusive_history WHERE capture_id = pg_temp.id('c1') AND action = 'plano_alterado' ORDER BY id DESC LIMIT 1) LIKE '%semanas alteradas%', 'semanas alteradas após aprovação vão ao histórico');
SELECT pg_temp.ok((SELECT NOT in_plan AND done_on IS NOT NULL FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE action_id = pg_temp.id('a_vital') AND semana = 1), 'semana feita que saiu do plano continua guardada');
SELECT pg_temp.ok((SELECT in_plan AND done_on IS NULL FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE action_id = pg_temp.id('a_vital') AND semana = 2), 'semana nova entra pendente');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
