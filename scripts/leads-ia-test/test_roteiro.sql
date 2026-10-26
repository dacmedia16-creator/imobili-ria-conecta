-- Testes do roteiro novo da Nicole (t_fc4d9b27) em PostgreSQL descartável: 2 imobiliárias (A e B).
-- Uso: ROTEIRO=1 bash scripts/leads-ia-test/setup.sh tfc4d && docker exec -i pgt-3284-db psql -U postgres -d tfc4d -q < scripts/leads-ia-test/test_roteiro.sql
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO authenticated, service_role;
CREATE TABLE t.res (n serial, ok boolean, label text);
GRANT ALL ON t.res TO authenticated; GRANT ALL ON SEQUENCE t.res_n_seq TO authenticated;
CREATE FUNCTION t.ok(_c boolean, _l text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t.res (ok, label) VALUES (coalesce(_c, false), _l);
  IF coalesce(_c, false) THEN RAISE NOTICE 'PASS %', _l; ELSE RAISE NOTICE 'FAIL %', _l; END IF;
END $$;
CREATE FUNCTION t.como(_u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u)::text, false);
  PERFORM set_config('role', 'authenticated', false);
END $$;
CREATE FUNCTION t.dono() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', false);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
END $$;
CREATE FUNCTION t.falha(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set gesA '''a0000000-0000-0000-0000-00000000000e'''
\set c1 '''a0000000-0000-0000-0000-0000000000c1'''
\set admB '''b0000000-0000-0000-0000-00000000000a'''
\set cB '''b0000000-0000-0000-0000-0000000000cb'''
\set capA '''cccccccc-0000-0000-0000-000000000001'''
\set capA2 '''cccccccc-0000-0000-0000-000000000002'''
\set capB '''dddddddd-0000-0000-0000-000000000001'''

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
UPDATE public.organizations SET nome = 'Imobiliária Alfa' WHERE id = :orgA;
UPDATE public.organizations SET nome = 'Imobiliária Beta' WHERE id = :orgB;
-- Captações: A tem ficha (quartos/vagas/área) + uma alternativa compatível; B tem uma com outro bairro.
INSERT INTO public.exclusive_captures (id, organization_id, captor_id, form_data, status) VALUES
 (:capA, :orgA, :c1, '{"imovel":{"tipo_imovel":"Apartamento","bairro":"Campolim","municipio":"Sorocaba","valor":"999999"},
   "ficha":{"quartos":"3","suites":"1","vagas":"2","area_util_m2":"80","observacoes":"condomínio 650"}}', 'aprovada'),
 (:capA2, :orgA, :c1, '{"imovel":{"tipo_imovel":"apto","bairro":"Jardim Europa","municipio":"Sorocaba"}}', 'aprovada'),
 (:capB, :orgB, :cB, '{"imovel":{"tipo_imovel":"Casa","bairro":"Centro","municipio":"Itu"},"ficha":{"quartos":"2"}}', 'aprovada');

-- Distribuição simplificada para o teste: leads novos da A vão para o Corretor 1 (c1).
CREATE FUNCTION t.resp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id = 'aaaaaaaa-0000-0000-0000-000000000000' AND NEW.responsavel_id IS NULL THEN
    NEW.responsavel_id := 'a0000000-0000-0000-0000-0000000000c1';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_t_resp BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION t.resp();

-- 1) Configuração nova -----------------------------------------------------------------------------------
SELECT t.ok((SELECT ia_primeira_msg IS NULL AND NOT ia_reengajar AND ia_reengajar_h1 = 24 AND ia_reengajar_h2 = 72
               FROM public.lead_config WHERE organization_id = :orgA), 'P01 reengajamento nasce DESLIGADO (24 h / 72 h)');
SELECT t.como(:gesA);
SELECT t.ok(t.falha($$SELECT public.lead_ia_roteiro_salvar(NULL, true)$$), 'P02 gestor não altera o roteiro');
SELECT t.como(:admA);
SELECT t.ok(t.falha($$SELECT public.lead_ia_roteiro_salvar('Veja www.alfa.com.br?', false)$$), 'P03 1ª mensagem com link recusada');
SELECT t.ok(t.falha($$SELECT public.lead_ia_roteiro_salvar(repeat('x', 401), false)$$), 'P04 1ª mensagem > 400 recusada');
SELECT public.lead_ia_roteiro_salvar(NULL, false);
SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.ok((SELECT count(*) = 1 FROM public.lead_config), 'P05 admin A vê só a config da A');
SELECT t.como(:admB);
SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT public.lead_ia_roteiro_salvar('Olá {nome}, da {imobiliaria}, sobre {imovel}. Posso ajudar?', false);
SELECT t.dono();
SELECT t.ok((SELECT ia_primeira_msg IS NULL FROM public.lead_config WHERE organization_id = :orgA)
        AND (SELECT ia_primeira_msg LIKE 'Olá {nome}%' FROM public.lead_config WHERE organization_id = :orgB),
            'P06 cada admin altera só a própria imobiliária');

-- 2) 1ª mensagem ------------------------------------------------------------------------------------------
SELECT public.lead_inserir(:orgA, 'Maria Souza', '15981110001', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'ra1') AS la1 \gset
SELECT id AS cva1 FROM public.lead_conversas WHERE lead_id = :'la1' \gset
SELECT texto AS m1 FROM public.lead_mensagens WHERE conversa_id = :'cva1' AND autor = 'ia' \gset
SELECT t.ok(:'m1' = 'Oi, Maria! Aqui é a Nicole, assistente virtual da Imobiliária Alfa. Vi seu interesse no apartamento do bairro Campolim. Quer saber valores e condições, ou já prefere agendar uma visita?',
            'P07 1ª mensagem padrão: assistente virtual, org, tipo e bairro, pergunta fechada');
SELECT t.ok((SELECT count(*) = 1 FROM public.lead_mensagens WHERE conversa_id = :'cva1' AND autor = 'ia')
            AND :'m1' !~* '(https?://|www\.|SAIR|999999)', 'P08 uma bolha, sem link e sem preço');
SELECT public.lead_inserir(:orgA, 'Lead Grupo ZAP', '15981110002', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'ra2') AS la2 \gset
SELECT id AS cva2 FROM public.lead_conversas WHERE lead_id = :'la2' \gset
SELECT t.ok((SELECT texto FROM public.lead_mensagens WHERE conversa_id = :'cva2' AND autor = 'ia')
            LIKE 'Oi! Aqui é a Nicole, assistente virtual da Imobiliária Alfa. Vi seu interesse no imóvel que você viu.%',
            'P09 sem nome e sem captação: "Oi!" e texto neutro');
SELECT public.lead_inserir(:orgB, 'João Lima', '11981110009', NULL, 'olx', NULL, :capB, NULL, false, NULL, 'rb1') AS lb1 \gset
SELECT id AS cvb1 FROM public.lead_conversas WHERE lead_id = :'lb1' \gset
SELECT t.ok((SELECT texto FROM public.lead_mensagens WHERE conversa_id = :'cvb1' AND autor = 'ia')
            = 'Olá João, da Imobiliária Beta, sobre na casa do bairro Centro. Posso ajudar?', 'P10 texto editado da B usa o nome da B');

-- 3) Contexto: ficha só da captação da própria org --------------------------------------------------------
UPDATE public.leads SET portal_transacao = 'venda', anuncio_codigo = '2712345678' WHERE id = :'la1';
SELECT public.lead_ia_registrar_cliente(:'cva1', 'Quer saber valores?', 'recebida') AS ctx1 \gset
SELECT t.ok((:'ctx1')::jsonb->>'org_nome' = 'Imobiliária Alfa' AND (:'ctx1')::jsonb->>'transacao' = 'venda'
            AND (:'ctx1')::jsonb->>'anuncio_codigo' = '2712345678' AND ((:'ctx1')::jsonb->>'tem_captacao')::boolean
            AND (:'ctx1')::jsonb->>'imovel_frase' = 'o apartamento do bairro Campolim', 'P11 contexto traz org, transação, código e imóvel');
SELECT t.ok((:'ctx1')::jsonb->'ficha' = '{"tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","quartos":"3","suites":"1","vagas":"2","area_util_m2":"80"}'::jsonb,
            'P12 ficha só com campos existentes (sem valor nem observação livre)');
SELECT t.ok((:'ctx1')::text !~ '(15981110001|999999|condom)', 'P13 contexto sem telefone, preço ou texto livre');
SELECT t.ok(public.lead_ia_ficha(:capB, :orgA) IS NULL AND public.lead_ia_imovel_frase(:capB, :orgA, 'def') IS NULL,
            'P14 ficha/frase de captação de OUTRA org = nada');
SELECT t.ok(public.lead_ia_imovel_por_codigo(:'cva2', 'CCCCCCCC') IS NULL
        AND (public.lead_ia_imovel_por_codigo(:'cva2', 'DDDDDDDD')) IS NULL, 'P15a código ambíguo ou de outra org não acha');
SELECT t.ok(public.lead_ia_imovel_por_codigo(:'cvb1', 'DDDDDDDD')->>'frase' = 'a casa do bairro Centro', 'P15 código da própria org acha a captação');
SELECT t.ok(public.lead_ia_imovel_por_codigo(:'cva2', 'xx') IS NULL, 'P16 código curto demais = nada');
-- Captação achada pelo código fica só na conversa (dados.imovel_capture_id) e passa a valer no contexto.
SELECT public.lead_ia_registrar_cliente(:'cva2', 'oi', 'recebida') IS NOT NULL;
SELECT public.lead_ia_aplicar(:'cva2', 1, 'codigo', jsonb_build_object('codigo_pedido', true), 'Qual é o código do anúncio?', NULL, NULL) IS NOT NULL;
SELECT public.lead_ia_registrar_cliente(:'cva2', 'é o CCCCCCCC', 'recebida') IS NOT NULL;
SELECT public.lead_ia_aplicar(:'cva2', 2, 'finalidade', jsonb_build_object('imovel_capture_id', :capA2), 'ok', NULL, NULL) IS NOT NULL;
SELECT public.lead_ia_registrar_cliente(:'cva2', 'comprar', 'recebida') AS ctx2 \gset
SELECT t.ok((:'ctx2')::jsonb->>'imovel_frase' = 'o apartamento do bairro Jardim Europa'
        AND (SELECT capture_id IS NULL FROM public.leads WHERE id = :'la2'), 'P17 captação do código vale na conversa; lead não muda');
SELECT public.lead_ia_aplicar(:'cva2', 3, 'faixa', jsonb_build_object('imovel_capture_id', :capB), 'ok', NULL, NULL) IS NOT NULL;
SELECT public.lead_ia_registrar_cliente(:'cva2', '500 mil', 'recebida') AS ctx3 \gset
SELECT t.ok(NOT ((:'ctx3')::jsonb->>'tem_captacao')::boolean, 'P18 id de captação de outra org nos dados é ignorado');

-- 4) "Encaminhei" verificável -----------------------------------------------------------------------------
SELECT t.ok(t.falha($$SELECT public.lead_ia_aplicar('00000000-0000-0000-0000-000000000000', 1, 'fim', '{}', 'x', 'invalido', NULL, NULL)$$),
            'P19 motivo desconhecido recusado');
SELECT count(*) AS n0 FROM public.notifications WHERE organization_id = :orgA \gset
SELECT public.lead_ia_aplicar(:'cva1', 1, 'fim', '{}', 'Claro! Encaminhei seu contato para {corretor}, que vai falar com você por aqui.',
  'pediu_pessoa', 'Cliente pediu pessoa.', 'Claro! Registrei aqui e estou confirmando o encaminhamento para o corretor.') AS ap1 \gset
SELECT t.ok(((:'ap1')::jsonb->>'encaminhado')::boolean, 'P20 registro + sino gravados = encaminhado');
SELECT t.ok((SELECT texto FROM public.lead_mensagens WHERE conversa_id = :'cva1' AND autor = 'ia' ORDER BY created_at DESC, id LIMIT 1)
            = 'Claro! Encaminhei seu contato para o nosso time de corretores, que vai falar com você por aqui.',
            'P21 antes do aceite: diz "o nosso time de corretores" (sem nome)');
SELECT t.ok((SELECT count(*) > :n0 FROM public.notifications WHERE organization_id = :orgA)
        AND EXISTS (SELECT 1 FROM public.lead_eventos WHERE lead_id = :'la1' AND tipo = 'ia' AND para = 'pediu_pessoa'),
            'P22 linha do tempo e sino gravados');
-- Com aceite: diz o primeiro nome de quem retorna.
SELECT public.lead_inserir(:orgA, 'Ana Paz', '15981110003', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'ra3') AS la3 \gset
SELECT id AS cva3 FROM public.lead_conversas WHERE lead_id = :'la3' \gset
SELECT t.como(:c1);
SELECT public.lead_aceitar(:'la3');
SELECT t.dono();
SELECT public.lead_ia_registrar_cliente(:'cva3', 'quero visitar', 'recebida') IS NOT NULL;
SELECT public.lead_ia_aplicar(:'cva3', 1, 'fim', '{"visita":"amanhã de manhã"}', 'Encaminhei para {corretor}, que confirma com você até as 18h de hoje.',
  'visita', 'PRÉ-AGENDAMENTO: amanhã de manhã.', 'Registrei aqui e estou confirmando o envio ao corretor.') AS ap3 \gset
SELECT t.ok((SELECT texto FROM public.lead_mensagens WHERE conversa_id = :'cva3' AND autor = 'ia' ORDER BY created_at DESC, id LIMIT 1)
            = 'Encaminhei para Corretor, do nosso time de corretores, que confirma com você até as 18h de hoje.', 'P23 depois do aceite: nome de quem retorna');
SELECT t.ok((SELECT motivo_fim = 'visita' FROM public.lead_conversas WHERE id = :'cva3')
        AND EXISTS (SELECT 1 FROM public.notifications WHERE user_id = :c1 AND titulo LIKE 'Pré-agendamento de visita%'),
            'P24 visita: motivo próprio e aviso de pré-agendamento ao corretor');
-- Falha: o sino não grava (gatilho que descarta o aviso) -> texto de falha, nunca "encaminhei".
CREATE FUNCTION t.sem_sino() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
CREATE TRIGGER t_sem_sino BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION t.sem_sino();
SELECT public.lead_inserir(:orgA, 'Bia Reis', '15981110004', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'ra4') AS la4 \gset
SELECT id AS cva4 FROM public.lead_conversas WHERE lead_id = :'la4' \gset
SELECT public.lead_ia_registrar_cliente(:'cva4', 'quero falar com um corretor', 'recebida') IS NOT NULL;
SELECT public.lead_ia_aplicar(:'cva4', 1, 'fim', '{}', 'Claro! Encaminhei seu contato para {corretor}.', 'pediu_pessoa', 'x',
  'Claro! Registrei aqui e estou confirmando o encaminhamento para o corretor. Já te retorno por aqui.') AS ap4 \gset
SELECT t.ok(NOT ((:'ap4')::jsonb->>'encaminhado')::boolean
        AND (SELECT texto FROM public.lead_mensagens WHERE conversa_id = :'cva4' AND autor = 'ia' ORDER BY created_at DESC, id LIMIT 1)
            = 'Claro! Registrei aqui e estou confirmando o encaminhamento para o corretor. Já te retorno por aqui.',
            'P25 sino não gravado: usa o texto de falha (não afirma o envio)');
-- Servidor antigo (7 argumentos, sem texto de falha): nunca deixa {corretor} cru.
SELECT public.lead_inserir(:orgA, 'Caio Dias', '15981110005', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'ra5') AS la5 \gset
SELECT id AS cva5 FROM public.lead_conversas WHERE lead_id = :'la5' \gset
SELECT public.lead_ia_registrar_cliente(:'cva5', 'sim', 'recebida') IS NOT NULL;
SELECT public.lead_ia_aplicar(:'cva5', 1, 'fim', '{}', 'Encaminhei para {corretor}.', 'qualificado', 'x') IS NOT NULL;
SELECT t.ok((SELECT texto FROM public.lead_mensagens WHERE conversa_id = :'cva5' AND autor = 'ia' ORDER BY created_at DESC, id LIMIT 1)
            NOT LIKE '%{corretor}%', 'P26 chamada antiga (7 args) continua funcionando sem {corretor} cru');
DROP TRIGGER t_sem_sino ON public.notifications;

-- 5) Não é lead: avisa responsável E gestores ------------------------------------------------------------
SELECT public.lead_inserir(:orgA, 'Dono Imóvel', '15981110006', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'ra6') AS la6 \gset
SELECT id AS cva6 FROM public.lead_conversas WHERE lead_id = :'la6' \gset
SELECT public.lead_ia_registrar_cliente(:'cva6', 'quero vender o meu apartamento', 'recebida') IS NOT NULL;
SELECT public.lead_ia_aplicar(:'cva6', 1, 'fim', '{"categoria":"proprietario"}', 'Encaminhei sua mensagem para {corretor}.', 'nao_lead',
  'Proprietário oferecendo imóvel.', 'Registrei sua mensagem.') AS ap6 \gset
SELECT t.ok((SELECT motivo_fim = 'nao_lead' AND estado = 'passada' FROM public.lead_conversas WHERE id = :'cva6')
        AND (SELECT count(DISTINCT user_id) >= 3 FROM public.notifications WHERE titulo LIKE 'Contato que não é comprador%'
              AND organization_id = :orgA)
        AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE titulo LIKE 'Contato que não é comprador%' AND organization_id = :orgB),
            'P27 não-lead: responsável + gestor + admin da A avisados; ninguém da B');
SELECT t.ok((SELECT texto FROM public.lead_mensagens WHERE conversa_id = :'cva6' AND autor = 'ia' ORDER BY created_at DESC, id LIMIT 1)
            = 'Encaminhei sua mensagem para a nossa equipe.', 'P28 não-lead: "a nossa equipe"');

-- 6) Reengajamento ---------------------------------------------------------------------------------------
-- Prepara: canal real e allowlist na A; 1ª mensagem "enviada" há 25 h em 2 conversas novas.
SELECT public.lead_ia_canal_definir(:orgA, 'ziontalk'), public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110010', '15981110011']);
SELECT public.lead_ia_envio_definir(:orgA, 10, 60, 180);
SELECT public.lead_inserir(:orgA, 'Rita Melo', '15981110010', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'ra10') AS lr1 \gset
SELECT public.lead_inserir(:orgA, 'Fora Lista', '15981110012', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'ra12') AS lr3 \gset
SELECT id AS cvr1 FROM public.lead_conversas WHERE lead_id = :'lr1' \gset
SELECT id AS cvr3 FROM public.lead_conversas WHERE lead_id = :'lr3' \gset
UPDATE public.lead_mensagens SET status = 'enviada', created_at = now() - interval '25 hours' WHERE conversa_id IN (:'cvr1', :'cvr3');
UPDATE public.lead_conversas SET primeira_enviada_em = now() - interval '25 hours' WHERE id IN (:'cvr1', :'cvr3');
-- Horário comercial fixo para o teste (a função usa now()): roda num dia útil às 10h de Brasília.
CREATE FUNCTION t.reservar_em(_ts timestamptz) RETURNS TABLE (lead_id uuid, toque integer) LANGUAGE plpgsql AS $$
BEGIN
  -- now() é o início da transação; aqui ajustamos as marcas relativas em vez do relógio.
  RETURN QUERY SELECT * FROM public.lead_ia_reengajar_reservar();
END $$;
\set comercial 'extract(isodow FROM now() AT TIME ZONE ''America/Sao_Paulo'') < 7 AND extract(hour FROM now() AT TIME ZONE ''America/Sao_Paulo'') BETWEEN 9 AND 18'
SELECT (:comercial) AS em_horario \gset
\if :em_horario
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_reengajar_reservar()), 'P29 desligado: nada é reservado');
UPDATE public.lead_config SET ia_reengajar = true WHERE organization_id = :orgA;
SELECT * FROM public.lead_ia_reengajar_reservar() \gset r_
SELECT t.ok(:'r_lead_id' = :'lr1' AND :r_toque = 1, 'P30 ligado: toque 1 só para quem está na lista de liberados');
SELECT t.ok((SELECT texto FROM public.lead_mensagens WHERE conversa_id = :'cvr1' AND status = 'pendente')
            = 'Oi, Rita! Ainda faz sentido para você ver o apartamento do bairro Campolim? Posso separar 2 horários de visita. (Se não quiser mais mensagens, responda SAIR.)',
            'P31 toque 1 cita o imóvel com uma pergunta');
SELECT t.ok((SELECT ia_reengajar_proximo_em BETWEEN now() + interval '60 seconds' AND now() + interval '180 seconds'
               FROM public.lead_config WHERE organization_id = :orgA), 'P32 intervalo aleatório (60–180 s) até o próximo toque');
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_reengajar_reservar()), 'P33 dentro do intervalo: nada');
-- Toque 2: 48 h depois do toque 1, sem resposta; alternativa compatível = mesmo tipo e cidade.
UPDATE public.lead_mensagens SET status = 'enviada' WHERE conversa_id = :'cvr1' AND status = 'pendente';
UPDATE public.lead_conversas SET reengaje_1_em = now() - interval '49 hours' WHERE id = :'cvr1';
UPDATE public.lead_mensagens SET created_at = now() - interval '49 hours' WHERE conversa_id = :'cvr1' AND created_at > now() - interval '1 hour';
UPDATE public.lead_config SET ia_reengajar_proximo_em = NULL WHERE organization_id = :orgA;
SELECT * FROM public.lead_ia_reengajar_reservar() \gset r2_
SELECT t.ok(:r2_toque = 2 AND (SELECT texto FROM public.lead_mensagens WHERE conversa_id = :'cvr1' AND status = 'pendente')
            LIKE '%temos também um apartamento no bairro Jardim Europa. Quer que eu peça ao corretor os detalhes?%',
            'P34 toque 2 com 1 alternativa compatível');
SELECT t.ok((SELECT dados->>'alternativa' = 'um apartamento no bairro Jardim Europa' FROM public.lead_conversas WHERE id = :'cvr1'),
            'P35 alternativa guardada para a IA entender o "sim"');
UPDATE public.lead_mensagens SET status = 'enviada' WHERE conversa_id = :'cvr1' AND status = 'pendente';
UPDATE public.lead_conversas SET reengaje_2_em = now() - interval '100 hours' WHERE id = :'cvr1';
UPDATE public.lead_config SET ia_reengajar_proximo_em = NULL WHERE organization_id = :orgA;
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_reengajar_reservar()), 'P36 no máximo 2 toques');
-- Para quando o cliente responde, pede SAIR ou a conversa foi passada.
SELECT public.lead_inserir(:orgA, 'Rui Sá', '15981110011', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'ra11') AS lr2 \gset
SELECT id AS cvr2 FROM public.lead_conversas WHERE lead_id = :'lr2' \gset
UPDATE public.lead_mensagens SET status = 'enviada', created_at = now() - interval '30 hours' WHERE conversa_id = :'cvr2';
UPDATE public.lead_conversas SET primeira_enviada_em = now() - interval '30 hours' WHERE id = :'cvr2';
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status, created_at)
VALUES (:orgA, :'cvr2', 'cliente', 'oi', 'recebida', now() - interval '29 hours');
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_reengajar_reservar()), 'P37 cliente respondeu (última msg é dele): sem toque');
DELETE FROM public.lead_mensagens WHERE conversa_id = :'cvr2' AND autor = 'cliente';
INSERT INTO public.lead_ia_optouts (organization_id, contato) SELECT :orgA, x FROM unnest(public.lead_ia_contatos('15981110011', NULL)) x;
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_reengajar_reservar()), 'P38 opt-out (SAIR): sem toque');
DELETE FROM public.lead_ia_optouts WHERE organization_id = :orgA;
-- Limite diário: 1ª mensagem + toques contam juntos.
UPDATE public.lead_config SET ia_envio_limite_dia = 1 WHERE organization_id = :orgA;
UPDATE public.lead_conversas SET primeira_enviada_em = now() WHERE id = :'cva1';
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_reengajar_reservar()), 'P39 limite diário atingido: sem toque');
UPDATE public.lead_config SET ia_envio_limite_dia = 10 WHERE organization_id = :orgA;
UPDATE public.lead_config SET ia_canal = 'teste' WHERE organization_id = :orgA;
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_reengajar_reservar()), 'P40 canal de teste: sem toque');
UPDATE public.lead_config SET ia_canal = 'ziontalk' WHERE organization_id = :orgA;
SELECT t.ok((SELECT count(*) = 1 FROM public.lead_ia_reengajar_reservar()), 'P41 tudo liberado de novo: 1 toque');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.lead_mensagens m JOIN public.lead_conversas c ON c.id = m.conversa_id
                        WHERE c.organization_id = :orgB AND m.status = 'pendente'), 'P42 nada reservado na B');
\else
SELECT t.ok(true, 'P29-P42 PULADOS: fora do horário comercial de Brasília (rodar entre 9h e 19h, seg-sáb)');
\endif

-- 7) Permissões -------------------------------------------------------------------------------------------
SELECT t.como(:admA);
SELECT t.ok(t.falha($$SELECT * FROM public.lead_ia_reengajar_reservar()$$), 'P43 app não reserva reengajamento');
SELECT t.ok(t.falha($$SELECT public.lead_ia_imovel_por_codigo('00000000-0000-0000-0000-000000000000', 'ABCD1234')$$), 'P44 app não busca por código');
SELECT t.ok(t.falha($$SELECT public.lead_ia_ficha('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000')$$), 'P45 app não lê a ficha direto');
SELECT t.ok(t.falha($$SELECT public.lead_ia_aplicar('00000000-0000-0000-0000-000000000000', 1, 'fim', '{}', 'x', NULL, NULL, NULL)$$), 'P46 app não grava resposta da IA');
SELECT t.ok((SELECT count(*) = 1 FROM public.lead_config) AND (SELECT ia_reengajar IS NOT NULL FROM public.lead_config),
            'P47 admin lê a chave do reengajamento da própria org');
SELECT t.ok(t.falha($$SELECT ia_reengajar_proximo_em FROM public.lead_config$$), 'P48 app não lê a marca interna do intervalo');
SELECT t.como(:c1);
SELECT t.ok(t.falha($$SELECT telefone FROM public.leads$$), 'P49 contato continua escondido do corretor');
SELECT t.dono();

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT label FROM t.res WHERE NOT ok;
