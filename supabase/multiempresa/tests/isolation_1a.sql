-- Testes de isolamento A↔B do marco 1a. Roda dentro de uma transação e desfaz tudo (ROLLBACK).
-- Pré-requisito: clone local + seed_legacy.sql + migration 20260928000000 aplicados.
-- A = Única Escolha (legado, 1xxxxxxx); B = nova agência sintética (2xxxxxxx); Denis = super-admin da plataforma.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_test;
CREATE TABLE mt_test.results (n serial, name text, ok boolean, detail text);
GRANT USAGE ON SCHEMA mt_test TO authenticated;
GRANT ALL ON mt_test.results TO authenticated;
GRANT ALL ON SEQUENCE mt_test.results_n_seq TO authenticated;

CREATE FUNCTION mt_test.check(_name text, _ok boolean, _detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO mt_test.results (name, ok, detail) VALUES (_name, coalesce(_ok, false), _detail) $$;
CREATE FUNCTION mt_test.cnt(_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE 'SELECT count(*) FROM (' || _sql || ') s' INTO n; RETURN n; END $$;
-- Executa comando; devolve 'ok:<linhas afetadas>' ou 'erro:<sqlstate>'.
CREATE FUNCTION mt_test.try(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE _sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN 'ok:' || n;
EXCEPTION WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE;
END $$;
CREATE FUNCTION mt_test.login(_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
-- Volta a "servidor": limpa o JWT simulado (seguido de RESET ROLE no script).
CREATE FUNCTION mt_test.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_test TO authenticated;

-- ---------------- Preparação (como servidor) ----------------
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'denis.platform@example.test', '{"nome":"Denis Plataforma"}', '{}');
INSERT INTO public.platform_admins (user_id) VALUES ('d0000000-0000-4000-8000-000000000001');

-- Admin da agência A (app_role admin/super_admin legado) NÃO cria imobiliária.
SELECT mt_test.login('10000000-0000-4000-8000-000000000001');
SELECT mt_test.check('A admin nao cria organizacao',
  mt_test.try($$SELECT public.platform_create_organization('agencia-x', 'Agencia X')$$) = 'erro:42501');
SELECT mt_test.check('A admin nao insere em organizations direto',
  mt_test.try($$INSERT INTO public.organizations (slug, nome) VALUES ('agencia-y', 'Y')$$) LIKE 'erro:%');
SELECT mt_test.logout(); RESET ROLE;

-- Denis (super-admin da plataforma) cria a agência B.
SELECT mt_test.login('d0000000-0000-4000-8000-000000000001');
SELECT public.platform_create_organization('agencia-b', 'Agencia B Sintetica') AS org_b \gset
SELECT mt_test.logout(); RESET ROLE;
SELECT mt_test.check('Denis cria organizacao B', :'org_b' IS NOT NULL);

-- Usuários de B criados pelo servidor com organização em app_metadata (não gravável pelo usuário).
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES
  ('20000000-0000-4000-8000-000000000001', 'b.admin@example.test',    '{"nome":"B Admin"}',    json_build_object('organization_id', :'org_b')::jsonb),
  ('20000000-0000-4000-8000-000000000002', 'b.gestor@example.test',   '{"nome":"B Gestor"}',   json_build_object('organization_id', :'org_b')::jsonb),
  ('20000000-0000-4000-8000-000000000003', 'b.corretor@example.test', '{"nome":"B Corretor"}', json_build_object('organization_id', :'org_b')::jsonb),
  ('20000000-0000-4000-8000-000000000004', 'b.fin@example.test',      '{"nome":"B Fin"}',      json_build_object('organization_id', :'org_b')::jsonb);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('20000000-0000-4000-8000-000000000001', 'admin'),
  ('20000000-0000-4000-8000-000000000001', 'super_admin'),
  ('20000000-0000-4000-8000-000000000002', 'gestor'),
  ('20000000-0000-4000-8000-000000000004', 'financeiro');
SELECT mt_test.check('perfis de B atribuídos a B',
  (SELECT count(*) FROM public.profiles WHERE id::text LIKE '20000000%' AND organization_id = :'org_b') = 4);
SELECT mt_test.check('papeis de B herdam organizacao B',
  (SELECT bool_and(organization_id = :'org_b') FROM public.user_roles WHERE user_id::text LIKE '20000000%'));
SELECT mt_test.check('usuario novo sem organizacao explicita e criado',
  mt_test.try($$INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ('30000000-0000-4000-8000-000000000009', 'x@example.test', '{}')$$) = 'ok:1');
SELECT mt_test.check('usuario novo sem organizacao explicita cai no legado (transicao)',
  (SELECT organization_id FROM public.profiles WHERE id = '30000000-0000-4000-8000-000000000009') = '00000000-0000-4000-8000-000000000001');
SELECT mt_test.check('organizacao inexistente em app_metadata falha',
  mt_test.try($$INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ('30000000-0000-4000-8000-000000000010', 'y@example.test', '{"organization_id":"99999999-0000-4000-8000-000000000000"}')$$) LIKE 'erro:%');

-- ---------------- Escrita de B pela própria agência (autenticado) ----------------
SELECT mt_test.login('20000000-0000-4000-8000-000000000002');  -- gestor B cria equipe
SELECT mt_test.check('B gestor cria equipe',
  mt_test.try($$INSERT INTO public.teams (id, lider_id, nome) VALUES ('2a000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Equipe B')$$) = 'ok:1');
SELECT mt_test.check('B gestor adiciona corretor B na equipe',
  mt_test.try($$INSERT INTO public.team_members (membro_id, team_id, tipo) VALUES ('20000000-0000-4000-8000-000000000003', '2a000000-0000-4000-8000-000000000001', 'corretor')$$) = 'ok:1');
SELECT mt_test.check('B gestor NAO adiciona corretor A na equipe B (FK composta)',
  mt_test.try($$INSERT INTO public.team_members (membro_id, team_id, tipo) VALUES ('10000000-0000-4000-8000-000000000004', '2a000000-0000-4000-8000-000000000001', 'corretor')$$) LIKE 'erro:%');
SELECT mt_test.logout(); RESET ROLE;

SELECT mt_test.login('20000000-0000-4000-8000-000000000003');  -- corretor B
SELECT mt_test.check('B corretor cria cliente com mesmo CPF de cliente A (unicidade por organizacao)',
  mt_test.try($$INSERT INTO public.clientes (id, tipo_pessoa, nome, cpf_cnpj) VALUES ('2c000000-0000-4000-8000-000000000001', 'fisica', 'Cliente B', '111.444.777-35')$$) = 'ok:1');
SELECT mt_test.check('CPF repetido dentro de B continua bloqueado',
  mt_test.try($$INSERT INTO public.clientes (tipo_pessoa, nome, cpf_cnpj) VALUES ('fisica', 'Dup', '11144477735')$$) = 'erro:23505');
SELECT mt_test.check('B corretor forja organization_id de A no insert -> gravado em B',
  mt_test.try($$INSERT INTO public.clientes (id, tipo_pessoa, nome, organization_id) VALUES ('2c000000-0000-4000-8000-000000000002', 'fisica', 'Forjado', '00000000-0000-4000-8000-000000000001')$$) = 'ok:1');
SELECT mt_test.check('B corretor cria venda com mesmo imovel_id de A',
  mt_test.try($$INSERT INTO public.sales (id, corretor_id, imovel_id) VALUES ('25000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'IMV-001')$$) = 'ok:1');
SELECT mt_test.check('B corretor cria pagamento da propria venda',
  mt_test.try($$INSERT INTO public.sale_payment (sale_id) VALUES ('25000000-0000-4000-8000-000000000001')$$) = 'ok:1');
SELECT mt_test.check('B corretor cria documento da propria venda',
  mt_test.try($$INSERT INTO public.sale_documents (sale_id, tipo, parte) VALUES ('25000000-0000-4000-8000-000000000001', 'rg', 'comprador_1')$$) = 'ok:1');
SELECT mt_test.check('B corretor reserva mesma sala/horario ja reservado em A (exclusao por organizacao)',
  mt_test.try($$INSERT INTO public.room_reservations (room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose) VALUES ('Barão Sala 1', current_date + 3, '10:00', '11:00', '20000000-0000-4000-8000-000000000003', 'B Corretor', 'Reunião com cliente')$$) = 'ok:1');
SELECT mt_test.check('sobreposicao dentro de B continua bloqueada',
  mt_test.try($$INSERT INTO public.room_reservations (room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose) VALUES ('Barão Sala 1', current_date + 3, '10:30', '11:30', '20000000-0000-4000-8000-000000000003', 'B Corretor', 'Reunião com cliente')$$) = 'erro:23P01');
SELECT mt_test.check('B corretor NAO convida participante de A',
  mt_test.try($$INSERT INTO public.room_reservations (room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose, participant_user_ids) VALUES ('Barão Sala 2', current_date + 3, '10:00', '11:00', '20000000-0000-4000-8000-000000000003', 'B Corretor', 'Reunião com cliente', ARRAY['10000000-0000-4000-8000-000000000003']::uuid[])$$) = 'erro:42501');
SELECT mt_test.check('B corretor NAO cria pagamento em venda de A',
  mt_test.try($$INSERT INTO public.sale_documents (sale_id, tipo, parte) VALUES ('15000000-0000-4000-8000-000000000001', 'rg', 'comprador_2')$$) LIKE 'erro:%');
SELECT mt_test.logout(); RESET ROLE;
INSERT INTO public.occurrences (sale_id) VALUES ('25000000-0000-4000-8000-000000000001');
SELECT mt_test.check('ocorrencia de B herda organizacao B',
  (SELECT organization_id FROM public.occurrences WHERE sale_id = '25000000-0000-4000-8000-000000000001') = :'org_b');
SELECT mt_test.check('cliente forjado ficou em B',
  (SELECT organization_id FROM public.clientes WHERE id = '2c000000-0000-4000-8000-000000000002') = :'org_b');
SELECT mt_test.check('servidor tenta gravar filho com organizacao divergente do pai',
  mt_test.try($$UPDATE public.sale_payment SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE sale_id = '25000000-0000-4000-8000-000000000001'$$) = 'ok:1');
SELECT mt_test.check('servidor NAO grava filho com organizacao divergente do pai (trigger corrige para a do pai)',
  (SELECT organization_id FROM public.sale_payment WHERE sale_id = '25000000-0000-4000-8000-000000000001') = :'org_b');

-- Regiões de posicionamento: mesmo nome nas duas agências
SELECT mt_test.login('20000000-0000-4000-8000-000000000001');  -- admin B
SELECT mt_test.check('B admin cria regiao com mesmo (cidade,nome,tipo) de A',
  mt_test.try($$INSERT INTO public.positioning_regions (id, cidade, nome, tipo) VALUES (2001, 'Sorocaba', 'Campolim', 'bairro')$$) = 'ok:1');
SELECT mt_test.logout(); RESET ROLE;
INSERT INTO public.positioning_region_suggestions (id, suggested_by, cidade, nome, tipo, organization_id) VALUES
  ('2e000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'Sorocaba', 'Jardim B', 'bairro', :'org_b'),
  ('1e000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'Sorocaba', 'Campolim', 'bairro', '00000000-0000-4000-8000-000000000001');

-- ---------------- Leitura cruzada ----------------
CREATE FUNCTION mt_test.visible_other(_prefix text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text; n bigint; res text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','user_roles','teams','team_members','clientes','sales','sale_payment',
    'sale_documents','occurrences','room_reservations','positioning_regions','positioning_region_suggestions',
    'corretor_positioning_regions','organization_members','organizations']
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', t,
      CASE WHEN t = 'organizations' THEN 'id <> public.current_org_id()'
           ELSE 'organization_id IS DISTINCT FROM public.current_org_id()' END) INTO n;
    IF n > 0 THEN res := res || t || '=' || n || ' '; END IF;
  END LOOP;
  RETURN res;
END $$;
GRANT EXECUTE ON FUNCTION mt_test.visible_other(text) TO authenticated;

DO $$ BEGIN NULL; END $$;
SELECT mt_test.login('10000000-0000-4000-8000-000000000001');
SELECT mt_test.check('A admin le 0 linhas de B em todas as tabelas nucleo', mt_test.visible_other('') = '', mt_test.visible_other(''));
SELECT mt_test.check('A admin continua vendo o legado (venda A)', mt_test.cnt('SELECT 1 FROM public.sales') = 1);
SELECT mt_test.check('A admin: can_view_sale em venda B = false',
  NOT public.can_view_sale('10000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001'));
SELECT mt_test.check('A admin: list_room_occupancy so da propria agencia', mt_test.cnt('SELECT 1 FROM public.list_room_occupancy()') = 1);
SELECT mt_test.check('A admin: list_room_reservation_users so da propria agencia',
  mt_test.cnt($$SELECT 1 FROM public.list_room_reservation_users() WHERE id::text LIKE '20000000%'$$) = 0
  AND mt_test.cnt('SELECT 1 FROM public.list_room_reservation_users()') >= 4);
SELECT mt_test.check('A admin NAO aprova sugestao de B',
  mt_test.try($$SELECT public.review_positioning_region_suggestion('2e000000-0000-4000-8000-000000000001', 'aprovar')$$) = 'erro:P0001');
SELECT mt_test.check('A admin aprova sugestao propria (upsert por organizacao, reaproveita regiao A)',
  (SELECT public.review_positioning_region_suggestion('1e000000-0000-4000-8000-000000000001', 'aprovar')) = 1001);
SELECT mt_test.logout(); RESET ROLE;

SELECT mt_test.login('10000000-0000-4000-8000-000000000004');
SELECT mt_test.check('A financeiro le 0 linhas de B', mt_test.visible_other('') = '', mt_test.visible_other(''));
SELECT mt_test.check('A financeiro NAO altera venda B',
  mt_test.try($$UPDATE public.sales SET imovel_id = 'X' WHERE id = '25000000-0000-4000-8000-000000000001'$$) = 'ok:0');
SELECT mt_test.check('A financeiro NAO apaga pagamento B',
  mt_test.try($$DELETE FROM public.sale_payment WHERE sale_id = '25000000-0000-4000-8000-000000000001'$$) = 'ok:0');
SELECT mt_test.logout(); RESET ROLE;

SELECT mt_test.login('10000000-0000-4000-8000-000000000003');
SELECT mt_test.check('A corretor NAO salva posicionamento com regiao de B',
  mt_test.try($$SELECT public.save_my_positioning(ARRAY[2001]::bigint[], true)$$) = 'erro:P0001');
SELECT mt_test.check('A corretor salva posicionamento com regiao propria',
  mt_test.try($$SELECT public.save_my_positioning(ARRAY[1001]::bigint[], true)$$) = 'ok:1');
SELECT mt_test.check('A corretor ve a propria venda legada', mt_test.cnt('SELECT 1 FROM public.sales') = 1);
SELECT mt_test.check('A corretor NAO move cliente para B',
  mt_test.try($$UPDATE public.clientes SET organization_id = '$$ || (SELECT id FROM public.organizations WHERE slug = 'agencia-b') || $$' WHERE id = '1c000000-0000-4000-8000-000000000001'$$) LIKE 'erro:%');
SELECT mt_test.logout(); RESET ROLE;

SELECT mt_test.login('20000000-0000-4000-8000-000000000001');
SELECT mt_test.check('B admin (app_role super_admin da agencia) le 0 linhas de A', mt_test.visible_other('') = '', mt_test.visible_other(''));
SELECT mt_test.check('B admin NAO altera cliente A',
  mt_test.try($$UPDATE public.clientes SET nome = 'hack' WHERE id = '1c000000-0000-4000-8000-000000000001'$$) = 'ok:0');
SELECT mt_test.check('B admin NAO apaga venda A',
  mt_test.try($$DELETE FROM public.sales WHERE id = '15000000-0000-4000-8000-000000000001'$$) = 'ok:0');
SELECT mt_test.check('B admin NAO altera papel de usuario A',
  mt_test.try($$UPDATE public.user_roles SET role = 'admin' WHERE user_id = '10000000-0000-4000-8000-000000000003'$$) = 'ok:0');
SELECT mt_test.check('B admin NAO cria papel para usuario A',
  mt_test.try($$INSERT INTO public.user_roles (user_id, role) VALUES ('10000000-0000-4000-8000-000000000003', 'financeiro')$$) LIKE 'erro:%');
SELECT mt_test.check('B admin NAO cancela reserva de A',
  mt_test.try($$UPDATE public.room_reservations SET status = 'canceled' WHERE responsible_id = '10000000-0000-4000-8000-000000000003'$$) = 'ok:0');
SELECT mt_test.check('B admin: list_room_occupancy so de B', mt_test.cnt('SELECT 1 FROM public.list_room_occupancy()') = 1);
SELECT mt_test.check('B admin aprova sugestao de B (nova regiao em B)',
  mt_test.try($$SELECT public.review_positioning_region_suggestion('2e000000-0000-4000-8000-000000000001', 'aprovar')$$) = 'ok:1');
SELECT mt_test.check('B admin NAO ve organizacao A', mt_test.cnt('SELECT 1 FROM public.organizations') = 1);
SELECT mt_test.logout(); RESET ROLE;
SELECT mt_test.check('regiao aprovada em B pertence a B',
  (SELECT organization_id FROM public.positioning_regions WHERE nome = 'Jardim B') = :'org_b');

-- Denis (plataforma) sem membership de agência: não lê dados operacionais de nenhuma agência pela RLS.
SELECT mt_test.login('d0000000-0000-4000-8000-000000000001');
SELECT mt_test.check('super-admin da plataforma ve as duas organizacoes', mt_test.cnt('SELECT 1 FROM public.organizations') = 2);
SELECT mt_test.logout(); RESET ROLE;

-- Membro inativo / agência suspensa: fica sem acesso.
UPDATE public.organizations SET status = 'suspensa' WHERE id = :'org_b';
SELECT mt_test.login('20000000-0000-4000-8000-000000000001');
SELECT mt_test.check('agencia suspensa: admin B le 0 vendas', mt_test.cnt('SELECT 1 FROM public.sales') = 0);
SELECT mt_test.check('agencia suspensa: admin B nao cria cliente',
  mt_test.try($$INSERT INTO public.clientes (tipo_pessoa, nome) VALUES ('fisica', 'z')$$) = 'erro:42501');
SELECT mt_test.logout(); RESET ROLE;
UPDATE public.organizations SET status = 'ativa' WHERE id = :'org_b';

SELECT mt_test.login(NULL);
SELECT mt_test.check('anonimo/sem sub le 0 vendas', mt_test.cnt('SELECT 1 FROM public.sales') = 0);
SELECT mt_test.logout(); RESET ROLE;

-- ---------------- Resultado ----------------
SELECT n, CASE WHEN ok THEN 'ok' ELSE 'FALHOU' END AS status, name, coalesce(detail, '') FROM mt_test.results ORDER BY n;
SELECT format('TOTAL=%s OK=%s FALHAS=%s', count(*), count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)) FROM mt_test.results;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM mt_test.results WHERE NOT ok) THEN RAISE EXCEPTION 'Ha testes falhando'; END IF;
END $$;
ROLLBACK;
