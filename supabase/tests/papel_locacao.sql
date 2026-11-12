-- Suíte do papel geral "Locação" (migrations 20261122120000 + 20261122120100, card t_1fe07126).
-- Transação revertida na HOMOLOGAÇÃO (run-papel-locacao.sh); nunca produção. Os papéis abaixo só mudam dentro
-- da transação. Homologação: A = Agência A (…-0001), B = outra imobiliária.
--   loc  = UE Corretor (…-0003): vira SÓ 'locacao' (tinha corretor e 1 venda: prova que a venda some para ele)
--   c2   = QA A Corretor Dois: corretor dono de locação; ganha 'locacao' + corretor (deve continuar vendo tudo)
--   ges  = QA A Corretor Tres (gestora da locação), adm = QA A Admin, b1 = QA B Corretor Um.
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
CREATE FUNCTION pg_temp.n(_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE _c int; BEGIN EXECUTE 'SELECT count(*)::int FROM (' || _sql || ') x' INTO _c; RETURN _c; END $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
-- Ficha completa fictícia (mesma de locacao-ficha.sql).
CREATE FUNCTION pg_temp.ficha(_cap uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'candidato', jsonb_build_object('cpf', '000.111.222-33', 'nome', 'Locatário Exemplo (fictício)', 'nascimento', '1990-04-12',
      'telefone', '(15) 90000-0001', 'email', 'locatario.exemplo@teste.invalid'),
    'endereco', 'Rua Fictícia das Flores, 100 — Ap 11, Sorocaba/SP', 'tipo', 'residencial', 'garantia', 'fiador',
    'aluguel', 2000, 'condominio', 450, 'iptu', 80, 'taxa_adm', 10, 'parceria', false, 'captador_id', _cap,
    'ficha', jsonb_build_object('imovel_id', 'IM-9001', 'mobilia', 'semi', 'metragem', 68.5,
      'locatario_endereco', 'Rua Atual Fictícia, 5 — Sorocaba/SP',
      'proprietario', jsonb_build_object('nome', 'Proprietário Exemplo (fictício)', 'telefone', '(15) 90000-0002',
        'email', 'prop.exemplo@teste.invalid'))) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'),
  ('loc', '10000000-0000-4000-8000-000000000003'), ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'),
  ('ges', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');

-- Montagem (só nesta transação) -----------------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
DELETE FROM public.user_roles WHERE user_id = pg_temp.id('loc');
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (pg_temp.id('loc'), 'locacao', pg_temp.id('orgA')), (pg_temp.id('c2'), 'locacao', pg_temp.id('orgA'));
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT pg_temp.id('orgA'), m, true FROM unnest(ARRAY['locacao', 'reserva_salas', 'mural_conquistas', 'captacao_exclusiva',
  'feedback_proprietario', 'oportunidades', 'leads', 'academia', 'vouchers_fotos', 'proposta_compra']) m
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
DELETE FROM public.organization_modules WHERE organization_id = pg_temp.id('orgA') AND module = 'ajuda_max_locacao';
-- fot = um corretor-só da A que vira SÓ 'fotografo' (para provar que o só-Fotógrafo não muda).
INSERT INTO ids SELECT 'fot', p.id FROM public.profiles p
 WHERE p.ativo AND p.organization_id = pg_temp.id('orgA') AND p.id NOT IN (SELECT v FROM ids WHERE v IS NOT NULL)
   AND (SELECT array_agg(role::text) FROM public.user_roles r WHERE r.user_id = p.id) = ARRAY['corretor']
 ORDER BY p.id LIMIT 1;
DELETE FROM public.user_roles WHERE user_id = pg_temp.id('fot');
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('fot'), 'fotografo', pg_temp.id('orgA'));
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('ges'), 'gestora')
ON CONFLICT DO NOTHING;
INSERT INTO public.room_reservations (organization_id, room, reserved_date, start_time, end_time, responsible_id,
  responsible_name, purpose)
SELECT pg_temp.id('orgA'), r.nome, current_date + 3, '09:00', '10:00', pg_temp.id('c2'), 'Corretor Dois', 'Parceria'
  FROM public.agency_rooms r WHERE r.organization_id = pg_temp.id('orgA') AND r.ativo ORDER BY r.nome LIMIT 1;
INSERT INTO public.achievement_posts (organization_id, sale_id, venda_em, captador_id, captador_nome)
SELECT s.organization_id, s.id, now(), pg_temp.id('c2'), 'Corretor Dois' FROM public.sales s
 WHERE s.organization_id = pg_temp.id('orgA') LIMIT 1;
SET LOCAL session_replication_role = origin;
INSERT INTO ids SELECT 'sala', NULL WHERE false;
INSERT INTO js VALUES ('sala', to_jsonb((SELECT nome FROM public.agency_rooms WHERE organization_id = pg_temp.id('orgA') AND ativo ORDER BY nome LIMIT 1)));

-- Antes: quanto o c2 (corretor) enxerga, para comparar depois de ganhar 'locacao'.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('c2_antes', jsonb_build_object(
  'sales', pg_temp.n('SELECT 1 FROM public.sales'), 'caps', pg_temp.n('SELECT 1 FROM public.exclusive_captures'),
  'clientes', pg_temp.n('SELECT 1 FROM public.clientes'), 'perfis', pg_temp.n('SELECT 1 FROM public.profiles')));
RESET ROLE;

-- 0) Catálogo ---------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('locacao' = ANY (enum_range(NULL::public.app_role)::text[]), 'app_role tem o valor locacao');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE policyname = 'zz_locacao_fora') >= 50,
  'barreira RESTRICTIVE zz_locacao_fora criada nas tabelas das outras áreas');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'zz_locacao_fora'
   AND tablename IN ('profiles', 'user_roles', 'organization_members', 'organizations', 'organization_modules',
                     'notifications', 'support_tickets', 'room_reservations', 'agency_rooms', 'achievement_posts',
                     'achievement_cheers', 'push_subscriptions')),
  'barreira não vale nas tabelas de entrada, salas, mural, chamados e avisos');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'zz_locacao_fora' AND tablename = 'sales')
  AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'zz_locacao_fora' AND tablename = 'exclusive_captures')
  AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'zz_locacao_fora' AND tablename = 'occurrences')
  AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'zz_locacao_fora' AND tablename = 'owner_feedback_actions')
  AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'zz_locacao_fora' AND tablename = 'carreira_diario'),
  'barreira cobre vendas, captações, ocorrências, feedback e carreira');
-- Guarda contra tabela nova (t_00c1173c): toda tabela de public com organization_id/org_id que o navegador lê
-- (SELECT para authenticated) precisa ter zz_locacao_fora, salvo as exceções da migration (entrada e área liberada).
-- Se esta checagem falhar, a tabela nova precisa da barreira (ou entrar na lista de exceções, com motivo).
CREATE FUNCTION pg_temp.sem_barreira() RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), ARRAY[]::text[]) FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND has_table_privilege('authenticated', c.oid, 'SELECT')
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND NOT a.attisdropped
                  AND a.attname IN ('organization_id', 'org_id'))
     AND c.relname NOT IN ('profiles', 'user_roles', 'organization_members', 'organizations',
                           'organization_modules', 'notifications', 'user_tour_estado', 'profile_birthdates',
                           'support_tickets', 'support_ticket_messages', 'push_subscriptions',
                           'room_reservations', 'room_reservation_reminder_deliveries',
                           'room_reservation_cancellation_penalties', 'agency_rooms',
                           'achievement_posts', 'achievement_cheers', 'achievement_mutes')
     AND NOT (c.relrowsecurity AND EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
                  AND p.tablename = c.relname AND p.policyname = 'zz_locacao_fora')) $$;
SELECT pg_temp.ok(pg_temp.sem_barreira() = ARRAY[]::text[],
  'nenhuma tabela com organization_id lida pelo navegador sem zz_locacao_fora: ' || pg_temp.sem_barreira()::text);
-- A guarda pega mesmo uma tabela nova (criada e apagada aqui, dentro da transação).
CREATE TABLE public.zz_teste_tabela_nova (id int, organization_id uuid);
ALTER TABLE public.zz_teste_tabela_nova ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.zz_teste_tabela_nova TO authenticated;
SELECT pg_temp.ok(pg_temp.sem_barreira() = ARRAY['zz_teste_tabela_nova'], 'a guarda acusa tabela nova sem a barreira');
DROP TABLE public.zz_teste_tabela_nova;
SELECT pg_temp.ok(public.eh_so_locacao(pg_temp.id('loc')) AND NOT public.eh_so_locacao(pg_temp.id('c2'))
  AND NOT public.eh_so_locacao(pg_temp.id('adm')) AND NOT public.eh_so_locacao(NULL),
  'eh_so_locacao: só o papel locacao sozinho (Locação + Corretor não conta)');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.so_locacao_ativo(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.eh_so_locacao(uuid)', 'EXECUTE'),
  'so_locacao_ativo não é chamável pelo navegador; eh_so_locacao não é chamável sem login');
SELECT pg_temp.ok(NOT public.cadastro_exige_registro(pg_temp.id('loc'), pg_temp.id('orgA')),
  'cadastro: só-Locação não exige CPF / ID RE/MAX / CRECI (igual ao Fotógrafo)');

-- 1) Só-Locação: bloqueios de verdade ---------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('loc')::text);
SELECT pg_temp.ok(public.current_org_id() = pg_temp.id('orgA'), 'só-Locação entra na imobiliária A (contexto ok)');
SELECT pg_temp.ok(NOT public.is_active_user(pg_temp.id('loc')), 'is_active_user = false para o só-Locação');
SELECT pg_temp.ok(NOT public.has_any_role(pg_temp.id('loc'), ARRAY['corretor', 'locacao']::public.app_role[]),
  'has_role/has_any_role não liberam nada ao só-Locação');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.sales') = 0, 'Vendas: 0 linhas (ele tinha 1 venda como corretor)');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.occurrences') = 0, 'Ocorrências: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.exclusive_captures') = 0, 'Captações exclusivas: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.clientes') = 0, 'clientes: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.metas') = 0, 'metas: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.teams') = 0, 'equipes: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.owner_feedback_actions') = 0, 'feedback ao proprietário: 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.sale_geo') = 0, 'mapa (sale_geo): 0 linhas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.profiles WHERE id = auth.uid()') = 1, 'lê o próprio perfil');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()') = 1, 'lê o próprio papel');
SELECT pg_temp.ok(NOT public.exclusive_capture_enabled() AND NOT public.owner_feedback_enabled()
  AND NOT public.opportunities_enabled() AND NOT public.leads_enabled() AND NOT public.crm_enabled()
  AND NOT public.academia_enabled() AND NOT public.proposta_compra_enabled() AND NOT public.vouchers_fotos_enabled(),
  'captações, feedback, oportunidades, leads, CRM, Academia, proposta e fotos aparecem desligados para ele');
SELECT pg_temp.ok(NOT ('academia' = ANY (public.sistemas_ligados())), 'Hub: Academia fora para o só-Locação');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.vendas_por_regiao_todos(current_date - 365, current_date)$q$) LIKE '42501%',
  'Vendas por região / Mapa: recusa (42501)');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.carreira_ranking(current_date - 30, current_date)$q$) LIKE '42501%',
  'Minha carreira (ranking): recusa (42501)');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.minhas_comissoes()$q$) IS NOT NULL
   OR pg_temp.n($q$SELECT 1 FROM public.minhas_comissoes()$q$) = 0, 'Meu dinheiro (comissões de venda): recusa ou vazio');
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.clientes (organization_id) VALUES ('00000000-0000-4000-8000-000000000001')$q$) IS NOT NULL,
  'não grava em clientes');
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.exclusive_captures (organization_id, captor_id, created_by, template, status, form_data)
  VALUES ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'campolim', 'rascunho', '{}')$q$) IS NOT NULL,
  'não cria captação exclusiva');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.dashboard_stats()$q$) IS NULL
  AND (public.dashboard_stats()->>'minhas_vendas')::int = 0, 'Início abre sem erro e sem números de venda');
-- Brechas da revisão t_70955df9 (t_00c1173c): RPCs que só olhavam auth.uid() e a Academia.
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.meu_realizado(current_date - 30, current_date)$q$) LIKE '42501%',
  'meu_realizado (comissão/VGV/captações próprios): recusa (42501)');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_meu_resumo()$q$) LIKE '42501%Agendar fotos desligado%',
  'photo_meu_resumo: recusa (Agendar fotos desligado para ele)');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_agendar(gen_random_uuid(), now() + interval '2 days', NULL)$q$)
  LIKE '42501%Agendar fotos desligado%', 'photo_agendar: recusa antes de qualquer outra checagem');
SELECT pg_temp.ok(NOT public.academia_has_active_adm_access(), 'Academia: porteiro recusa o só-Locação');
SELECT pg_temp.ok(academia.user_org(auth.uid()) IS NULL AND academia.current_org() IS NULL,
  'Academia: user_org / current_org = NULL para o só-Locação');

-- 2) Só-Locação: o que ele pode ---------------------------------------------------------------------------------------
SELECT pg_temp.ok(public.locacao_enabled(), 'Locação ligada para ele');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_contexto()') IS NULL, 'locacao_contexto funciona');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_lista()') IS NULL, 'locacao_lista funciona');
SELECT pg_temp.setid('L', (public.locacao_criar()->>'id')::uuid);
SELECT pg_temp.ok(pg_temp.id('L') IS NOT NULL, 'só-Locação abre locação nova');
SELECT public.locacao_salvar_pre(pg_temp.id('L'), pg_temp.ficha(pg_temp.id('loc')));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('L'))) IS NULL,
  'só-Locação preenche a ficha (ele mesmo como captador) e envia à gestora');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'aprovacao', 'locação dele na aprovação da gestora');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.locacao_corretores()) x
   WHERE (x->>'id')::uuid = pg_temp.id('loc')), 'aparece na lista de captadores da Locação');
-- Salas
SELECT pg_temp.ok(public.room_reservation_enabled(), 'Reserva de salas ligada para ele');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.list_room_occupancy()') >= 1, 'vê a grade de ocupação das salas');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.agency_rooms') >= 1, 'vê as salas da imobiliária');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.list_room_reservation_users()') >= 1, 'lista de pessoas das salas: ok');
SELECT pg_temp.ok(pg_temp.err(format($q$INSERT INTO public.room_reservations (organization_id, room, reserved_date, start_time,
  end_time, responsible_id, responsible_name, purpose) VALUES (%L, %L, current_date + 4, '14:00', '15:00', %L, 'UE Corretor', 'Reunião com cliente')$q$,
  pg_temp.id('orgA'), pg_temp.j('sala') #>> '{}', pg_temp.id('loc'))) IS NULL, 'reserva sala no próprio nome');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.room_reservations WHERE responsible_id = auth.uid()') >= 1,
  'vê a própria reserva');
SELECT pg_temp.ok(pg_temp.err('SELECT public.get_room_reservation_cancellation_status()') IS NULL,
  'situação de cancelamentos abre');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.cancel_room_reservation(%L)',
  (SELECT id FROM public.room_reservations WHERE responsible_id = auth.uid() LIMIT 1))) IS NULL, 'cancela a própria reserva');
-- Mural
SELECT pg_temp.ok(public.achievements_enabled(), 'Mural de Conquistas ligado para ele');
SELECT pg_temp.ok(pg_temp.err('SELECT public.achievement_feed(20)') IS NULL AND pg_temp.n('SELECT 1 FROM public.achievement_posts') >= 1,
  'vê o mural');
-- Ajuda MAX da Locação + Sugestões e erros + Meus chamados
SELECT pg_temp.ok(public.ajuda_max_locacao_enabled(), 'Ajuda MAX da Locação ligada para ele');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ajuda_max_locacao_reservar()$q$) IS NULL, 'Ajuda MAX: reserva de uso funciona');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ajuda_max_locacao_registrar('sugestao', 'Sugestão fictícia de teste do papel Locação', '/locacoes', 'Locação', 'teste', NULL)$q$) IS NULL,
  'Sugestões e erros: registra sugestão');
SELECT pg_temp.ok(jsonb_array_length(public.ajuda_max_locacao_sugestoes()->'itens') >= 1, 'Sugestões e erros: lista as próprias');
SELECT pg_temp.ok(pg_temp.n($q$SELECT 1 FROM public.support_ticket_list('meus')$q$) >= 1, 'Meus chamados: lista');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.support_ticket_create('duvida', 'Dúvida fictícia pelo botão do topo', '/locacoes', 'Locação', 'teste', NULL)$q$) IS NULL,
  '"Ajuda e sugestões" do topo: abre chamado');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.push_inscrever('https://push.exemplo.invalid/x1', repeat('a', 30), repeat('b', 10), 'teste')$q$) IS NULL,
  'avisos no celular: inscreve o aparelho');
RESET ROLE;

-- 3) Papéis internos da Locação para quem NÃO é dono (gestora / contratos / vistoria / financeiro) ---------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.locacao_papeis_lista()) x
   WHERE (x->>'user_id')::uuid = pg_temp.id('loc')), 'admin vê o só-Locação na lista de papéis da Locação');
SELECT public.locacao_papel_definir(pg_temp.id('loc'), p, true) FROM unnest(ARRAY['gestora', 'contratos', 'vistoria', 'financeiro']) p;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.setid('L2', (public.locacao_criar()->>'id')::uuid);
SELECT public.locacao_salvar_pre(pg_temp.id('L2'), pg_temp.ficha(pg_temp.id('c2')));
SELECT public.locacao_enviar_pre(pg_temp.id('L2'));
SELECT pg_temp.as_user(pg_temp.id('loc')::text);
SELECT pg_temp.put('ctx', public.locacao_contexto());
SELECT pg_temp.ok((SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(pg_temp.j('ctx')->'papeis') x)
   = ARRAY['contratos', 'financeiro', 'gestora', 'vistoria'], 'locacao_contexto: gestora, contratos, vistoria e financeiro');
SELECT pg_temp.ok((pg_temp.j('ctx')->>'ve_comissao')::boolean, 'como gestora, vê a comissão');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_detalhe(%L)', pg_temp.id('L2'))) IS NULL,
  'vê a locação de outro corretor (não é o corretor_id dono)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.locacao_lista()->'itens') x
   WHERE (x->>'id')::uuid = pg_temp.id('L2')) OR public.locacao_lista()::text LIKE '%' || pg_temp.id('L2') || '%',
  'a locação do outro corretor aparece na lista dele');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_gestora_decidir(%L, true, NULL)', pg_temp.id('L2'))) IS NULL,
  'como gestora, aprova a pré-análise de outro corretor');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_painel(current_date)') IS NULL, 'como financeiro, abre o painel financeiro');
RESET ROLE;

-- 4) Locação + Corretor continua vendo tudo ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.is_active_user(pg_temp.id('c2')), 'Locação + Corretor segue usuário ativo');
SELECT pg_temp.ok(jsonb_build_object(
  'sales', pg_temp.n('SELECT 1 FROM public.sales'), 'caps', pg_temp.n('SELECT 1 FROM public.exclusive_captures'),
  'clientes', pg_temp.n('SELECT 1 FROM public.clientes'), 'perfis', pg_temp.n('SELECT 1 FROM public.profiles')) = pg_temp.j('c2_antes'),
  'Locação + Corretor enxerga exatamente o mesmo que antes (vendas, captações, clientes, perfis)');
SELECT pg_temp.ok(public.exclusive_capture_enabled() AND public.owner_feedback_enabled() AND public.leads_enabled()
  AND public.vouchers_fotos_enabled() AND public.academia_enabled(), 'Locação + Corretor: módulos seguem ligados');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.vendas_por_regiao_todos(current_date - 365, current_date)$q$) IS NULL,
  'Locação + Corretor: Vendas por região abre');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.carreira_ranking(current_date - 30, current_date)$q$) IS NULL,
  'Locação + Corretor: ranking da carreira abre');
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.meu_realizado(current_date - 30, current_date)$q$) IS NULL,
  'Locação + Corretor: meu_realizado abre');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_meu_resumo()$q$) IS NULL, 'Locação + Corretor: photo_meu_resumo abre');
SELECT pg_temp.ok(coalesce(pg_temp.err($q$SELECT public.photo_agendar(gen_random_uuid(), now() + interval '2 days', NULL)$q$), '')
  NOT LIKE '%Agendar fotos desligado%', 'Locação + Corretor: photo_agendar passa pela chave do módulo');
SELECT pg_temp.ok(public.academia_has_active_adm_access() AND academia.current_org() = pg_temp.id('orgA'),
  'Locação + Corretor: Academia (porteiro e org) igual a antes');
-- Admin (sem 'locacao'): nada muda.
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.meu_realizado(current_date - 30, current_date)$q$) IS NULL
  AND pg_temp.err($q$SELECT public.photo_meu_resumo()$q$) IS NULL
  AND public.academia_has_active_adm_access() AND academia.current_org() = pg_temp.id('orgA'),
  'Admin: meu_realizado, photo_meu_resumo e Academia iguais a antes');
-- Só-Fotógrafo: comportamento de antes mantido (Fotos abertas; porteiro da Academia ainda deixa passar).
SELECT pg_temp.as_user(pg_temp.id('fot')::text);
SELECT pg_temp.ok(pg_temp.id('fot') IS NOT NULL AND NOT public.eh_so_locacao(pg_temp.id('fot')), 'só-Fotógrafo não é só-Locação');
SELECT pg_temp.ok(public.vouchers_fotos_enabled() AND pg_temp.err($q$SELECT public.photo_meu_resumo()$q$) IS NULL,
  'só-Fotógrafo: Agendar fotos segue aberto (photo_meu_resumo)');
SELECT pg_temp.ok(public.academia_has_active_adm_access() AND academia.current_org() = pg_temp.id('orgA'),
  'só-Fotógrafo: Academia igual a antes (porteiro true, org da A)');
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.meu_realizado(current_date - 30, current_date)$q$) IS NULL,
  'só-Fotógrafo: meu_realizado igual a antes (não recusa)');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
-- O só-Locação fica fora das listas de corretor (rankings/metas), como o Fotógrafo.
SELECT pg_temp.ok(pg_temp.n(format($q$SELECT 1 FROM public.list_active_corretores() WHERE id = %L$q$, pg_temp.id('loc'))) = 0,
  'só-Locação fora da lista de corretores ativos');
SELECT pg_temp.ok(NOT public.is_active_user(pg_temp.id('loc')), 'para o corretor, o só-Locação não é usuário ativo da agência');
RESET ROLE;

-- 5) Outra imobiliária e desativado -------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_detalhe(%L)', pg_temp.id('L'))) IS NOT NULL,
  'pessoa da imobiliária B não vê a locação da A');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('loc');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('loc')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_contexto()') LIKE '42501%', 'só-Locação desativado perde a Locação');
SELECT pg_temp.ok(pg_temp.n('SELECT 1 FROM public.list_room_occupancy()') = 0, 'só-Locação desativado perde a grade das salas');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
