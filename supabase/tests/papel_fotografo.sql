-- Suíte do papel "Fotógrafo" (migrations 20261105130000 + 20261105130100, card t_0666d3f0, PR #269).
-- Transação revertida, banco local descartável; nunca produção. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.n(_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE _c int; BEGIN EXECUTE 'SELECT count(*)::int FROM (' || _sql || ') x' INTO _c; RETURN _c; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set org_b 'b0000000-0000-4000-8000-0000000000b0'
\set admin 'a0000000-0000-4000-8000-000000000001'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set foto 'a0000000-0000-4000-8000-000000000006'
\set staff2 'a0000000-0000-4000-8000-000000000007'
\set fotob 'b0000000-0000-4000-8000-000000000006'
\set ab 'b0000000-0000-4000-8000-000000000001'
\set cb 'b0000000-0000-4000-8000-000000000002'

-- Montagem ---------------------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-foto-papel-a', 'Imobiliaria Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-foto-papel-b', 'Imobiliaria Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'c1', :'foto', :'staff2', :'fotob', :'ab', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id, telefone) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a', '15990000001'),
  (:'c1', 'Carlos Um', 'c1@exemplo.test', true, :'org_a', '15990000004'),
  (:'foto', 'Paulo Foto', 'foto@exemplo.test', true, :'org_a', NULL),
  (:'staff2', 'Sara Staff', 'staff2@exemplo.test', true, :'org_a', '15990000007'),
  (:'fotob', 'Foto B', 'fotob@exemplo.test', true, :'org_b', NULL),
  (:'ab', 'Admin B', 'ab@exemplo.test', true, :'org_b', '15990000008'),
  (:'cb', 'Corretor B', 'cb@exemplo.test', true, :'org_b', '15990000009');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'c1', true), (:'org_a', :'foto', true), (:'org_a', :'staff2', true),
  (:'org_b', :'fotob', true), (:'org_b', :'ab', true), (:'org_b', :'cb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'c1', 'corretor', :'org_a'), (:'foto', 'fotografo', :'org_a'),
  (:'staff2', 'staff', :'org_a'), (:'fotob', 'fotografo', :'org_b'), (:'ab', 'admin', :'org_b'),
  (:'cb', 'corretor', :'org_b');
-- Módulos ligados (só dentro desta transação revertida) e dados fictícios das outras áreas.
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o, m, true FROM unnest(ARRAY[:'org_a', :'org_b']::uuid[]) o,
  unnest(ARRAY['vouchers_fotos', 'captacao_exclusiva', 'reserva_salas', 'mural_conquistas', 'leads', 'oportunidades',
               'feedback_proprietario', 'academia']) m
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.sales (organization_id, corretor_id) VALUES (:'org_a', :'c1'), (:'org_b', :'cb');
INSERT INTO public.clientes (organization_id) VALUES (:'org_a'), (:'org_b');
INSERT INTO public.metas (organization_id, tipo, mes, meta_comissao, corretor_id)
  VALUES (:'org_a', 'corretor', date_trunc('month', now())::date, 1000, :'c1');
INSERT INTO public.exclusive_captures (organization_id, captor_id, created_by, template, status, form_data)
  VALUES (:'org_a', :'c1', :'c1', 'campolim', 'rascunho', '{}'::jsonb);
INSERT INTO public.room_reservations (organization_id, room, reserved_date, start_time, end_time, responsible_id,
  responsible_name, purpose) VALUES (:'org_a', 'Sala 1', current_date + 1, '09:00', '10:00', :'c1', 'Carlos Um', 'Parceria');
INSERT INTO public.photo_settings (organization_id, fotografo_id, valor_sessao) VALUES
  (:'org_a', :'foto', 150), (:'org_b', :'fotob', 150);
INSERT INTO public.photo_sessions (organization_id, fotografo_id, corretor_id, capture_id, inicio, fim, ocupa_ate, paga_por)
SELECT :'org_a', :'foto', :'c1', c.id, t, t + interval '2 hours', t + interval '3 hours', 'corretor'
  FROM public.exclusive_captures c, (SELECT date_trunc('hour', now()) + interval '2 days' AS t) x
 WHERE c.organization_id = :'org_a' LIMIT 1;
SET LOCAL session_replication_role = origin;

-- 0) Catálogo --------------------------------------------------------------------------------------------
SELECT pg_temp.ok('fotografo' = ANY (enum_range(NULL::public.app_role)::text[]), 'app_role tem o valor fotografo');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE policyname = 'zz_fotografo_fora') >= 50,
  'barreira RESTRICTIVE zz_fotografo_fora criada nas tabelas das outras areas');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'zz_fotografo_fora'
   AND tablename IN ('profiles', 'user_roles', 'organization_members', 'organizations', 'organization_modules',
                     'notifications', 'photo_sessions', 'photo_agenda', 'photo_settings')),
  'barreira nao vale nas tabelas de entrada e nas photo_*');
SELECT pg_temp.ok(public.eh_so_fotografo(:'foto') AND NOT public.eh_so_fotografo(:'staff2')
  AND NOT public.eh_so_fotografo(:'c1') AND NOT public.eh_so_fotografo(NULL), 'eh_so_fotografo: so o papel fotografo sozinho');
SELECT pg_temp.ok(NOT public.cadastro_exige_registro(:'foto', :'org_a'),
  'cadastro: fotografo nao exige CPF / ID RE/MAX / CRECI');

-- 1) Fotógrafo da A: só a área de fotos ----------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok(public.current_org_id() = :'org_a', 'fotografo entra na imobiliaria A (contexto ok)');
SELECT pg_temp.ok(NOT public.is_active_user(:'foto'), 'is_active_user = false para o so-fotografo');
SELECT pg_temp.ok(NOT public.has_role(:'foto', 'fotografo') AND NOT public.has_any_role(:'foto', ARRAY['corretor', 'fotografo']::public.app_role[]),
  'has_role/has_any_role nao liberam nada ao so-fotografo');
SELECT pg_temp.ok(public.photo_eh_fotografo(:'org_a', :'foto'), 'photo_eh_fotografo aceita o papel fotografo');
SELECT pg_temp.ok(public.vouchers_fotos_enabled(), 'modulo de fotos segue visivel para ele');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.photo_sessions') = 1, 'le a sessao de fotos da A');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.photo_settings') = 1, 'le a configuracao de fotos da A');
SELECT pg_temp.ok((public.photo_meu_resumo()->>'eh_fotografo')::boolean, 'photo_meu_resumo: eh_fotografo = true');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_agenda_listar(current_date, current_date + 7)$q$) IS NULL,
  'photo_agenda_listar funciona para ele');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_faixa_salvar('livre', date_trunc('hour', now()) + interval '5 days', date_trunc('hour', now()) + interval '5 days 4 hours')$q$) IS NULL,
  'fotografo abre faixa livre na agenda');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.profiles WHERE id = auth.uid()') = 1, 'le o proprio perfil');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.profiles WHERE id <> auth.uid()') = 0, 'nao le perfis dos colegas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()') = 1, 'le o proprio papel');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.sales') = 0, 'vendas: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.clientes') = 0, 'clientes: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.metas') = 0, 'metas: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.exclusive_captures') = 0, 'captacoes: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.room_reservations') = 0, 'reserva de salas: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.achievement_posts') = 0, 'mural: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.teams') = 0, 'equipes: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.list_room_reservation_users()') = 0, 'lista de usuarios das salas: vazia');
SELECT pg_temp.ok(NOT public.exclusive_capture_enabled() AND NOT public.room_reservation_enabled()
  AND NOT public.achievements_enabled() AND NOT public.leads_enabled() AND NOT public.crm_enabled()
  AND NOT public.opportunities_enabled() AND NOT public.owner_feedback_enabled() AND NOT public.academia_enabled(),
  'outros modulos aparecem desligados para ele');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.carreira_ranking(current_date - 30, current_date)$q$) IS NOT NULL
   OR pg_temp.n($q$SELECT 1 FROM public.carreira_ranking(current_date - 30, current_date)$q$) = 0,
  'ranking da carreira: recusa ou vem vazio');
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.clientes (organization_id) VALUES ('a0000000-0000-4000-8000-0000000000a0')$q$) IS NOT NULL,
  'nao grava em clientes');
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.room_reservations (organization_id, room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose)
  VALUES ('a0000000-0000-4000-8000-0000000000a0', 'Sala 1', current_date + 2, '09:00', '10:00', 'a0000000-0000-4000-8000-000000000006', 'Paulo', 'Fotos')$q$) IS NOT NULL,
  'nao reserva sala');
-- Outra imobiliária
SELECT pg_temp.ok(pg_temp.n($q$SELECT 1 FROM public.photo_settings WHERE organization_id = 'b0000000-0000-4000-8000-0000000000b0'$q$) = 0,
  'nao le fotos da imobiliaria B');
SELECT pg_temp.ok(pg_temp.n($q$SELECT 1 FROM public.profiles WHERE id IN ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002')$q$) = 0,
  'nao le perfis da imobiliaria B');
SELECT pg_temp.ok(NOT public.photo_eh_fotografo(:'org_b', :'foto'), 'nao e fotografo da imobiliaria B');
RESET ROLE;

-- 2) Corretor e admin ficam iguais; o fotógrafo some das listas de corretor --------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(public.is_active_user(:'c1'), 'corretor segue ativo');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.sales') >= 1, 'corretor segue vendo a propria venda');
SELECT pg_temp.ok(public.exclusive_capture_enabled() AND public.room_reservation_enabled(), 'modulos seguem ligados para o corretor');
SELECT pg_temp.ok(NOT public.is_active_user(:'foto'), 'para o corretor, o fotografo nao e usuario ativo da agencia');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.photo_eh_admin(:'admin'), 'admin segue admin');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.room_reservations') >= 1, 'admin segue lendo a reserva de salas');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(public.photo_staff_listar()) e
                    WHERE e->>'id' IN ('a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000007')) = 2,
  'seletor de Configuracoes lista o fotografo e o staff');
SELECT pg_temp.ok((public.photo_configurar(:'staff2', 150)->>'fotografo_id') = :'staff2', 'staff continua podendo ser o fotografo');
SELECT pg_temp.ok(public.photo_eh_fotografo(:'org_a', :'staff2'), 'photo_eh_fotografo segue aceitando staff');
SELECT pg_temp.ok((public.photo_configurar(:'foto', 150)->>'fotografo_id') = :'foto', 'admin escolhe o usuario fotografo');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_configurar('a0000000-0000-4000-8000-000000000004', 150)$q$) LIKE '22023%staff ou fotografo%',
  'corretor continua recusado como fotografo');
SELECT pg_temp.ok(pg_temp.n($q$SELECT 1 FROM public.list_active_corretores() WHERE id = 'a0000000-0000-4000-8000-000000000006'$q$) = 0,
  'fotografo fora da lista de corretores ativos');
RESET ROLE;

-- 3) Fotógrafo da B não vê a A -------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'fotob');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.photo_sessions') = 0, 'fotografo B: 0 sessoes (a sessao e da A)');
SELECT pg_temp.ok(pg_temp.n($q$SELECT 1 FROM public.photo_settings WHERE organization_id = 'a0000000-0000-4000-8000-0000000000a0'$q$) = 0,
  'fotografo B nao le configuracao da A');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.sales') = 0, 'fotografo B: vendas 0');
RESET ROLE;

-- 4) Desativado: perde até a agenda --------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET ativo = false WHERE id = :'foto';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok(NOT public.photo_eh_fotografo(:'org_a', :'foto'), 'fotografo desativado perde a agenda');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET ativo = true WHERE id = :'foto';
SET LOCAL session_replication_role = origin;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
