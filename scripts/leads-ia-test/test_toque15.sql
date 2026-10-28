-- Testes da migration 20261028190000 (t_b3f753a5): lembrete rápido de 15 min da Nicole.
-- PostgreSQL descartável, 2 imobiliárias, dados 100% fictícios. Uso: bash scripts/leads-ia-test/test_toque15.sh
-- O horário comercial é testado direto em lead_ia_toque15_horario (datas fixas); os demais casos precisam rodar
-- em horário comercial (seg-sáb, 9h-19h de Brasília) — fora dele o teste H0 avisa e os outros ficam "nada".
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO authenticated, service_role;
CREATE TABLE t.res (n serial, ok boolean, label text);
GRANT ALL ON t.res TO authenticated; GRANT ALL ON SEQUENCE t.res_n_seq TO authenticated;
CREATE FUNCTION t.ok(_c boolean, _l text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t.res (ok, label) VALUES (coalesce(_c, false), _l); END $$;
CREATE FUNCTION t.como(_u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u)::text, false);
  PERFORM set_config('role', 'authenticated', false);
END $$;
CREATE FUNCTION t.dono() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'postgres', false); PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false); END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;
-- Conversa de teste: 1ª mensagem há 1 h (ou antes da resposta), cliente respondeu, a Nicole respondeu há _min minutos (enviada).
CREATE FUNCTION t.conversa(_org uuid, _tel text, _min integer, _cliente boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _l uuid; _cv uuid;
BEGIN
  _l := public.lead_inserir(_org, 'Maria Teste', _tel, NULL, 'olx', NULL, NULL, NULL, false, NULL, 'x' || _tel);
  SELECT id INTO _cv FROM public.lead_conversas WHERE lead_id = _l;
  DELETE FROM public.lead_mensagens WHERE conversa_id = _cv;
  UPDATE public.lead_conversas SET canal = 'ziontalk', estado = 'ativa',
         primeira_enviada_em = now() - make_interval(mins => greatest(60, _min + 2)) WHERE id = _cv;
  INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status, created_at)
  VALUES (_org, _cv, 'ia', 'Oi, Maria! Vi seu interesse no apartamento. Quer saber mais detalhes?', 'enviada',
          now() - make_interval(mins => greatest(60, _min + 2)));
  IF _cliente THEN
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status, created_at)
    VALUES (_org, _cv, 'cliente', 'tem mais opções?', 'recebida', now() - make_interval(mins => _min + 1));
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status, created_at)
    VALUES (_org, _cv, 'ia', 'Tenho outra opção no mesmo bairro. Gostou?', 'enviada', now() - make_interval(mins => _min));
  END IF;
  -- O lead_inserir grava eventos com autor do sistema; aqui nenhum corretor mexeu no lead.
  DELETE FROM public.lead_eventos WHERE lead_id = _l AND autor_id IS NOT NULL;
  RETURN _cv;
END $$;
CREATE FUNCTION t.ultima(_cv uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.lead_mensagens WHERE conversa_id = _cv ORDER BY created_at DESC, id DESC LIMIT 1 $$;
CREATE FUNCTION t.cand(_cv uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.lead_ia_toque15_candidatas() c WHERE c.conversa_id = _cv) $$;
CREATE FUNCTION t.gravar(_cv uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.lead_ia_toque15_gravar(_cv, t.ultima(_cv), 'Fico por aqui. Se quiser, te mando mais opções parecidas nessa faixa.') $$;
-- Zera o intervalo do chip entre um caso e outro (o intervalo em si é testado em I1/I2).
CREATE FUNCTION t.chip(_org uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE public.lead_config SET ia_reengajar_proximo_em = NULL WHERE organization_id = _org $$;

\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set corA '''a0000000-0000-0000-0000-0000000000c1'''

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
SELECT t.como(:admA); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.como('b0000000-0000-0000-0000-00000000000a'); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.dono();
SELECT public.lead_ia_canal_definir(:orgA, 'ziontalk'), public.lead_ia_canal_definir(:orgB, 'ziontalk');
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110001','15981110002','15981110003','15981110004','15981110005',
  '15981110006','15981110007','15981110008','15981110009','15981110010','15981110011','15981110012','15981110013']);
SELECT public.lead_ia_allowlist_definir(:orgB, ARRAY['15981110001']);
UPDATE public.lead_config SET ia_envio_limite_dia = 50 WHERE organization_id IN (:orgA, :orgB);

-- Horário comercial (datas fixas, Brasília = UTC-3) ------------------------------------------------------------------
SELECT t.ok(public.lead_ia_toque15_horario('2026-10-28 12:00:00+00'), 'H1 quarta 9h de Brasília: dentro');
SELECT t.ok(NOT public.lead_ia_toque15_horario('2026-10-28 11:59:00+00'), 'H2 quarta 8h59: fora (espera a abertura)');
SELECT t.ok(public.lead_ia_toque15_horario('2026-10-28 21:59:00+00'), 'H3 quarta 18h59: dentro');
SELECT t.ok(NOT public.lead_ia_toque15_horario('2026-10-28 22:00:00+00'), 'H4 quarta 19h: fora');
SELECT t.ok(NOT public.lead_ia_toque15_horario('2026-11-01 15:00:00+00'), 'H5 domingo: fora');
SELECT t.ok(public.lead_ia_toque15_horario('2026-10-31 15:00:00+00'), 'H6 sábado 12h: dentro');
SELECT public.lead_ia_toque15_horario(now()) AS agora_ok \gset
SELECT t.ok(:'agora_ok'::boolean, 'H0 este teste rodou em horário comercial (necessário para os casos abaixo)');

-- Chave desligada por padrão --------------------------------------------------------------------------------------
SELECT t.conversa(:orgA, '15981110001', 16) AS cv1 \gset
SELECT t.ok(NOT (SELECT ia_toque15 FROM public.lead_config WHERE organization_id = :orgA), 'C1 chave nasce desligada');
SELECT t.ok(NOT t.cand(:'cv1') AND t.gravar(:'cv1') IS NULL, 'C2 desligada: nada');
SELECT t.ok((SELECT ia_toque15_min FROM public.lead_config WHERE organization_id = :orgA) = 15, 'C3 padrão 15 min');
SELECT t.como(:corA);
DO $$ BEGIN PERFORM public.lead_ia_toque15_salvar(true); RAISE EXCEPTION 'passou'; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT t.dono();
SELECT t.ok(NOT (SELECT ia_toque15 FROM public.lead_config WHERE organization_id = :orgA), 'C4 corretor não liga a chave');
SELECT t.como(:admA); SELECT public.lead_ia_toque15_salvar(true); SELECT t.dono();
SELECT t.ok((SELECT ia_toque15 FROM public.lead_config WHERE organization_id = :orgA), 'C5 administrador liga na própria imobiliária');
SELECT t.ok(NOT (SELECT ia_toque15 FROM public.lead_config WHERE organization_id = :orgB)
            AND NOT (SELECT ia_reengajar FROM public.lead_config WHERE organization_id = :orgA), 'C6 não liga a outra imobiliária nem o lembrete de 24 h');

-- Gatilho: dispara aos 15 min, não antes ----------------------------------------------------------------------------
SELECT t.conversa(:orgA, '15981110002', 14) AS cv2 \gset
SELECT t.ok(NOT t.cand(:'cv2') AND t.gravar(:'cv2') IS NULL, 'G1 14 min: ainda não');
SELECT t.ok(t.cand(:'cv1'), 'G2 16 min: aparece como candidata');
SELECT t.gravar(:'cv1') AS g3 \gset
SELECT t.ok(:'g3' <> '' AND (SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND status = 'pendente') = 1,
            'G3 grava 1 toque pendente');
SELECT t.ok((SELECT toque15_em FROM public.lead_conversas WHERE id = :'cv1') IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.lead_eventos WHERE lead_id = :'g3' AND para = 'toque_15min'), 'G4 marca a conversa e o histórico');
-- Só 1 vez por conversa (mesmo depois de enviado e de mais 15 min sem resposta).
UPDATE public.lead_mensagens SET status = 'enviada', created_at = now() - interval '20 minutes' WHERE conversa_id = :'cv1' AND status = 'pendente';
SELECT t.chip(:orgA);
SELECT t.ok(NOT t.cand(:'cv1') AND t.gravar(:'cv1') IS NULL, 'G5 só 1 vez por conversa');

-- Quem nunca respondeu: fica com os lembretes de 24/72 h -------------------------------------------------------------
SELECT t.conversa(:orgA, '15981110003', 30, false) AS cv3 \gset
SELECT t.ok(NOT t.cand(:'cv3') AND t.gravar(:'cv3') IS NULL, 'N1 cliente nunca respondeu: nada');

-- Última mensagem do cliente (ele respondeu): nada ------------------------------------------------------------------
SELECT t.conversa(:orgA, '15981110004', 20) AS cv4 \gset
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status, created_at)
VALUES (:orgA, :'cv4', 'cliente', 'gostei', 'recebida', now() - interval '16 minutes');
SELECT t.ok(NOT t.cand(:'cv4') AND t.gravar(:'cv4') IS NULL, 'R1 última mensagem é do cliente: nada');
-- O cliente respondeu entre a lista e a gravação (id da última mudou): nada.
SELECT t.conversa(:orgA, '15981110005', 20) AS cv5 \gset
SELECT t.ultima(:'cv5') AS u5 \gset
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status) VALUES (:orgA, :'cv5', 'cliente', 'oi', 'recebida');
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status) VALUES (:orgA, :'cv5', 'ia', 'Claro!', 'enviada');
SELECT t.ok(public.lead_ia_toque15_gravar(:'cv5', :'u5', 'Fico por aqui. Se quiser, te mando mais opções parecidas nessa faixa.') IS NULL,
            'R2 conversa andou desde a lista: não grava');
-- A última da Nicole ainda não saiu (falhou / não enviada): nada.
SELECT t.conversa(:orgA, '15981110006', 20) AS cv6 \gset
UPDATE public.lead_mensagens SET status = 'falhou' WHERE id = t.ultima(:'cv6');
SELECT t.ok(NOT t.cand(:'cv6'), 'R3 última da Nicole não foi enviada: nada');

-- Para quando a conversa foi passada, recusada, SAIR, parada, lead fechado ou corretor assumiu --------------------
SELECT t.conversa(:orgA, '15981110007', 20) AS cv7 \gset
SELECT public.lead_ia_passar(:'cv7', 'qualificado', 'teste');
SELECT t.ok(NOT t.cand(:'cv7') AND t.gravar(:'cv7') IS NULL, 'P1 passada ao corretor: nada');
SELECT t.conversa(:orgA, '15981110008', 20) AS cv8 \gset
SELECT public.lead_ia_passar(:'cv8', 'sem_interesse', 'recusou');
SELECT t.ok(NOT t.cand(:'cv8'), 'P2 recusou (sem interesse): nada');
SELECT t.conversa(:orgA, '15981110009', 20) AS cv9 \gset
INSERT INTO public.lead_ia_optouts (organization_id, contato) VALUES (:orgA, '15981110009');
SELECT t.ok(NOT t.cand(:'cv9') AND t.gravar(:'cv9') IS NULL, 'P3 pediu SAIR (opt-out): nada');
SELECT t.conversa(:orgA, '15981110010', 20) AS cv10 \gset
UPDATE public.leads SET aceito_em = now() WHERE id = (SELECT lead_id FROM public.lead_conversas WHERE id = :'cv10');
SELECT t.ok(NOT t.cand(:'cv10'), 'P4 corretor aceitou o lead: nada');
UPDATE public.leads SET aceito_em = NULL WHERE id = (SELECT lead_id FROM public.lead_conversas WHERE id = :'cv10');
INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, nota, autor_id)
VALUES (:orgA, (SELECT lead_id FROM public.lead_conversas WHERE id = :'cv10'), 'nota', 'liguei', :corA);
SELECT t.ok(NOT t.cand(:'cv10'), 'P5 corretor registrou algo no lead: nada');
SELECT t.conversa(:orgA, '15981110011', 20) AS cv11 \gset
UPDATE public.lead_conversas SET equipe_em = now() WHERE id = :'cv11';
SELECT t.ok(NOT t.cand(:'cv11'), 'P6 equipe escreveu pelo número: nada');
UPDATE public.lead_conversas SET equipe_em = NULL WHERE id = :'cv11';
UPDATE public.leads SET etapa = 'ganho' WHERE id = (SELECT lead_id FROM public.lead_conversas WHERE id = :'cv11');
SELECT t.ok(NOT t.cand(:'cv11'), 'P7 lead fechado (ganho/perdido): nada');

-- Janela de 24 h: se já chegou, fica só o lembrete de 24 h -------------------------------------------------------------
SELECT t.conversa(:orgA, '15981110012', 24 * 60 + 5) AS cv12 \gset
SELECT t.ok(NOT t.cand(:'cv12') AND t.gravar(:'cv12') IS NULL, 'J1 parou há mais de 24 h: não manda os dois');
UPDATE public.lead_mensagens SET created_at = now() - interval '13 hours' WHERE id = t.ultima(:'cv12');
UPDATE public.lead_conversas SET reengaje_1_em = now() - interval '1 minute' WHERE id = :'cv12';
SELECT t.ok(NOT t.cand(:'cv12'), 'J2 lembrete de 24 h já saiu: nada');
UPDATE public.lead_conversas SET reengaje_1_em = NULL WHERE id = :'cv12';
SELECT t.ok(t.cand(:'cv12'), 'J3 parou de noite (13 h atrás), abriu o horário: manda na abertura');

-- Allowlist, limite diário, intervalo do chip, outra imobiliária -------------------------------------------------------
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110001']);
SELECT t.ok(NOT t.cand(:'cv12') AND t.gravar(:'cv12') IS NULL, 'L1 fora da lista de liberados: nada');
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110012']);
-- Intervalo do chip: o toque G3 empurrou ia_reengajar_proximo_em; simula o relógio ainda correndo.
UPDATE public.lead_config SET ia_reengajar_proximo_em = now() + interval '90 seconds' WHERE organization_id = :orgA;
SELECT t.ok(NOT t.cand(:'cv12') AND t.gravar(:'cv12') IS NULL, 'I1 intervalo do chip correndo: espera');
SELECT t.chip(:orgA);
UPDATE public.lead_config SET ia_envio_limite_dia = 1 WHERE organization_id = :orgA;
SELECT t.ok(t.gravar(:'cv12') IS NULL, 'L2 limite diário atingido: nada');
UPDATE public.lead_config SET ia_envio_limite_dia = 50 WHERE organization_id = :orgA;
SELECT t.gravar(:'cv12') AS g12 \gset
SELECT t.ok(:'g12' <> '', 'L3 dentro do limite: grava');
SELECT t.ok((SELECT ia_reengajar_proximo_em FROM public.lead_config WHERE organization_id = :orgA) > now(), 'I2 toque empurra o intervalo do chip');
-- Imobiliária no limite não aparece na lista (não ocupa a vez das outras nem chama o modelo).
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110012','15981110013']);
SELECT t.conversa(:orgA, '15981110013', 20) AS cv13 \gset
SELECT t.chip(:orgA);
SELECT t.ok(t.cand(:'cv13'), 'L4 com limite livre: aparece');
UPDATE public.lead_config SET ia_envio_limite_dia = public.lead_ia_toque15_hoje(:orgA) WHERE organization_id = :orgA;
SELECT t.ok(NOT t.cand(:'cv13'), 'L5 no limite: nem aparece na lista');
UPDATE public.lead_config SET ia_envio_limite_dia = 50 WHERE organization_id = :orgA;
-- Outra imobiliária: mesmo telefone, chave desligada lá; o toque da A não aparece para a B nem o contrário.
SELECT t.conversa(:orgB, '15981110001', 20) AS cvb \gset
SELECT t.ok(NOT t.cand(:'cvb') AND t.gravar(:'cvb') IS NULL, 'O1 outra imobiliária com a chave desligada: nada');
-- 1 por imobiliária: a A tem mais de 1 conversa elegível, mas só 1 vai para a lista.
SELECT t.conversa(:orgA, '15981110014', 30) AS cv14 \gset
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110013','15981110014']);
SELECT t.ok((SELECT count(*) FROM public.lead_ia_toque15_candidatas() c WHERE c.organization_id = :orgA) = 1
            AND t.cand(:'cv14'), 'O4 no máximo 1 por imobiliária (a parada há mais tempo)');
UPDATE public.lead_config SET ia_toque15 = true WHERE organization_id = :orgB;
SELECT t.ok((SELECT count(*) FROM public.lead_ia_toque15_candidatas() c WHERE c.organization_id = :orgB) = 1
            AND (SELECT bool_and(c.organization_id = cv.organization_id) FROM public.lead_ia_toque15_candidatas() c
                   JOIN public.lead_conversas cv ON cv.id = c.conversa_id), 'O2 cada candidata é da própria imobiliária');
SELECT t.ok((SELECT count(*) FROM public.lead_mensagens WHERE organization_id = :orgB AND status = 'pendente') = 0,
            'O3 nada gravado na B pelos toques da A');

-- Texto: o banco recusa link e número ------------------------------------------------------------------------------
SELECT t.chip(:orgB);
DO $$ BEGIN PERFORM public.lead_ia_toque15_gravar((SELECT id FROM public.lead_conversas WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000000' LIMIT 1),
  gen_random_uuid(), 'Fico por aqui, veja https://site.com.br/imovel/1'); RAISE EXCEPTION 'passou';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
DO $$ BEGIN PERFORM public.lead_ia_toque15_gravar((SELECT id FROM public.lead_conversas WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000000' LIMIT 1),
  gen_random_uuid(), 'Fico por aqui. Tenho outro por R$ 500 mil se quiser.'); RAISE EXCEPTION 'passou';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
DO $$ BEGIN PERFORM public.lead_ia_toque15_gravar((SELECT id FROM public.lead_conversas WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000000' LIMIT 1),
  gen_random_uuid(), 'oi?'); RAISE EXCEPTION 'passou';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
DO $$ BEGIN PERFORM public.lead_ia_toque15_gravar((SELECT id FROM public.lead_conversas WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000000' LIMIT 1),
  gen_random_uuid(), 'Fico por aqui. Tenho uma casa com ３ quartos para você.'); RAISE EXCEPTION 'passou';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
SELECT t.ok(true, 'T1 banco recusa link, preço/número (até dígito largo) e texto curto demais ("oi?")');

-- Permissões -------------------------------------------------------------------------------------------------------
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.lead_ia_toque15_candidatas()', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.lead_ia_toque15_gravar(uuid,uuid,text)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.lead_ia_toque15_gravar(uuid,uuid,text)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.lead_ia_toque15_elegivel(uuid,uuid)', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.lead_ia_toque15_gravar(uuid,uuid,text)', 'EXECUTE'),
            'S1 candidatas/gravar só service_role');
SELECT t.ok(has_column_privilege('authenticated', 'public.lead_config', 'ia_toque15', 'SELECT')
            AND NOT has_function_privilege('anon', 'public.lead_ia_toque15_salvar(boolean)', 'EXECUTE'), 'S2 tela lê a chave; anon não salva');

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT 'FAIL ' || label FROM t.res WHERE NOT ok;
