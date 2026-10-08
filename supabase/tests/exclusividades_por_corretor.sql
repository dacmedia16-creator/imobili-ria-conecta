-- Aba "Por corretor" (Exclusividades › Painel e mapa). Roda DENTRO de transação revertida
-- (run-exclusividades-por-corretor.sh), em homologação ou clone, nunca produção. Sem migration nova:
-- confere que as regras que a tela usa (exclusive_captures RLS, painel_equipe_equipes, teams,
-- team_members, team_co_leaders) entregam a cada perfil só o que ele pode ver. Dados fictícios.
-- Perfis (homologação): gestor = UE Gestor (Equipe UE); TL = QA A Corretor Tres, promovido a
-- team_leader e líder da "Equipe Teste TL" só aqui; líder auxiliar = QA A Dono Plataforma
-- (team_leader e co-líder da Equipe UE só aqui); corretor comum = UE Corretor; outra equipe =
-- QA A Gestor (Equipe QA); admin = QA A Admin; outra imobiliária (no lugar da REMAX-TESTE, que não
-- existe na homologação) = QA B Admin.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid::text, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
-- Captadores das captações que a pessoa logada enxerga (o que listCaptures() devolve).
CREATE FUNCTION pg_temp.vejo() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(DISTINCT k.k, ',' ORDER BY k.k), '')
  FROM public.exclusive_captures c JOIN ids k ON k.v = c.captor_id
  WHERE c.id IN (SELECT v FROM ids WHERE k LIKE 'cap_%') $$;
-- Equipes oferecidas no seletor da aba (painel_equipe_equipes), pelos apelidos de teste.
CREATE FUNCTION pg_temp.equipes() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(k.k, ',' ORDER BY k.k), '')
  FROM jsonb_array_elements(public.painel_equipe_equipes()) e JOIN ids k ON k.v = (e->>'id')::uuid
  WHERE k.k LIKE 'team_%' $$;
-- Pessoas da equipe que a tela consegue montar (líder + co-líderes + membros), pelos apelidos.
CREATE FUNCTION pg_temp.pessoas(_team text) RETURNS text LANGUAGE sql AS $$
  WITH p AS (
    SELECT t.lider_id AS u FROM public.teams t WHERE t.id = pg_temp.id(_team)
    UNION SELECT c.user_id FROM public.team_co_leaders c WHERE c.team_id = pg_temp.id(_team)
    UNION SELECT m.membro_id FROM public.team_members m WHERE m.team_id = pg_temp.id(_team))
  SELECT coalesce(string_agg(DISTINCT k.k, ',' ORDER BY k.k), '') FROM p JOIN ids k ON k.v = p.u
  WHERE k.k NOT LIKE 'cap_%' AND k.k NOT LIKE 'team_%' $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES
  ('gestor', '10000000-0000-4000-8000-000000000002'), ('corretor', '10000000-0000-4000-8000-000000000003'),
  ('tl', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('aux', 'b316b223-da46-4c2c-9952-25096d5ae5ff'),
  ('membro_tl', '5745cbff-22b6-4a28-a515-dd6706504b8b'), ('outra_gestor', 'cab7391a-463f-4d97-b99b-ced6e4696796'),
  ('outra_corretor', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'),
  ('team_ue', '1a000000-0000-4000-8000-000000000001'), ('team_qa', 'ca3efa47-cbae-4e72-995e-f54fcb86f1d9');
UPDATE public.organization_modules SET enabled = true
  WHERE module = 'captacao_exclusiva' AND organization_id IN (:'org_a', :'org_b');
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;

-- Estrutura fictícia (só nesta transação): TL com equipe própria; líder auxiliar na Equipe UE.
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('tl'), 'team_leader'), (pg_temp.id('aux'), 'team_leader')
  ON CONFLICT DO NOTHING;
INSERT INTO ids SELECT 'team_tl', gen_random_uuid();
INSERT INTO public.teams (id, nome, lider_id, organization_id) VALUES (pg_temp.id('team_tl'), 'Equipe Teste TL', pg_temp.id('tl'), :'org_a');
DELETE FROM public.team_members WHERE membro_id = pg_temp.id('membro_tl');
INSERT INTO public.team_members (membro_id, team_id, organization_id, tipo)
  SELECT pg_temp.id('membro_tl'), pg_temp.id('team_tl'), :'org_a', tipo FROM public.team_members WHERE membro_id = pg_temp.id('corretor') LIMIT 1;
INSERT INTO public.team_co_leaders (team_id, user_id, organization_id) VALUES (pg_temp.id('team_ue'), pg_temp.id('aux'), :'org_a');

-- Captações fictícias: 2 do corretor da Equipe UE, 1 do corretor da Equipe QA, 1 do membro da equipe do TL.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('corretor'));
INSERT INTO ids SELECT 'cap_ue1', public.exclusive_create_unit(pg_temp.id('unit_a'));
INSERT INTO ids SELECT 'cap_ue2', public.exclusive_create_unit(pg_temp.id('unit_a'));
SELECT pg_temp.as_user(pg_temp.id('outra_corretor'));
INSERT INTO ids SELECT 'cap_qa1', public.exclusive_create_unit(pg_temp.id('unit_a'));
SELECT pg_temp.as_user(pg_temp.id('membro_tl'));
INSERT INTO ids SELECT 'cap_tl1', public.exclusive_create_unit(pg_temp.id('unit_a'));
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 20,
  form_data = form_data || jsonb_build_object(
    'imovel', jsonb_build_object('tipo_imovel', 'Casa', 'endereco', 'Rua Fictícia, 100', 'bairro', 'Campolim', 'valor_imovel', 'R$ 640.000,00'),
    'condicoes', (form_data->'condicoes') || '{"prazo_dias_numero":"180"}'::jsonb,
    'dossie', '["fotos","placa"]'::jsonb)
  WHERE id IN (pg_temp.id('cap_ue1'), pg_temp.id('cap_qa1'), pg_temp.id('cap_tl1'));
UPDATE public.exclusive_captures SET status = 'enviada' WHERE id = pg_temp.id('cap_ue2');
SELECT pg_temp.ok((SELECT count(*) = 4 FROM public.exclusive_captures WHERE id IN (SELECT v FROM ids WHERE k LIKE 'cap_%')), 'preparo: 4 captações fictícias');

SET LOCAL ROLE authenticated;
-- Gestor (UE Gestor): só a Equipe UE
SELECT pg_temp.as_user(pg_temp.id('gestor'));
SELECT pg_temp.ok(pg_temp.vejo() = 'corretor', 'gestor vê só as captações da própria equipe (' || pg_temp.vejo() || ')');
SELECT pg_temp.ok(pg_temp.equipes() = 'team_ue', 'gestor: seletor só com a Equipe UE (' || pg_temp.equipes() || ')');
SELECT pg_temp.ok(pg_temp.pessoas('team_ue') = 'aux,corretor,gestor', 'gestor monta as pessoas da equipe (' || pg_temp.pessoas('team_ue') || ')');
SELECT pg_temp.ok(pg_temp.pessoas('team_qa') = '', 'gestor não lê a composição de outra equipe (' || pg_temp.pessoas('team_qa') || ')');
-- Team Leader com equipe própria
SELECT pg_temp.as_user(pg_temp.id('tl'));
SELECT pg_temp.ok(pg_temp.vejo() = 'membro_tl', 'TL vê só o membro da equipe dele (' || pg_temp.vejo() || ')');
SELECT pg_temp.ok(pg_temp.equipes() = 'team_tl', 'TL: seletor só com a equipe dele (' || pg_temp.equipes() || ')');
SELECT pg_temp.ok(pg_temp.pessoas('team_tl') = 'membro_tl,tl', 'TL monta as pessoas da equipe (' || pg_temp.pessoas('team_tl') || ')');
-- Líder auxiliar da Equipe UE
SELECT pg_temp.as_user(pg_temp.id('aux'));
SELECT pg_temp.ok(pg_temp.vejo() = 'corretor', 'líder auxiliar vê a Equipe UE (' || pg_temp.vejo() || ')');
SELECT pg_temp.ok(pg_temp.equipes() = 'team_ue', 'líder auxiliar: seletor com a Equipe UE (' || pg_temp.equipes() || ')');
-- Corretor comum: só as próprias, e a aba não oferece equipe
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SELECT pg_temp.ok(pg_temp.vejo() = 'corretor', 'corretor comum vê só as próprias (' || pg_temp.vejo() || ')');
SELECT pg_temp.ok(pg_temp.equipes() = '', 'corretor comum: nenhuma equipe no seletor (' || pg_temp.equipes() || ')');
-- Gestor de outra equipe
SELECT pg_temp.as_user(pg_temp.id('outra_gestor'));
SELECT pg_temp.ok(pg_temp.vejo() = 'outra_corretor', 'gestor de outra equipe não vê a Equipe UE (' || pg_temp.vejo() || ')');
SELECT pg_temp.ok(pg_temp.equipes() = 'team_qa', 'gestor de outra equipe: só a Equipe QA (' || pg_temp.equipes() || ')');
-- Admin: todas as equipes e todas as captações da imobiliária
SELECT pg_temp.as_user(pg_temp.id('admin'));
SELECT pg_temp.ok(pg_temp.vejo() = 'corretor,membro_tl,outra_corretor', 'admin vê todas (' || pg_temp.vejo() || ')');
SELECT pg_temp.ok(pg_temp.equipes() = 'team_qa,team_tl,team_ue', 'admin escolhe entre as 3 equipes (' || pg_temp.equipes() || ')');
SELECT pg_temp.ok(pg_temp.pessoas('team_tl') = 'membro_tl,tl', 'admin monta as pessoas de qualquer equipe');
-- Outra imobiliária (admin B)
SELECT pg_temp.as_user(pg_temp.id('b_admin'));
SELECT pg_temp.ok(pg_temp.vejo() = '', 'outra imobiliária não vê nada da A (' || pg_temp.vejo() || ')');
SELECT pg_temp.ok(pg_temp.equipes() = '', 'outra imobiliária: nenhuma equipe da A (' || pg_temp.equipes() || ')');
SELECT pg_temp.ok(pg_temp.pessoas('team_ue') = '', 'outra imobiliária não lê a composição da Equipe UE');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) || ' falhas de ' || count(*) FROM r;
