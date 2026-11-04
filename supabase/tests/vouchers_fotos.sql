-- Suíte do módulo "Agendar fotos + Vouchers de Fotos" (migration 20261105120000, t_d86ab990).
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

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set org_b 'b0000000-0000-4000-8000-0000000000b0'
\set admin 'a0000000-0000-4000-8000-000000000001'
\set fin 'a0000000-0000-4000-8000-000000000002'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set c2 'a0000000-0000-4000-8000-000000000005'
\set foto 'a0000000-0000-4000-8000-000000000006'
\set staff2 'a0000000-0000-4000-8000-000000000007'
\set ab 'b0000000-0000-4000-8000-000000000001'
\set cb 'b0000000-0000-4000-8000-000000000002'
\set plat 'f0000000-0000-4000-8000-000000000001'

-- Montagem ---------------------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-fotos-a', 'Imobiliaria Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-fotos-b', 'Imobiliaria Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'fin', :'c1', :'c2', :'foto', :'staff2', :'ab', :'cb', :'plat']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id, telefone) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a', '15990000001'),
  (:'fin', 'Fabi Financeiro', 'fin@exemplo.test', true, :'org_a', '15990000002'),
  (:'c1', 'Carlos Um', 'c1@exemplo.test', true, :'org_a', '15990000004'),
  (:'c2', 'Bruna Dois', 'c2@exemplo.test', true, :'org_a', '15990000005'),
  (:'foto', 'Paulo Foto', 'foto@exemplo.test', true, :'org_a', '15990000006'),
  (:'staff2', 'Sara Staff', 'staff2@exemplo.test', true, :'org_a', '15990000007'),
  (:'ab', 'Admin B', 'ab@exemplo.test', true, :'org_b', '15990000008'),
  (:'cb', 'Corretor B', 'cb@exemplo.test', true, :'org_b', '15990000009'),
  (:'plat', 'Dono Plataforma', 'plat@exemplo.test', true, :'org_a', NULL);
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'fin', true), (:'org_a', :'c1', true), (:'org_a', :'c2', true),
  (:'org_a', :'foto', true), (:'org_a', :'staff2', true), (:'org_b', :'ab', true), (:'org_b', :'cb', true),
  (:'org_a', :'plat', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'fin', 'financeiro', :'org_a'), (:'c1', 'corretor', :'org_a'),
  (:'c2', 'corretor', :'org_a'), (:'foto', 'staff', :'org_a'), (:'staff2', 'staff', :'org_a'),
  (:'ab', 'admin', :'org_b'), (:'cb', 'corretor', :'org_b'), (:'plat', 'super_admin', :'org_a');
INSERT INTO public.platform_admins (user_id) VALUES (:'plat');
SET LOCAL session_replication_role = origin;

-- Captação fictícia (gatilhos ligados: é o gatilho do módulo que gera os vouchers).
-- Insere "como" o próprio corretor (o trg_00_org confere a imobiliária de quem está logado).
CREATE FUNCTION pg_temp.cap(_org uuid, _captor uuid, _status text, _signed date, _end text) RETURNS uuid
LANGUAGE sql AS $$
  SELECT pg_temp.as_user(_captor::text);
  INSERT INTO public.exclusive_captures (organization_id, captor_id, created_by, template, status, signed_on, form_data)
  VALUES (_org, _captor, _captor, 'campolim', _status, _signed,
    jsonb_build_object('imovel', jsonb_build_object('tipo_imovel', 'Casa', 'endereco', _end, 'bairro', 'Campolim',
                                                     'municipio', 'Sorocaba')))
  RETURNING id $$;
CREATE FUNCTION pg_temp.qtd(_org uuid, _u uuid) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.photo_vouchers WHERE organization_id = _org AND corretor_id = _u $$;
CREATE FUNCTION pg_temp.hoje() RETURNS date LANGUAGE sql AS $$ SELECT public.photo_hoje() $$;
-- Horário "redondo" futuro: amanhã às _h:00 em São Paulo.
CREATE FUNCTION pg_temp.amanha(_h numeric) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT ((pg_temp.hoje() + 1)::timestamp + make_interval(mins => (_h * 60)::int)) AT TIME ZONE 'America/Sao_Paulo' $$;
-- Leitura interna da contagem (a função real não é exposta a authenticated).
CREATE FUNCTION pg_temp.desm(_o uuid, _u uuid) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.photo_desmarcacoes_30d(_o, _u) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- 0) Vencimento -----------------------------------------------------------------------------------
SELECT pg_temp.ok(public.photo_voucher_vencimento('2026-11-15') = '2027-02-28', 'validade: gerado em novembro vence 28/02');
SELECT pg_temp.ok(public.photo_voucher_vencimento('2026-10-03') = '2027-01-29', 'validade: outubro vence 29/01 (90 dias corridos desde 01/11)');
SELECT pg_temp.ok(public.photo_voucher_vencimento('2026-12-31') = '2027-03-31', 'validade: dezembro vence 31/03');

-- 1) Módulo desligado: nada é gerado --------------------------------------------------------------
SELECT pg_temp.cap(:'org_a', :'c1', 'aprovada', pg_temp.hoje(), 'Rua Um, 1');
SELECT pg_temp.cap(:'org_a', :'c1', 'aprovada', pg_temp.hoje(), 'Rua Um, 2');
SELECT pg_temp.cap(:'org_a', :'c1', 'aprovada', pg_temp.hoje(), 'Rua Um, 3');
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c1') = 0, 'modulo desligado: 3 captacoes assinadas nao geram voucher');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(NOT public.vouchers_fotos_enabled(), 'modulo desligado: vouchers_fotos_enabled = false');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_meu_resumo()') LIKE '42501%', 'modulo desligado: resumo recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.platform_set_organization_module('a0000000-0000-4000-8000-0000000000a0','vouchers_fotos',true)$q$) LIKE '42501%',
  'corretor nao liga o modulo');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.platform_set_organization_module('a0000000-0000-4000-8000-0000000000a0','vouchers_fotos',true)$q$) LIKE '42501%',
  'admin da imobiliaria nao liga o modulo (so o super admin)');
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(public.platform_set_organization_module(:'org_a', 'vouchers_fotos', true), 'super admin liga o modulo na A');
RESET ROLE;

-- 2) Geração ----------------------------------------------------------------------------------------
-- Ao ligar, quem já tinha batido a meta recebe na primeira conferência (abrir a tela).
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok((public.photo_meu_resumo()->'mes'->>'assinadas')::int = 3, 'resumo: 3 de 3 no mes');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c1') = 3, 'meta batida antes de ligar: 3 vouchers ao abrir');
SELECT pg_temp.ok(public.photo_vouchers_conferir(:'org_a', :'c1', pg_temp.hoje()) = 0
                  AND pg_temp.qtd(:'org_a', :'c1') = 3, 'idempotente: conferir de novo nao duplica');
SELECT pg_temp.ok((SELECT bool_and(vence_em = public.photo_voucher_vencimento(pg_temp.hoje()) AND status = 'disponivel'
                                   AND gerado_em <= now())
                     FROM public.photo_vouchers WHERE corretor_id = :'c1'), 'vouchers: disponiveis desde a geracao, vencimento certo');
-- C2: 2 assinadas = nada; a 3ª (aprovação via UPDATE) gera 3 pelo gatilho; a 4ª gera +1.
SELECT pg_temp.cap(:'org_a', :'c2', 'aprovada', pg_temp.hoje(), 'Rua Dois, 1');
SELECT pg_temp.cap(:'org_a', :'c2', 'aprovada', pg_temp.hoje(), 'Rua Dois, 2');
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c2') = 0, '2 de 3: nenhum voucher');
CREATE TEMP TABLE c2cap AS SELECT pg_temp.cap(:'org_a', :'c2', 'em_assinatura', NULL, 'Rua Dois, 3') AS id;
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c2') = 0, 'captacao em assinatura nao conta');
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = pg_temp.hoje() WHERE id = (SELECT id FROM c2cap);
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c2') = 3, 'gatilho: 3a captacao assinada gera 3 vouchers');
SELECT pg_temp.cap(:'org_a', :'c2', 'aprovada', pg_temp.hoje(), 'Rua Dois, 4');
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c2') = 4, 'gatilho: 4a captacao gera +1 (4 vouchers)');
-- Arquivada conta; descartada não.
UPDATE public.exclusive_captures SET archived_at = now() WHERE id = (SELECT id FROM c2cap);
SELECT pg_temp.cap(:'org_a', :'c2', 'aprovada', pg_temp.hoje(), 'Rua Dois, 5');
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c2') = 5, 'arquivada continua contando (5 vouchers)');
-- Cancelada/desaprovada ou transferida depois: nada acontece (voucher continua).
UPDATE public.exclusive_captures SET status = 'devolvida' WHERE id = (SELECT id FROM c2cap);
UPDATE public.exclusive_captures SET discarded_at = now() WHERE organization_id = :'org_a' AND form_data->'imovel'->>'endereco' = 'Rua Dois, 4';
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c2') = 5, 'captacao cancelada/descartada depois: vouchers continuam');
UPDATE public.exclusive_captures SET captador_original_id = :'c2', captor_id = :'c1'
 WHERE organization_id = :'org_a' AND form_data->'imovel'->>'endereco' = 'Rua Dois, 5';
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c2') = 5 AND pg_temp.qtd(:'org_a', :'c1') = 3,
  'captacao transferida: voucher fica com quem ganhou; quem recebeu nao ganha');
SELECT pg_temp.ok(public.photo_captacoes_assinadas(:'org_a', :'c2', pg_temp.hoje()) = 3,
  'meta conta para quem captou (captador original), sem devolvida/descartada');
-- Mês anterior com 3 assinadas gera vouchers do mês anterior (soma com os do mês atual).
SELECT pg_temp.cap(:'org_a', :'c1', 'aprovada', (date_trunc('month', pg_temp.hoje()) - interval '1 day')::date, 'Rua Velha, ' || g)
  FROM generate_series(1, 3) g;
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c1') = 6
  AND (SELECT count(DISTINCT mes_ref) FROM public.photo_vouchers WHERE corretor_id = :'c1') = 2, 'vouchers de meses diferentes somam (6)');
-- Outra imobiliária com módulo desligado: nada.
SELECT pg_temp.cap(:'org_b', :'cb', 'aprovada', pg_temp.hoje(), 'Rua B, ' || g) FROM generate_series(1, 3) g;
SELECT pg_temp.ok(pg_temp.qtd(:'org_b', :'cb') = 0, 'imobiliaria B (modulo desligado): nada gerado');

-- 3) Configuração ----------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_configurar(NULL, 100)') LIKE '42501%', 'corretor nao configura');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_agendar((SELECT id FROM public.exclusive_captures WHERE form_data->'imovel'->>'endereco'='Rua Um, 1'), now() + interval '1 day')$q$) LIKE '22023%fotografo%',
  'sem fotografo escolhido: agendar recusa');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_configurar('a0000000-0000-4000-8000-000000000004', 150)$q$) LIKE '22023%staff%',
  'fotografo precisa ser staff');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_configurar('b0000000-0000-4000-8000-000000000001', 150)$q$) LIKE '22023%',
  'fotografo de outra imobiliaria recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_configurar(NULL, -1)') LIKE '22023%', 'valor negativo recusado');
SELECT pg_temp.ok((public.photo_configurar(:'foto', 150)->>'valor_sessao')::numeric = 150, 'admin escolhe o fotografo (staff) e o valor 150');
SELECT pg_temp.ok(jsonb_array_length(public.photo_staff_listar()) = 2, 'lista de staff da imobiliaria (2)');

-- 4) Agenda do fotógrafo ---------------------------------------------------------------------------
SELECT pg_temp.as_user(:'staff2');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_faixa_salvar('livre', pg_temp.amanha(8), pg_temp.amanha(18))$q$) LIKE '42501%',
  'outro staff (nao fotografo) nao mexe na agenda');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_faixa_salvar('livre', pg_temp.amanha(8), pg_temp.amanha(18))$q$) LIKE '42501%',
  'corretor nao mexe na agenda');
SELECT pg_temp.as_user(:'foto');
SELECT public.photo_faixa_salvar('livre', pg_temp.amanha(8), pg_temp.amanha(18));
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_faixa_salvar('livre', now() - interval '3 hours', now() - interval '1 hour')$q$) LIKE '22023%',
  'faixa no passado recusada');
SELECT public.photo_faixa_salvar('bloqueio', pg_temp.amanha(12), pg_temp.amanha(13));
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.photo_horarios_livres(pg_temp.hoje() + 1, pg_temp.hoje() + 1) t
                               WHERE tstzrange(t, t + interval '2 hours') && tstzrange(pg_temp.amanha(12), pg_temp.amanha(13))),
  'horarios livres respeitam o bloqueio do fotografo');
SELECT pg_temp.ok((SELECT count(*) FROM public.photo_horarios_livres(pg_temp.hoje() + 1, pg_temp.hoje() + 1)) > 0, 'ha horarios livres amanha');

-- 5) Agendamento: regras de uso -------------------------------------------------------------------
RESET ROLE;  -- montagem dos ids sem RLS
CREATE TEMP TABLE ids AS SELECT
  (SELECT id FROM public.exclusive_captures WHERE form_data->'imovel'->>'endereco'='Rua Um, 1') AS cap1,
  (SELECT id FROM public.exclusive_captures WHERE form_data->'imovel'->>'endereco'='Rua Um, 2') AS cap2,
  (SELECT id FROM public.exclusive_captures WHERE form_data->'imovel'->>'endereco'='Rua Um, 3') AS cap3,
  (SELECT id FROM public.exclusive_captures WHERE form_data->'imovel'->>'endereco'='Rua Dois, 1') AS capc2,
  (SELECT id FROM public.exclusive_captures WHERE form_data->'imovel'->>'endereco'='Rua Dois, 5') AS capc2_transf,
  (SELECT id FROM public.photo_vouchers WHERE corretor_id = 'a0000000-0000-4000-8000-000000000004' ORDER BY mes_ref, seq LIMIT 1) AS v1,
  (SELECT id FROM public.photo_vouchers WHERE corretor_id = 'a0000000-0000-4000-8000-000000000004' ORDER BY mes_ref, seq OFFSET 1 LIMIT 1) AS v2,
  (SELECT id FROM public.photo_vouchers WHERE corretor_id = 'a0000000-0000-4000-8000-000000000005' ORDER BY seq LIMIT 1) AS vc2;
GRANT SELECT ON ids TO authenticated;
CREATE TEMP TABLE sess(nome text PRIMARY KEY, id uuid);
GRANT ALL ON sess TO authenticated;
SET LOCAL ROLE authenticated;

SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT capc2 FROM ids), pg_temp.amanha(8))') LIKE '42501%',
  'imovel de outro corretor: recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(8), (SELECT vc2 FROM ids))') LIKE 'P0002%',
  'voucher de outro corretor: recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(6))') LIKE '22023%agenda%',
  'fora da faixa liberada: recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(11.5))') LIKE '22023%agenda%',
  'encostando no bloqueio: recusado');
INSERT INTO sess VALUES ('s1', public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(8), (SELECT v1 FROM ids)));
SELECT pg_temp.ok((SELECT status = 'agendado' FROM public.photo_vouchers WHERE id = (SELECT v1 FROM ids)), 'com voucher: voucher fica agendado');
SELECT pg_temp.ok((SELECT paga_por = 'imobiliaria' AND fim = inicio + interval '2 hours' FROM public.photo_sessions WHERE id = (SELECT id FROM sess WHERE nome='s1')),
  'sessao de 2 h paga pela imobiliaria');
-- Intervalo: 8h-10h ocupa até 11h. 10h e 10h30 recusados; 11h aceito.
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap2 FROM ids), pg_temp.amanha(10))') LIKE '23P01%intervalo%',
  'intervalo: 10h (logo depois) recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap2 FROM ids), pg_temp.amanha(7))') LIKE '22023%',
  'antes da faixa: recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(14))') LIKE '22023%sessao marcada%',
  'mesmo imovel com sessao aberta: recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap2 FROM ids), pg_temp.amanha(14), (SELECT v1 FROM ids))') LIKE '22023%disponivel%',
  'mesmo voucher em outro imovel: recusado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.photo_horarios_livres(pg_temp.hoje() + 1, pg_temp.hoje() + 1) t
                               WHERE t > pg_temp.amanha(5) AND t < pg_temp.amanha(11)),
  'horarios livres escondem 2 h + 1 h de intervalo');
INSERT INTO sess VALUES ('s2', public.photo_agendar((SELECT cap2 FROM ids), pg_temp.amanha(14)));
SELECT pg_temp.ok((SELECT paga_por = 'corretor' AND voucher_id IS NULL FROM public.photo_sessions WHERE id = (SELECT id FROM sess WHERE nome='s2')),
  'sem voucher: corretor paga');
-- Sessão anterior: 14h-16h. 11h-13h encostaria no bloqueio 12-13; 16h30 recusado (intervalo).
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap3 FROM ids), pg_temp.amanha(16))') LIKE '23P01%',
  'intervalo depois da sessao das 14h: 16h recusado (ocupa ate 17h)');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap3 FROM ids), pg_temp.amanha(12.5))') LIKE '22023%',
  'sessao que termina dentro de bloqueio: recusada');
-- Validade: sessão depois do vencimento do voucher.
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.photo_agendar((SELECT cap3 FROM ids),
    ((public.photo_voucher_vencimento(pg_temp.hoje()) + 1)::timestamp + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo',
    (SELECT v2 FROM ids))$q$) LIKE '22023%',
  'sessao depois do vencimento do voucher: recusada');
-- Avisos no sino para o fotógrafo (2 marcações).
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE user_id = :'foto' AND tipo = 'foto_marcada') = 2,
  'fotografo recebeu 2 avisos no sino (marcou)');
-- Voucher vencido não pode ser usado.
UPDATE public.photo_vouchers SET vence_em = pg_temp.hoje() - 1 WHERE id = (SELECT v2 FROM ids);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok((SELECT v->>'status' FROM jsonb_array_elements(public.photo_meu_resumo()->'vouchers') v
                    WHERE v->>'id' = (SELECT v2 FROM ids)::text) = 'vencido', 'voucher com data passada aparece como vencido');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap3 FROM ids), pg_temp.amanha(16), (SELECT v2 FROM ids))') LIKE '22023%validade%',
  'voucher vencido: recusado');
RESET ROLE;
UPDATE public.photo_vouchers SET vence_em = public.photo_voucher_vencimento(mes_ref) WHERE id = (SELECT v2 FROM ids);

-- 6) RLS e isolamento ------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok((SELECT count(*) FROM public.photo_vouchers WHERE corretor_id <> auth.uid()) = 0, 'RLS: corretor ve so os proprios vouchers');
SELECT pg_temp.ok((SELECT count(*) FROM public.photo_sessions) = 2, 'RLS: corretor ve so as proprias sessoes');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.photo_vouchers (organization_id, corretor_id, mes_ref, seq, vence_em) VALUES (current_org_id(), auth.uid(), date_trunc(''month'', now())::date, 99, now()::date)') LIKE '42501%',
  'RLS: corretor nao grava voucher direto');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.photo_sessions SET status = ''feita''') LIKE '42501%', 'RLS: corretor nao altera sessao direto');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agenda_listar(pg_temp.hoje(), pg_temp.hoje() + 7)') LIKE '42501%', 'corretor nao abre a agenda do fotografo');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_financeiro(pg_temp.hoje())') LIKE '42501%', 'corretor nao abre o financeiro');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok((SELECT count(*) FROM public.photo_sessions) = 0, 'RLS: outro corretor nao ve as sessoes do C1');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_desmarcar((SELECT id FROM sess WHERE nome=''s1''))') LIKE '42501%', 'outro corretor nao desmarca');
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok((SELECT count(*) FROM public.photo_sessions) = 2, 'RLS: fotografo ve as sessoes');
SELECT pg_temp.ok(jsonb_array_length(public.photo_agenda_listar(pg_temp.hoje(), pg_temp.hoje() + 7)->'sessoes') = 2
  AND (public.photo_agenda_listar(pg_temp.hoje(), pg_temp.hoje() + 7)->'sessoes'->0->>'endereco') LIKE 'Rua Um%',
  'agenda do fotografo: sessoes com corretor, imovel e endereco');
SELECT pg_temp.as_user(:'ab');
SELECT pg_temp.ok((SELECT count(*) FROM public.photo_sessions) = 0 AND (SELECT count(*) FROM public.photo_vouchers) = 0,
  'RLS: outra imobiliaria nao ve nada');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_meu_resumo()') LIKE '42501%', 'imobiliaria B (desligada): resumo recusa');
SELECT pg_temp.as_user(:'cb');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_desmarcar((SELECT id FROM sess WHERE nome=''s1''))') LIKE '42501%', 'corretor de outra imobiliaria nao desmarca');

-- 7) Desmarcar, voucher volta e penalidade --------------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok((public.photo_desmarcar((SELECT id FROM sess WHERE nome='s1'))->>'desmarcacoes_30d')::int = 1, 'corretor desmarca (1 de 3)');
SELECT pg_temp.ok((SELECT status = 'disponivel' FROM public.photo_vouchers WHERE id = (SELECT v1 FROM ids)), 'desmarcou: voucher voltou');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE user_id = :'foto' AND tipo = 'foto_desmarcada') = 1,
  'fotografo recebeu aviso no sino (desmarcou)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
UPDATE sess SET id = public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(8), (SELECT v1 FROM ids)) WHERE nome = 's1';
SELECT pg_temp.ok((SELECT status = 'agendado' FROM public.photo_vouchers WHERE id = (SELECT v1 FROM ids)), 'reagendou com o mesmo voucher');
-- Fotógrafo desmarca: não conta penalidade e avisa o corretor.
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok(public.photo_desmarcar((SELECT id FROM sess WHERE nome='s1'), 'chuva')->>'papel' = 'fotografo', 'fotografo desmarca');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE user_id = :'c1' AND tipo = 'foto_desmarcada') = 1,
  'corretor avisado no sino quando o fotografo desmarca');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.desm(:'org_a', :'c1') = 1, 'desmarcacao do fotografo nao conta (continua 1)');
UPDATE sess SET id = public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(8), (SELECT v1 FROM ids)) WHERE nome = 's1';
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.photo_desmarcar((SELECT id FROM sess WHERE nome='s1'))->>'papel' = 'admin', 'admin desmarca');
SELECT pg_temp.ok(pg_temp.desm(:'org_a', :'c1') = 1, 'desmarcacao do admin nao conta (continua 1)');
SELECT pg_temp.as_user(:'c1');
UPDATE sess SET id = public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(8), (SELECT v1 FROM ids)) WHERE nome = 's1';
SELECT pg_temp.ok((public.photo_desmarcar((SELECT id FROM sess WHERE nome='s1'))->>'desmarcacoes_30d')::int = 2, 'corretor desmarca (2 de 3)');
UPDATE sess SET id = public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(8), (SELECT v1 FROM ids)) WHERE nome = 's1';
CREATE TEMP TABLE pen AS SELECT public.photo_desmarcar((SELECT id FROM sess WHERE nome='s1')) AS j;
SELECT pg_temp.ok((SELECT (j->>'desmarcacoes_30d')::int = 3 AND (j->>'bloqueado_ate')::timestamptz
                           BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 minute' FROM pen),
  '3a desmarcacao em 30 dias: bloqueado por 7 dias');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(8), (SELECT v1 FROM ids))') LIKE '42501%bloqueado ate%',
  'bloqueado: agendar recusa e mostra a data');
SELECT pg_temp.ok((public.photo_meu_resumo()->>'bloqueado_ate') IS NOT NULL, 'resumo mostra a data de liberacao');
SELECT pg_temp.ok((SELECT status = 'disponivel' FROM public.photo_vouchers WHERE id = (SELECT v1 FROM ids)), 'bloqueado: voucher continua disponivel');
-- Depois de vencer o bloqueio, a contagem recomeça do zero.
RESET ROLE;
UPDATE public.photo_penalidades SET bloqueado_ate = now() - interval '1 minute' WHERE corretor_id = :'c1';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.desm(:'org_a', :'c1') = 0, 'depois do bloqueio, contagem recomeca');
UPDATE sess SET id = public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(8), (SELECT v1 FROM ids)) WHERE nome = 's1';
SELECT pg_temp.ok((SELECT status = 'aguardando' FROM public.photo_sessions WHERE id = (SELECT id FROM sess WHERE nome='s1')), 'liberado: agenda de novo (aguardando)');
-- Desmarcações antigas (> 30 dias) não contam.
RESET ROLE;
DELETE FROM public.photo_penalidades WHERE corretor_id = :'c1';
UPDATE public.photo_sessions SET cancelada_em = now() - interval '31 days' WHERE corretor_id = :'c1' AND status = 'cancelada';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.desm(:'org_a', :'c1') = 0, 'desmarcacoes com mais de 30 dias nao contam');

-- 8) Feita, valor congelado e Financeiro -----------------------------------------------------------
-- Leva as duas sessões para o passado (a sessão precisa ter começado para virar "feita").
RESET ROLE;
UPDATE public.photo_sessions SET inicio = inicio - interval '2 days', fim = fim - interval '2 days', ocupa_ate = ocupa_ate - interval '2 days'
 WHERE status IN ('aguardando', 'confirmada');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_marcar_feita((SELECT id FROM sess WHERE nome=''s1''))') LIKE '42501%', 'corretor nao marca feita');
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok((public.photo_marcar_feita((SELECT id FROM sess WHERE nome='s1'))->>'valor_congelado')::numeric = 150, 'fotografo marca feita (valor 150 congelado)');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_desmarcar((SELECT id FROM sess WHERE nome=''s1''))') LIKE '22023%', 'sessao feita nao desmarca');
SELECT pg_temp.as_user(:'admin');
SELECT public.photo_configurar(:'foto', 200);
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok((public.photo_marcar_feita((SELECT id FROM sess WHERE nome='s2'))->>'valor_congelado')::numeric = 200, 'sessao sem voucher feita com o valor novo (200)');
RESET ROLE;
SELECT pg_temp.ok((SELECT valor_congelado FROM public.photo_sessions WHERE id = (SELECT id FROM sess WHERE nome='s1')) = 150,
  'mudar o valor nao mexe na sessao ja feita (continua 150)');
SELECT pg_temp.ok((SELECT status = 'usado' FROM public.photo_vouchers WHERE id = (SELECT v1 FROM ids)), 'feita: voucher usado');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_agendar((SELECT cap1 FROM ids), pg_temp.amanha(14.5), (SELECT v2 FROM ids))') LIKE '22023%1 por imovel%',
  '1 voucher por imovel: segundo voucher no mesmo imovel recusado');
SELECT pg_temp.as_user(:'fin');
CREATE TEMP TABLE finj AS SELECT public.photo_financeiro(((SELECT inicio FROM public.photo_sessions WHERE id = (SELECT id FROM sess WHERE nome='s2')) AT TIME ZONE 'America/Sao_Paulo')::date) AS j;
SELECT pg_temp.ok((SELECT jsonb_array_length(j->'remax') = 1 AND (j->>'remax_total')::numeric = 150 FROM finj), 'financeiro: RE/MAX paga 1 sessao, total 150');
SELECT pg_temp.ok((SELECT jsonb_array_length(j->'a_cobrar') = 1 AND (j->>'a_cobrar_total')::numeric = 200
                          AND j->'a_cobrar'->0->>'corretor_telefone' = '15990000004' AND j->'a_cobrar'->0->>'cobranca_status' = 'a_cobrar' FROM finj),
  'financeiro: a cobrar do corretor 200, com telefone');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_marcar_cobrado((SELECT id FROM sess WHERE nome=''s1''))') LIKE '22023%', 'sessao com voucher nao entra na cobranca');
SELECT pg_temp.ok(public.photo_marcar_cobrado((SELECT id FROM sess WHERE nome='s2')), 'financeiro marca cobrado');
SELECT pg_temp.ok((SELECT cobranca_status = 'cobrado' AND cobrado_por = auth.uid() FROM public.photo_sessions WHERE id = (SELECT id FROM sess WHERE nome='s2')),
  'cobrado registrado com quem marcou');
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_marcar_cobrado((SELECT id FROM sess WHERE nome=''s2''))') LIKE '42501%', 'fotografo nao marca cobrado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_financeiro(pg_temp.hoje())') LIKE '42501%', 'fotografo nao abre o financeiro');

-- 8b) Confirmação pelo fotógrafo + dados do WhatsApp -----------------------------------------------
SELECT pg_temp.as_user(:'c1');
INSERT INTO sess VALUES ('s3', public.photo_agendar((SELECT cap3 FROM ids), pg_temp.amanha(8), (SELECT v2 FROM ids)));
SELECT pg_temp.ok((SELECT status = 'aguardando' FROM public.photo_sessions WHERE id = (SELECT id FROM sess WHERE nome='s3')),
  'reserva nasce aguardando confirmacao');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.photo_horarios_livres(pg_temp.hoje() + 1, pg_temp.hoje() + 1) t
                               WHERE t >= pg_temp.amanha(8) AND t < pg_temp.amanha(11)), 'aguardando ja bloqueia o horario');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_responder((SELECT id FROM sess WHERE nome=''s3''), true)') LIKE '42501%',
  'corretor nao confirma a propria sessao');
CREATE TEMP TABLE wpp1 AS SELECT public.photo_aviso_para_envio((SELECT id FROM sess WHERE nome='s3'), 'marcada') AS j;
SELECT pg_temp.ok((SELECT j->'destinos' = jsonb_build_array(:'foto'::uuid) AND j->>'tipo' = 'foto_marcada' FROM wpp1),
  'WhatsApp de "marcou": 1 destino (fotografo)');
SELECT pg_temp.ok(public.photo_aviso_para_envio((SELECT id FROM sess WHERE nome='s3'), 'confirmada') IS NULL,
  'WhatsApp: evento diferente da ultima acao nao envia');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.photo_aviso_para_envio((SELECT id FROM sess WHERE nome='s3'), 'marcada') IS NULL,
  'WhatsApp: outra pessoa nao dispara o aviso');
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok(public.photo_responder((SELECT id FROM sess WHERE nome='s3'), false, 'agenda cheia') = 'recusada', 'fotografo recusa');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok((SELECT status = 'disponivel' FROM public.photo_vouchers WHERE id = (SELECT v2 FROM ids)), 'recusa devolve o voucher');
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok(pg_temp.desm(:'org_a', :'c1') = 0, 'recusa nao conta como desmarcacao');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.photo_horarios_livres(pg_temp.hoje() + 1, pg_temp.hoje() + 1) t
                           WHERE t = pg_temp.amanha(8)), 'recusa libera o horario');
CREATE TEMP TABLE wpp2 AS SELECT public.photo_aviso_para_envio((SELECT id FROM sess WHERE nome='s3'), 'recusada') AS j;
SELECT pg_temp.ok((SELECT j->'destinos' = jsonb_build_array(:'c1'::uuid) AND j->>'mensagem' LIKE '%agenda cheia%' FROM wpp2),
  'WhatsApp de "recusou": 1 destino (corretor), com o motivo');
SELECT pg_temp.as_user(:'c1');
UPDATE sess SET id = public.photo_agendar((SELECT cap3 FROM ids), pg_temp.amanha(8), (SELECT v2 FROM ids)) WHERE nome = 's3';
SELECT pg_temp.as_user(:'foto');
SELECT pg_temp.ok(public.photo_responder((SELECT id FROM sess WHERE nome='s3'), true) = 'confirmada', 'fotografo confirma');
SELECT pg_temp.ok(pg_temp.err('SELECT public.photo_responder((SELECT id FROM sess WHERE nome=''s3''), false)') LIKE '22023%',
  'sessao ja confirmada nao e respondida de novo');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE user_id = :'c1' AND tipo = 'foto_confirmada') = 1
              AND (SELECT count(*) FROM public.notifications WHERE user_id = :'c1' AND tipo = 'foto_recusada') = 1,
  'corretor avisado no sino: confirmou e recusou (1 cada)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(public.photo_desmarcar((SELECT id FROM sess WHERE nome='s3'))->>'papel' = 'corretor', 'corretor desmarca sessao confirmada');
CREATE TEMP TABLE wpp3 AS SELECT public.photo_aviso_para_envio((SELECT id FROM sess WHERE nome='s3'), 'desmarcada') AS j;
SELECT pg_temp.ok((SELECT j->'destinos' = jsonb_build_array(:'foto'::uuid) FROM wpp3),
  'WhatsApp de "desmarcou" pelo corretor: so o fotografo (quem agiu nao recebe)');
SELECT pg_temp.ok((SELECT status = 'disponivel' FROM public.photo_vouchers WHERE id = (SELECT v2 FROM ids)), 'desmarcou confirmada: voucher voltou');
RESET ROLE;

-- 9) Desligar o módulo esconde tudo ----------------------------------------------------------------
SELECT pg_temp.as_user(:'plat');
SET LOCAL ROLE authenticated;
SELECT public.platform_set_organization_module(:'org_a', 'vouchers_fotos', false);
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(NOT public.vouchers_fotos_enabled() AND (SELECT count(*) FROM public.photo_vouchers) = 0
                  AND (SELECT count(*) FROM public.photo_sessions) = 0, 'desligado: nada aparece (RLS e RPC)');
RESET ROLE;
SELECT pg_temp.cap(:'org_a', :'c2', 'aprovada', pg_temp.hoje(), 'Rua Dois, 9');
SELECT pg_temp.ok(pg_temp.qtd(:'org_a', :'c2') = 5, 'desligado: captacao nova nao gera voucher');
SELECT pg_temp.ok((SELECT count(*) FROM public.photo_vouchers) > 0, 'desligar nao apaga os dados');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
