-- Testes da IA de atendimento (t_8046ecb0) em PostgreSQL descartável: 2 imobiliárias (A e B).
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
-- Espera erro: devolve true se a chamada falhou.
CREATE FUNCTION t.falha(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

-- Atalhos de ids
\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set gesA '''a0000000-0000-0000-0000-00000000000e'''
\set c1 '''a0000000-0000-0000-0000-0000000000c1'''
\set c2 '''a0000000-0000-0000-0000-0000000000c2'''
\set admB '''b0000000-0000-0000-0000-00000000000a'''
\set cB '''b0000000-0000-0000-0000-0000000000cb'''

-- Preparação (servidor): módulo ligado nas duas, config padrão, uma captação na A (captador c1).
UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
INSERT INTO public.exclusive_captures (id, organization_id, captor_id, form_data)
VALUES ('cccccccc-0000-0000-0000-000000000001', :orgA, :c1,
        '{"imovel":{"tipo_imovel":"Apartamento","bairro":"Campolim","valor":"999999"}}');

SELECT t.ok((SELECT NOT ia_ativa AND ia_canal = 'teste' FROM public.lead_config WHERE organization_id = :orgA),
            '01 IA nasce desligada e em modo teste');

-- 1) IA desligada não dispara ------------------------------------------------------------------
SELECT t.como(:gesA);
SELECT public.lead_criar('Sem IA', '15999990001', NULL, 'manual') AS lead_sem_ia \gset
SELECT t.dono();
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas WHERE lead_id = :'lead_sem_ia'), '02 IA desligada: nenhuma conversa');

-- Config: só administrador
SELECT t.como(:gesA);
SELECT t.ok(t.falha($$SELECT public.lead_ia_config_salvar(true, 'Lais', 'x')$$), '03 gestor não altera config da IA');
SELECT t.como(:admA);
SELECT t.ok(t.falha($$SELECT public.lead_ia_config_salvar(true, '', 'x')$$), '04 nome vazio recusado');
SELECT public.lead_ia_config_salvar(true, 'Lais', 'Recebi seu contato pelo anúncio.');
SELECT t.dono();

-- 2) Lead com imóvel: 1ª mensagem ----------------------------------------------------------------
SELECT t.como(:gesA);
SELECT public.lead_criar('Maria Souza', '15999990002', 'maria@exemplo.invalid', 'olx', NULL,
                         'cccccccc-0000-0000-0000-000000000001') AS lead1 \gset
SELECT t.dono();
SELECT id AS conv1 FROM public.lead_conversas WHERE lead_id = :'lead1' \gset
SELECT texto AS msg1 FROM public.lead_mensagens WHERE conversa_id = :'conv1' \gset
SELECT t.ok((SELECT count(*) = 1 FROM public.lead_mensagens WHERE conversa_id = :'conv1' AND autor = 'ia' AND status = 'nao_enviada'),
            '05 1ª mensagem gravada como NÃO ENVIADA (modo teste)');
SELECT t.ok(:'msg1' LIKE 'Olá, Maria! Aqui é Lais, da Org A.%' AND :'msg1' LIKE '%apartamento no bairro Campolim%'
            AND :'msg1' LIKE '%ainda tem interesse%' AND :'msg1' LIKE '%SAIR%' AND :'msg1' NOT LIKE '%999999%',
            '06 1ª mensagem: nome da IA, imobiliária, imóvel cadastrado, confirma interesse, SAIR, sem preço');
SELECT t.ok((SELECT count(*) = 1 FROM public.lead_eventos WHERE lead_id = :'lead1' AND tipo = 'ia' AND para = 'iniciada'),
            '07 linha do tempo registra a IA');

-- 3) Deduplicação ---------------------------------------------------------------------------------
SELECT t.ok(t.falha(format($$INSERT INTO public.lead_conversas (organization_id, lead_id, canal) VALUES (%L, %L, 'teste')$$,
            'aaaaaaaa-0000-0000-0000-000000000000', :'lead1')), '08 1 lead = 1 conversa (UNIQUE)');

-- 4) Visibilidade: corretor só depois do aceite ------------------------------------------------------
SELECT t.como(:c1);
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas) AND (SELECT count(*) = 0 FROM public.lead_mensagens),
            '09 corretor NÃO vê a conversa antes do aceite');
SELECT public.lead_aceitar(:'lead1');
SELECT t.ok((SELECT count(*) = 1 FROM public.lead_conversas) AND (SELECT count(*) = 1 FROM public.lead_mensagens),
            '10 corretor vê a conversa depois do aceite');
SELECT t.ok(t.falha(format($$SELECT public.lead_ia_cliente_simular(%L, 'oi')$$, :'lead1')), '11 corretor não usa o simulador de cliente');
SELECT t.ok(t.falha($$SELECT telefone FROM public.leads$$), '12 contato escondido continua (sem SELECT em telefone)');
SELECT t.como(:c2);
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas), '13 outro corretor não vê a conversa');
SELECT t.como(:gesA);
SELECT t.ok((SELECT count(*) >= 1 FROM public.lead_conversas), '14 gestor vê as conversas');

-- 5) Conversa (cliente simulado + resposta da IA pelo servidor) e idempotência ------------------------
SELECT public.lead_ia_cliente_simular(:'lead1', 'Sim, tenho interesse') AS ctx \gset
SELECT t.dono();
SELECT t.ok((:'ctx')::jsonb->>'versao' = '1' AND (:'ctx')::jsonb->>'imovel' = 'apartamento no bairro Campolim',
            '15 contexto devolvido para a IA (versão 1, imóvel cadastrado)');
SELECT t.ok((SELECT status = 'simulada' FROM public.lead_mensagens WHERE conversa_id = :'conv1' AND autor = 'cliente'),
            '16 mensagem do cliente gravada como simulada');
SELECT t.ok(((public.lead_ia_aplicar(:'conv1', 1, 'finalidade', '{"interesse":true}', 'Ótimo! Você quer comprar ou alugar?', NULL, NULL))->>'ok')::boolean,
            '17 servidor grava a resposta da IA');
SELECT t.ok(((public.lead_ia_aplicar(:'conv1', 1, 'finalidade', '{"interesse":true}', 'repetida', NULL, NULL))->>'motivo') = 'desatualizado',
            '18 mesma versão não responde 2 vezes (idempotente)');
SELECT t.ok((SELECT count(*) = 2 FROM public.lead_mensagens WHERE conversa_id = :'conv1' AND autor = 'ia'), '19 só 2 mensagens da IA');
SELECT t.ok((SELECT ultima_interacao_em IS NOT NULL FROM public.leads WHERE id = :'lead1'), '20 conversa conta como interação (7/30 d)');
SELECT t.como(:gesA);
SELECT t.ok(t.falha(format($$SELECT public.lead_ia_aplicar(%L, 2, 'fim', '{}', 'x', NULL, NULL)$$, :'conv1')),
            '21 app (authenticated) não grava resposta da IA');
SELECT t.ok(t.falha(format($$SELECT public.lead_ia_canal_definir(%L, 'ziontalk')$$, 'aaaaaaaa-0000-0000-0000-000000000000')),
            '22 app não liga o canal real');

-- 6) Passagem ao corretor (qualificado) ---------------------------------------------------------------
SELECT public.lead_ia_cliente_simular(:'lead1', 'Comprar') AS ctx2 \gset
SELECT t.dono();
UPDATE public.lead_eventos SET created_at = created_at; -- no-op
SELECT public.lead_ia_aplicar(:'conv1', 2, 'fim', '{"finalidade":"comprar"}', 'Perfeito! O corretor vai te chamar.',
  'qualificado', 'Quer comprar; prazo 3 meses; financiamento; até R$ 500 mil; região Campolim; prefere visita.');
SELECT t.ok((SELECT estado = 'passada' AND motivo_fim = 'qualificado' FROM public.lead_conversas WHERE id = :'conv1'),
            '23 qualificação terminada: IA para (passada)');
SELECT t.ok((SELECT count(*) = 1 FROM public.notifications WHERE user_id = :c1 AND titulo = 'IA qualificou um lead seu'
               AND mensagem LIKE '%Quer comprar%' AND mensagem NOT LIKE '%15999990002%' AND mensagem NOT LIKE '%maria@%'),
            '24 corretor recebe resumo no sino, sem telefone/e-mail');
SELECT t.como(:gesA);
SELECT public.lead_ia_cliente_simular(:'lead1', 'Oi, ainda está aí?') AS ctx3 \gset
SELECT t.dono();
SELECT t.ok((:'ctx3')::jsonb->>'estado' = 'passada', '25 depois da passagem a IA não responde mais');
SELECT t.ok(((public.lead_ia_aplicar(:'conv1', 3, 'fim', '{}', 'x', NULL, NULL))->>'ok')::boolean = false,
            '26 servidor recusa resposta em conversa encerrada');

-- 7) Assunto sensível -> corretor E gestores ----------------------------------------------------------
SELECT t.como(:gesA);
SELECT public.lead_criar('Jose Reclama', '15999990003', NULL, 'site', NULL, NULL, :c2) AS lead2 \gset
SELECT public.lead_ia_cliente_simular(:'lead2', 'Quero falar com um advogado, vou processar') AS ctx4 \gset
SELECT t.dono();
SELECT id AS conv2 FROM public.lead_conversas WHERE lead_id = :'lead2' \gset
SELECT public.lead_ia_aplicar(:'conv2', 1, 'fim', '{}', 'Entendi. Vou passar agora para o responsável.', 'sensivel',
  'Assunto sensível (jurídico): cliente fala em processo. Atender com cuidado.');
SELECT t.ok((SELECT count(*) FROM public.notifications WHERE titulo = 'Atenção: assunto sensível em um lead'
               AND user_id IN (:c2, :admA, :gesA)) = 3, '27 sensível: responsável + gestor + admin no sino');

-- 8) Opt-out ------------------------------------------------------------------------------------------
SELECT t.ok(public.lead_ia_e_optout('SAIR') AND public.lead_ia_e_optout('sair.') AND public.lead_ia_e_optout('Não quero mais receber mensagens')
            AND public.lead_ia_e_optout('pare de me mandar isso') AND NOT public.lead_ia_e_optout('quero sair do aluguel')
            AND NOT public.lead_ia_e_optout('Sim'), '28 reconhece SAIR e equivalentes, sem falso positivo');
SELECT t.como(:gesA);
SELECT public.lead_criar('Ana Optout', '15999990004', 'ana@exemplo.invalid', 'meta') AS lead3 \gset
SELECT public.lead_ia_cliente_simular(:'lead3', 'SAIR') AS ctx5 \gset
SELECT t.dono();
SELECT t.ok((:'ctx5')::jsonb->>'estado' = 'optout'
            AND (SELECT estado = 'optout' FROM public.lead_conversas WHERE lead_id = :'lead3')
            AND (SELECT count(*) = 2 FROM public.lead_ia_optouts WHERE organization_id = :orgA), '29 SAIR: conversa para e contato entra na lista');
SELECT t.como(:gesA);
SELECT public.lead_criar('Ana De Novo', '15999990004', NULL, 'olx') AS lead4 \gset
SELECT t.dono();
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas WHERE lead_id = :'lead4')
            AND (SELECT count(*) = 1 FROM public.lead_eventos WHERE lead_id = :'lead4' AND tipo = 'ia' AND para = 'optout'),
            '30 mesmo contato volta como lead novo: IA não inicia');

-- 9) Isolamento entre imobiliárias ------------------------------------------------------------------
SELECT t.como(:admB);
SELECT public.lead_criar('Lead B sem IA', '15999990004', NULL, 'manual') AS leadb0 \gset
SELECT t.dono();
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas WHERE lead_id = :'leadb0'), '31 org B com IA desligada não dispara');
SELECT t.como(:admB);
SELECT public.lead_ia_config_salvar(true, 'Bia', NULL);
SELECT public.lead_criar('Lead B', '15999990004', NULL, 'manual') AS leadb \gset
SELECT t.ok((SELECT count(*) = 1 FROM public.lead_conversas) , '32 org B: opt-out da org A não vale na B; B vê só a sua conversa');
SELECT t.dono();
SELECT t.ok((SELECT texto LIKE '%Aqui é Bia, da Org B.%Recebi seu contato. Você%' FROM public.lead_mensagens m
               JOIN public.lead_conversas c ON c.id = m.conversa_id WHERE c.lead_id = :'leadb'),
            '33 org B usa o próprio nome/texto padrão');
SELECT t.como(:gesA);
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas WHERE organization_id = :orgB)
            AND (SELECT count(*) = 0 FROM public.lead_mensagens WHERE organization_id = :orgB), '34 gestor A não vê conversas da B');
SELECT t.ok(t.falha(format($$SELECT public.lead_ia_cliente_simular(%L, 'oi')$$, :'leadb')), '35 gestor A não fala no lead da B');
SELECT t.como(:cB);
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas WHERE organization_id = :orgA), '36 corretor B não vê nada da A');

-- 10) Parar a IA manualmente / canal real bloqueia simulador / módulo desligado ----------------------
SELECT t.como(:c1);
SELECT t.ok(t.falha(format($$SELECT public.lead_ia_parar(%L)$$, :'lead2')), '37 corretor sem o lead não para a IA');
SELECT t.como(:gesA);
SELECT public.lead_criar('Pedro Parar', '15999990005', NULL, 'manual') AS lead5 \gset
SELECT t.ok(public.lead_ia_parar(:'lead5') = 'parada', '38 gestor para a IA');
SELECT t.dono();
SELECT public.lead_ia_canal_definir(:orgA, 'ziontalk'), public.lead_ia_allowlist_definir(:orgA, ARRAY['15999990006']);
SELECT t.como(:gesA);
SELECT public.lead_criar('Canal Real', '15999990006', NULL, 'manual') AS lead6 \gset
SELECT t.dono();
SELECT t.ok((SELECT m.status = 'pendente' FROM public.lead_mensagens m JOIN public.lead_conversas c ON c.id = m.conversa_id
               WHERE c.lead_id = :'lead6'), '39 canal ziontalk: mensagem fica PENDENTE (nada é enviado pelo banco)');
SELECT t.como(:gesA);
SELECT t.ok(t.falha(format($$SELECT public.lead_ia_cliente_simular(%L, 'oi')$$, :'lead6')), '40 simulador recusado fora do modo teste');
SELECT t.dono();
SELECT public.lead_ia_canal_definir(:orgA, 'teste');
UPDATE public.lead_config SET ia_ativa = true WHERE organization_id = :orgA;
UPDATE public.organization_modules SET enabled = false WHERE organization_id = :orgA AND module = 'leads';
SELECT public.lead_inserir(:orgA, 'Modulo Off', '15999990007', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'x1') AS lead7 \gset
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas WHERE lead_id = :'lead7'), '41 módulo leads desligado: IA não dispara');
SELECT t.ok(((public.lead_ia_aplicar(:'conv2', 9, 'fim', '{}', 'x', NULL, NULL))->>'ok')::boolean = false, '42 aplicar recusa com conversa encerrada/IA off');
UPDATE public.organization_modules SET enabled = true WHERE organization_id = :orgA AND module = 'leads';

-- 11) Falha na IA nunca impede o lead de entrar --------------------------------------------------------
UPDATE public.lead_config SET ia_nome = 'Lais' WHERE organization_id = :orgA;
ALTER TABLE public.lead_mensagens ADD CONSTRAINT t_quebra CHECK (false) NOT VALID;
SELECT public.lead_inserir(:orgA, 'Entra Mesmo Assim', '15999990008', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'x2') AS lead8 \gset
SELECT t.ok((SELECT count(*) = 1 FROM public.leads WHERE id = :'lead8') AND (SELECT count(*) = 0 FROM public.lead_conversas WHERE lead_id = :'lead8'),
            '43 erro na IA não bloqueia a entrada do lead');
ALTER TABLE public.lead_mensagens DROP CONSTRAINT t_quebra;

-- 12) Correções da revisão (contexto limpo) ------------------------------------------------------------
-- 12a) Sino antes do aceite: sem resumo; linha do tempo sem resumo; telefone/e-mail mascarados.
SELECT t.como(:gesA);
SELECT public.lead_criar('Rita Antes', '15999990010', NULL, 'site', NULL, NULL, :c2) AS lead10 \gset
SELECT public.lead_ia_cliente_simular(:'lead10', 'sim') AS ctx10 \gset
SELECT t.dono();
SELECT id AS conv10 FROM public.lead_conversas WHERE lead_id = :'lead10' \gset
SELECT public.lead_ia_aplicar(:'conv10', 1, 'fim', '{}', 'ok', 'pediu_pessoa', 'Ligue 11 99999-8888 ou rita@x.com; quer comprar');
SELECT t.ok((SELECT mensagem NOT LIKE '%quer comprar%' AND mensagem LIKE '%aceite o lead%' FROM public.notifications
              WHERE user_id = :c2 AND titulo = 'Cliente pediu para falar com o corretor'),
            '44 antes do aceite o sino NÃO traz o resumo');
SELECT t.ok((SELECT nota IS NULL FROM public.lead_eventos WHERE lead_id = :'lead10' AND tipo = 'ia' AND para = 'pediu_pessoa'),
            '45 linha do tempo sem resumo (só o motivo)');
SELECT t.ok((SELECT resumo NOT LIKE '%99999%' AND resumo NOT LIKE '%rita@%' AND resumo LIKE '%[número]%[e-mail]%'
               FROM public.lead_conversas WHERE id = :'conv10'), '46 resumo com telefone/e-mail mascarados');
-- 12b) SAIR para a IA em TODOS os leads abertos do mesmo contato, com telefone em formatos diferentes.
SELECT t.como(:gesA);
SELECT public.lead_criar('Duplo Um', '+5515999990020', NULL, 'olx') AS lead20 \gset
SELECT public.lead_criar('Duplo Dois', '15999990020', NULL, 'meta') AS lead21 \gset
SELECT public.lead_ia_cliente_simular(:'lead20', 'quero sair') AS ctx20 \gset
SELECT t.dono();
SELECT t.ok((SELECT estado = 'optout' FROM public.lead_conversas WHERE lead_id = :'lead21'), '47 SAIR para a IA no outro lead do mesmo contato');
SELECT t.como(:gesA);
SELECT public.lead_criar('Duplo Tres', '5515999990020', NULL, 'site') AS lead22 \gset
SELECT t.dono();
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas WHERE lead_id = :'lead22'), '48 opt-out vale com +55 / 55 / sem 55');
-- 12c) Lead encerrado: servidor não responde e a IA para.
SELECT t.como(:gesA);
SELECT public.lead_criar('Fecha Logo', '15999990030', NULL, 'site') AS lead30 \gset
SELECT public.lead_ia_cliente_simular(:'lead30', 'sim') AS ctx30 \gset
SELECT public.lead_mudar_etapa(:'lead30', 'perdido', (SELECT id FROM public.lead_motivos_perda WHERE nome = 'Desistiu'));
SELECT t.dono();
SELECT (public.lead_ia_aplicar((SELECT id FROM public.lead_conversas WHERE lead_id = :'lead30'), 1, 'finalidade', '{}', 'x', NULL, NULL))->>'motivo' AS m30 \gset
SELECT t.ok(:'m30' = 'lead_encerrado'
            AND (SELECT estado <> 'ativa' FROM public.lead_conversas WHERE lead_id = :'lead30'), '49 lead perdido: IA não responde e para');
-- 12d) Canal real: lead simulado fica em teste; voltar a "teste" zera a fila pendente.
SELECT public.lead_ia_canal_definir(:orgA, 'ziontalk');
SELECT public.lead_inserir(:orgA, 'Simulado Real', '15999990040', NULL, 'olx', NULL, NULL, NULL, true, NULL, 'x40') AS lead40 \gset
SELECT t.ok((SELECT c.canal = 'teste' AND m.status = 'nao_enviada' FROM public.lead_conversas c JOIN public.lead_mensagens m ON m.conversa_id = c.id
              WHERE c.lead_id = :'lead40'), '50 lead simulado nunca entra no canal real');
SELECT public.lead_inserir(:orgA, 'Fora Da Lista', '15999990042', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'x42') AS lead42 \gset
SELECT t.ok((SELECT c.canal = 'teste' AND m.status = 'nao_enviada' FROM public.lead_conversas c JOIN public.lead_mensagens m ON m.conversa_id = c.id
              WHERE c.lead_id = :'lead42'), '50b canal real SEM allowlist: contato fica em teste (nada sai)');
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['+55 (15) 99999-0041']);
SELECT public.lead_inserir(:orgA, 'Real Pendente', '15999990041', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'x41') AS lead41 \gset
SELECT t.ok((SELECT m.status = 'pendente' FROM public.lead_conversas c JOIN public.lead_mensagens m ON m.conversa_id = c.id WHERE c.lead_id = :'lead41'),
            '51 lead real no canal ziontalk fica pendente');
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_envio_reservar(:'lead42')), '51b reservar: contato fora da lista não sai');
SELECT t.ok((SELECT count(*) = 1 AND bool_and(primeira) FROM public.lead_ia_envio_reservar(:'lead41')), '51c reservar: 1 mensagem do contato liberado');
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_envio_reservar(:'lead41')), '51d reservar de novo: não duplica (enviando)');
SELECT public.lead_ia_envio_resultado((SELECT m.id FROM public.lead_mensagens m JOIN public.lead_conversas c ON c.id = m.conversa_id
                                        WHERE c.lead_id = :'lead41' AND m.status = 'enviando'), true);
SELECT t.ok((SELECT primeira_enviada_em IS NOT NULL FROM public.lead_conversas WHERE lead_id = :'lead41'), '51e enviada marca a 1ª do dia');
UPDATE public.lead_config SET ia_envio_limite_dia = 1 WHERE organization_id = :orgA;
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15999990041', '15999990043']);
SELECT public.lead_inserir(:orgA, 'Segundo Hoje', '15999990043', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'x43') AS lead43 \gset
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_envio_reservar(:'lead43')), '51f limite de 1ª mensagem por dia segura o envio');
UPDATE public.lead_config SET ia_envio_limite_dia = 10 WHERE organization_id = :orgA;
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.lead_ia_envio_reservar(uuid)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.lead_ia_allowlist_definir(uuid, text[])', 'EXECUTE'),
            '51g app não reserva envio nem mexe na lista');
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas c, LATERAL public.lead_ia_envio_reservar(c.lead_id) r WHERE c.organization_id = :orgB),
            '51h outra imobiliária: nada a enviar');
SELECT public.lead_ia_canal_definir(:orgA, 'teste');
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_mensagens WHERE organization_id = :orgA AND status = 'pendente')
            AND (SELECT count(*) = 0 FROM public.lead_conversas WHERE organization_id = :orgA AND canal <> 'teste'),
            '52 voltar para teste: nenhuma conversa/mensagem fica no canal real');

-- 13) Travas do envio futuro (QR Code): padrões baixos, sem link, só service_role ajusta.
SELECT t.ok((SELECT ia_envio_limite_dia = 10 AND ia_envio_intervalo_min_s = 60 AND ia_envio_intervalo_max_s = 180
               FROM public.lead_config WHERE organization_id = :orgA), '53 padrões: 10/dia, 60-180 s');
DO $t$ BEGIN
  UPDATE public.lead_config SET ia_boas_vindas = 'veja www.imob.com.br' WHERE organization_id = (SELECT organization_id FROM public.lead_config LIMIT 1);
  INSERT INTO t.res (label, ok) VALUES ('54 boas-vindas com link é recusado', false);
EXCEPTION WHEN check_violation THEN INSERT INTO t.res (label, ok) VALUES ('54 boas-vindas com link é recusado', true);
END $t$;
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.lead_ia_envio_definir(uuid, integer, integer, integer)', 'EXECUTE'),
            '55 travas de envio: app não altera');

SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail FROM t.res;
SELECT label FROM t.res WHERE NOT ok;
