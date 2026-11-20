-- Suíte da migration 20261214120000 (agendamento da vistoria + avisos ao corretor, t_c3ea1b18). Roda DENTRO de
-- transação revertida (run-locacao-vistoria-agenda.sh), na homologação, só com dados fictícios. Nada é enviado: aqui
-- só se confere a fila locacao_avisos (o envio é do servidor e depende da trava LOCACAO_AVISOS_WHATSAPP).
-- Pessoas da homologação (Agência A): c2 = QA A Corretor Dois (corretor), con = QA A Dono Plataforma (vistoria),
-- a1 = UE Corretor (outro corretor), b1 = corretor da Agência B.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
GRANT ALL ON r, ids, js TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _uid = '' THEN '' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.loc(_k text) RETURNS public.locacoes LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT l FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
-- "evento:status" de cada aviso da locação, em ordem.
CREATE FUNCTION pg_temp.avisos(_k text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT coalesce(string_agg(evento || ':' || status, ',' ORDER BY criado_em, evento, status), '') FROM public.locacao_avisos
   WHERE locacao_id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.texto(_k text, _ev text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT texto FROM public.locacao_avisos WHERE locacao_id = (SELECT v FROM ids WHERE k = _k) AND evento = _ev
   ORDER BY criado_em DESC LIMIT 1 $$;
-- Data/hora local (Brasília) daqui a _h horas, no formato do campo da tela.
CREATE FUNCTION pg_temp.sp(_h numeric) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char((now() + make_interval(secs => _h * 3600)) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') $$;
CREATE FUNCTION pg_temp.gerar() RETURNS uuid[] LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT coalesce(array_agg(x), '{}') FROM public.locacao_vistoria_lembretes_gerar(50) x $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('con', 'b316b223-da46-4c2c-9952-25096d5ae5ff'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true),
  (pg_temp.id('orgB'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('con'), 'vistoria')
ON CONFLICT DO NOTHING;
-- Sem lembrete de vistoria vencido de outras locações da homologação atrapalhando a contagem.
UPDATE public.locacoes SET pos = pos - 'vistoria_agenda' WHERE pos ? 'vistoria_agenda';

INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, imovel_tipo, ficha)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'pos_assinatura', 'Rua da Vistoria, 10 (fictícia)', 2000, 'fiador', 'residencial',
        'casa', '{"complemento":"Casa 2"}') RETURNING pg_temp.setid('V', id);
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, imovel_tipo)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'minuta', 'Rua Antes da Assinatura, 1 (fictícia)', 2000, 'fiador',
        'residencial', 'casa') RETURNING pg_temp.setid('M', id);

-- 0) Estrutura e permissões ----------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT p.prosecdef AND coalesce('search_path=""' = ANY (p.proconfig), false)
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
   FROM pg_proc p WHERE p.oid = 'public.locacao_vistoria_agendar(uuid, text, text, boolean)'::regprocedure),
  'agendar: SECURITY DEFINER, search_path vazio, só usuário logado');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_vistoria_lembretes_gerar(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.locacao_vistoria_lembretes_gerar(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.locacao_vistoria_lembretes_gerar(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_trg_avisos_vistoria()', 'EXECUTE'),
  'lembretes: só o servidor (service_role) gera; gatilho fechado ao navegador');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.locacao_avisos', 'SELECT'), 'fila continua fechada ao navegador');

-- 1) Quem agenda e validações --------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, true)', pg_temp.id('V'), pg_temp.sp(30), 'Fulano Vistoriador')) LIKE '42501%',
  'corretor não agenda (só a vistoria)');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, true)', pg_temp.id('V'), pg_temp.sp(30), 'Fulano Vistoriador')) LIKE '42501%',
  'outra imobiliária não agenda');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, true)', pg_temp.id('M'), pg_temp.sp(30), 'Fulano Vistoriador')) LIKE '22023%etapa%',
  'antes da assinatura não agenda');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, true)', pg_temp.id('V'), pg_temp.sp(-1), 'Fulano Vistoriador')) LIKE '22023%futuro%',
  'data no passado recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, true)', pg_temp.id('V'), pg_temp.sp(24 * 200), 'Fulano Vistoriador')) LIKE '22023%180%',
  'mais de 180 dias recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, true)', pg_temp.id('V'), '2026-13-45T25:99', 'Fulano Vistoriador')) LIKE '22023%',
  'data impossível recusada sem erro interno');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, true)', pg_temp.id('V'), 'amanhã cedo', 'Fulano Vistoriador')) LIKE '22023%data e a hora%',
  'texto livre no lugar da data recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, true)', pg_temp.id('V'), pg_temp.sp(30), ' ')) LIKE '22023%vistoriador%',
  'nome do vistoriador obrigatório');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, NULL)', pg_temp.id('V'), pg_temp.sp(30), 'Fulano Vistoriador')) LIKE '22023%acompanha%',
  'acompanhar sim/não obrigatório');

-- 2) Agendar daqui a 30 h: grava, marca "vistoria pedida", não gera aviso ainda -------------------------------------
SELECT pg_temp.put('ag1', public.locacao_vistoria_agendar(pg_temp.id('V'), pg_temp.sp(30), 'Fulano Vistoriador', true));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.loc('V')).pos->'vistoria_agenda'->>'vistoriador' = 'Fulano Vistoriador'
  AND ((pg_temp.loc('V')).pos->'vistoria_agenda'->>'acompanha')::boolean
  AND date_trunc('minute', ((pg_temp.loc('V')).pos->'vistoria_agenda'->>'em')::timestamptz)
      = date_trunc('minute', now() + interval '30 hours')
  AND (pg_temp.loc('V')).pos->>'vistoria_pedida' IS NOT NULL, 'agenda gravada (horário de Brasília) e vistoria marcada como pedida');
SELECT pg_temp.ok((SELECT descricao FROM public.locacao_eventos WHERE locacao_id = pg_temp.id('V') ORDER BY em DESC, id DESC LIMIT 1)
  LIKE 'Vistoria agendada para %Fulano Vistoriador%corretor acompanha', 'histórico registra o agendamento');
SELECT pg_temp.ok(pg_temp.avisos('V') = '', 'agendar não gera aviso na hora (só véspera, 2 h antes e laudo)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('V'))->'pos'->'vistoria_agenda'->>'vistoriador' = 'Fulano Vistoriador',
  'corretor vê a agenda na tela da locação');
RESET ROLE;

-- 3) Véspera: a vistoria passa a estar a menos de 24 h ---------------------------------------------------------------
SELECT pg_temp.as_user('');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (pg_temp.id('V') = ANY (pg_temp.gerar()))
  OR extract(dow FROM now() AT TIME ZONE 'America/Sao_Paulo') IN (5, 6),
  'a 30 h (fora da véspera) ainda não lembra');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_vistoria_agendar(pg_temp.id('V'), pg_temp.sp(20), 'Fulano Vistoriador', true);
RESET ROLE;
DELETE FROM public.locacao_avisos WHERE locacao_id = pg_temp.id('V'); -- sexta/sábado: o teste acima pode ter gerado a véspera
SELECT pg_temp.as_user('');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(pg_temp.id('V') = ANY (pg_temp.gerar()), 'a 20 h: lembrete da véspera gerado e locação devolvida ao servidor');
SELECT pg_temp.gerar(); -- rodada seguinte do pg_cron (5 min depois)
RESET ROLE;
SELECT pg_temp.ok(pg_temp.avisos('V') = 'vistoria_vespera:pendente', 'rodar de novo não duplica (chave com a data agendada)');
SELECT pg_temp.ok(pg_temp.texto('V', 'vistoria_vespera') LIKE 'Lembrete: vistoria __/__ (___) às __:__. Você vai ACOMPANHAR a vistoria (vistoriador: Fulano Vistoriador).',
  'texto: data, dia da semana, hora e que ele acompanha');
SELECT pg_temp.ok((SELECT destinatario_id FROM public.locacao_avisos WHERE locacao_id = pg_temp.id('V')) = pg_temp.id('c2'),
  'destinatário = corretor responsável');
SELECT pg_temp.ok(pg_temp.texto('V', 'vistoria_vespera') !~ '\d{3}\.\d{3}\.\d{3}|@|\(\d{2}\)' , 'sem CPF, e-mail ou telefone no texto');

-- 4) Reagendar: o lembrete pendente da data antiga expira e não volta --------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_vistoria_agendar(pg_temp.id('V'), pg_temp.sp(24 * 5), 'Ciclano Vistoriador', false);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.avisos('V') = 'vistoria_vespera:expirado', 'reagendar expira o lembrete da data antiga (fica no histórico)');
SELECT pg_temp.as_user('');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (pg_temp.id('V') = ANY (pg_temp.gerar())), 'nova data a 5 dias: nenhum lembrete agora');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.avisos('V') = 'vistoria_vespera:expirado', 'lembrete da data antiga não volta');
SELECT pg_temp.ok((SELECT descricao FROM public.locacao_eventos WHERE locacao_id = pg_temp.id('V') ORDER BY em DESC, id DESC LIMIT 1)
  LIKE 'Vistoria reagendada para %Ciclano Vistoriador%corretor não acompanha', 'histórico registra o reagendamento');

-- 5) Reagendar para daqui a 1h30: sai só o de 2 h (a véspera já passou) ------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_vistoria_agendar(pg_temp.id('V'), pg_temp.sp(1.5), 'Ciclano Vistoriador', false);
RESET ROLE;
SELECT pg_temp.as_user('');
SET LOCAL ROLE service_role;
SELECT pg_temp.gerar(), pg_temp.gerar();
SELECT pg_temp.put('res', (SELECT jsonb_agg(to_jsonb(x)) FROM public.locacao_avisos_reservar(pg_temp.id('V'), 5) x));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.avisos('V') = 'vistoria_vespera:expirado,vistoria_2h:enviando', 'em cima da hora: um único lembrete de 2 h');
SELECT pg_temp.ok(pg_temp.texto('V', 'vistoria_2h') LIKE 'Vistoria daqui a pouco: __/__ (___) às __:__. Você NÃO precisa acompanhar.',
  'texto do 2 h: hora e que ele não precisa acompanhar');
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('res')) = 1 AND pg_temp.j('res')->0->>'evento' = 'vistoria_2h'
  AND pg_temp.j('res')->0->>'endereco' = 'Rua da Vistoria, 10 (fictícia) — Casa 2' AND pg_temp.j('res')->0->>'codigo' LIKE 'LOC-%',
  'servidor reserva pela fila de sempre, com código e endereço');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.locacao_vistoria_aviso_atual((pg_temp.j('res')->0->>'aviso_id')::uuid),
  'lembrete reservado ainda corresponde à data agendada');
RESET ROLE;

-- 6) Laudo registrado: "vistoria concluída" com o prazo de contestação; lembrete pendente expira --------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_vistoria_agendar(pg_temp.id('V'), pg_temp.sp(1.2), 'Ciclano Vistoriador', true);
RESET ROLE;
SELECT pg_temp.as_user('');
SET LOCAL ROLE service_role;
SELECT pg_temp.gerar();
RESET ROLE;
SELECT pg_temp.ok(pg_temp.avisos('V') LIKE '%vistoria_2h:pendente', 'reagendar de novo gera o 2 h da nova hora');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_pos_acao(pg_temp.id('V'), 'laudo_assinado');
SELECT public.locacao_pos_acao(pg_temp.id('V'), 'contestacao'); -- outra gravação do pos: não repete o aviso
RESET ROLE;
SELECT pg_temp.ok(pg_temp.avisos('V') = 'vistoria_vespera:expirado,vistoria_2h:enviando,vistoria_2h:expirado,vistoria_concluida:pendente',
  'laudo: 1 aviso de concluída e o lembrete que não saiu expira');
SELECT pg_temp.ok(pg_temp.texto('V', 'vistoria_concluida') LIKE 'Vistoria concluída: laudo registrado em __/__/____. O locatário tem 10 dias corridos, contados da entrega das chaves, para contestar o laudo.',
  'texto do laudo: 10 dias corridos da entrega das chaves (cláusula 15ª)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_vistoria_agendar(%L, %L, %L, true)', pg_temp.id('V'), pg_temp.sp(30), 'X Y')) LIKE '22023%Laudo%',
  'depois do laudo não reagenda');
RESET ROLE;
SELECT pg_temp.as_user('');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (pg_temp.id('V') = ANY (pg_temp.gerar())), 'depois do laudo nenhum lembrete');
RESET ROLE;

-- 7) Chaves já entregues: o aviso do laudo traz a data-limite ---------------------------------------------------------
SELECT pg_temp.as_user('');
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, imovel_tipo, chave_em, pos)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'chaves', 'Rua das Chaves, 3 (fictícia)', 2000, 'fiador', 'residencial', 'casa',
        DATE '2026-11-18', '{"vistoria_pedida":"2026-11-10"}') RETURNING pg_temp.setid('K', id);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_pos_acao(pg_temp.id('K'), 'laudo_assinado');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.texto('K', 'vistoria_concluida') LIKE '%para contestar o laudo (até 28/11/2026).', 'com chave entregue em 18/11: prazo até 28/11');

-- 8) Locação encerrada não lembra; corretor que agenda a própria não recebe o próprio aviso -------------------------
SELECT pg_temp.as_user('');
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, imovel_tipo, situacao, pos)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'pos_assinatura', 'Rua Encerrada, 9 (fictícia)', 2000, 'fiador', 'residencial', 'casa',
        'encerrada', jsonb_build_object('vistoria_agenda', jsonb_build_object('em', now() + interval '3 hours', 'vistoriador', 'Z', 'acompanha', true)))
RETURNING pg_temp.setid('E', id);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (pg_temp.id('E') = ANY (pg_temp.gerar())) AND pg_temp.avisos('E') = '', 'locação encerrada não recebe lembrete');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
