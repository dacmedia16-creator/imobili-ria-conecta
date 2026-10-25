-- Testes do retorno ZionTalk -> ADM + modelo (t_6f688b4b) em PostgreSQL descartável: 2 imobiliárias (A e B).
-- Uso: bash scripts/leads-ia-test/setup.sh t6f68 && docker exec -i pgt-3284-db psql -U postgres -d t6f68 -q < scripts/leads-ia-test/test_retorno.sql
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
-- Mensagem normalizada (como o adaptador manda ao banco).
CREATE FUNCTION t.m(_id text, _tel text, _txt text, _extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', _id, 'telefone', _tel, 'texto', _txt, 'tipo', 'texto',
                            'grupo', false, 'status', false, 'proprio', false) || _extra
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set gesA '''a0000000-0000-0000-0000-00000000000e'''
\set c1 '''a0000000-0000-0000-0000-0000000000c1'''
\set admB '''b0000000-0000-0000-0000-00000000000a'''

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);

SELECT t.ok((SELECT ia_retorno_token_hash IS NULL AND ia_modelo_provedor = 'gemini' AND ia_modelo IS NULL
               FROM public.lead_config WHERE organization_id = :orgA), 'R01 nasce sem token de retorno e com Gemini');

-- Token: só admin gera; devolve em claro uma vez; banco guarda só o hash.
SELECT t.como(:gesA);
SELECT t.ok(t.falha($$SELECT public.lead_ia_retorno_token('gerar')$$), 'R02 gestor não gera token do retorno');
SELECT t.como(:admA);
SELECT public.lead_ia_retorno_token('gerar') AS toka \gset
SELECT t.ok(:'toka' ~ '^[A-Za-z0-9_-]{43}$', 'R03 admin gera token (43 caracteres)');
SELECT t.ok(t.falha($$SELECT ia_retorno_token_hash FROM public.lead_config$$), 'R04 app não lê o hash do token');
SELECT t.ok((SELECT ia_retorno_token_em IS NOT NULL FROM public.lead_config), 'R05 tela vê que o retorno está ligado');
SELECT t.como(:admB);
SELECT public.lead_ia_retorno_token('gerar') AS tokb \gset
SELECT t.dono();
SELECT t.ok((SELECT ia_retorno_token_hash = encode(extensions.digest(:'toka', 'sha256'), 'hex')
               AND position(:'toka' in ia_retorno_token_hash) = 0 FROM public.lead_config WHERE organization_id = :orgA),
            'R06 banco guarda só o SHA-256');

-- IA ligada nas duas, canal real só pela plataforma, lista de liberados = número de teste.
UPDATE public.lead_config SET ia_ativa = true, ia_nome = 'Emanuella' WHERE organization_id IN (:orgA, :orgB);
SELECT public.lead_ia_canal_definir(:orgA, 'ziontalk'), public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110001']);
SELECT public.lead_ia_canal_numero_definir(:orgA, '+55 15 98111-1149');
-- Lead real do número liberado (1ª mensagem fica "pendente"), lead real de outro número, lead simulado.
SELECT public.lead_inserir(:orgA, 'Denis Teste', '+55 (15) 98111-0001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'r1') AS l1 \gset
SELECT public.lead_inserir(:orgA, 'Fora Lista', '15981110002', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'r2') AS l2 \gset
SELECT id AS cv1 FROM public.lead_conversas WHERE lead_id = :'l1' \gset
SELECT t.ok((SELECT canal = 'ziontalk' FROM public.lead_conversas WHERE id = :'cv1'), 'R07 conversa do liberado no canal real');
SELECT count(*) AS ev0 FROM public.lead_ia_retorno_eventos \gset
SELECT count(*) AS msg0 FROM public.lead_mensagens \gset

-- Token inválido / IA desligada / canal teste: recusa SEM gravar.
SELECT t.ok(public.lead_ia_retorno_receber('x', t.m('a1', '15981110001', 'oi'))->>'r' = 'token', 'R08 token mal formado = token');
SELECT t.ok(public.lead_ia_retorno_receber(repeat('Z', 43), t.m('a1', '15981110001', 'oi'))->>'r' = 'token', 'R09 token errado = token');
UPDATE public.lead_config SET ia_ativa = false WHERE organization_id = :orgA;
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('a1', '15981110001', 'oi'))->>'r' = 'desligada', 'R10 IA desligada = recusa');
UPDATE public.lead_config SET ia_ativa = true WHERE organization_id = :orgA;
SELECT t.ok(public.lead_ia_retorno_receber(:'tokb', t.m('a1', '15981110001', 'oi'))->>'r' = 'desligada',
            'R11 imobiliária B em modo teste = recusa');
UPDATE public.organization_modules SET enabled = false WHERE module = 'leads' AND organization_id = :orgA;
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('a1', '15981110001', 'oi'))->>'r' = 'desligada', 'R12 módulo desligado = recusa');
UPDATE public.organization_modules SET enabled = true WHERE module = 'leads' AND organization_id = :orgA;
SELECT t.ok((SELECT count(*) FROM public.lead_ia_retorno_eventos) = :ev0 AND (SELECT count(*) FROM public.lead_mensagens) = :msg0,
            'R13 recusas não gravaram nada');

-- Grupo, status, próprio número, mensagem do próprio canal, vazia: ignoradas, sem gravar.
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('g1', '15981110001', 'oi', '{"grupo":true}'))->>'r' = 'ignorado', 'R14 grupo ignorado');
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('s1', '15981110001', 'oi', '{"status":true}'))->>'r' = 'ignorado', 'R15 status ignorado');
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('p1', '15981110001', 'oi', '{"proprio":true}'))->>'r' = 'ignorado', 'R16 mensagem própria ignorada');
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('p2', '5515981111149', 'oi'))->>'r' = 'ignorado', 'R17 número do próprio canal ignorado');
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('v1', '15981110001', '   '))->>'r' = 'ignorado', 'R18 texto vazio ignorado');
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('', '15981110001', 'oi'))->>'r' = 'invalido', 'R19 sem id = inválido');
SELECT t.ok((SELECT count(*) FROM public.lead_ia_retorno_eventos) = :ev0 AND (SELECT count(*) FROM public.lead_mensagens) = :msg0,
            'R20 ignorados não gravaram nada');

-- Fora da lista de liberados: registro mínimo, sem mensagem.
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('f1', '15981110002', 'tenho interesse'))->>'r' = 'fora_lista', 'R21 fora da lista');
SELECT t.ok((SELECT count(*) FROM public.lead_mensagens) = :msg0, 'R22 fora da lista: nenhuma mensagem gravada');
-- Número desconhecido (liberado mas sem lead): registro mínimo, não cria lead.
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110001', '15981110009']);
SELECT count(*) AS leads0 FROM public.leads \gset
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('d1', '15981110009', 'oi'))->>'r' = 'desconhecido', 'R23 número desconhecido');
SELECT t.ok((SELECT count(*) FROM public.leads) = :leads0 AND (SELECT count(*) FROM public.lead_mensagens) = :msg0,
            'R24 desconhecido: não cria lead nem mensagem');
-- Registro mínimo: só hash e resultado (nenhuma coluna de telefone/texto).
SELECT t.ok((SELECT bool_and(externo_hash ~ '^[0-9a-f]{64}$') FROM public.lead_ia_retorno_eventos)
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_ia_retorno_eventos'
                             AND column_name ~ '(tel|texto|fone|msg|conteudo)'),
            'R25 eventos guardam só hash + resultado (sem telefone/texto)');

-- Mensagem do lead liberado: grava como "recebida", devolve contexto para responder.
SELECT public.lead_ia_retorno_receber(:'toka', t.m('ok1', '5515981110001', 'Sim, tenho interesse')) AS r1 \gset
SELECT t.ok((:'r1')::jsonb->>'r' = 'ok' AND ((:'r1')::jsonb->>'responder')::boolean
            AND (:'r1')::jsonb->'ctx'->>'versao' = '1' AND (:'r1')::jsonb->>'ia_modelo_provedor' = 'gemini',
            'R26 mensagem do lead: ok + contexto + modelo');
SELECT t.ok((SELECT status = 'recebida' FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND autor = 'cliente'),
            'R27 mensagem do cliente gravada como recebida');
SELECT t.ok(((:'r1')::jsonb->>'organization_id') = 'aaaaaaaa-0000-0000-0000-000000000000', 'R28 contexto da imobiliária dona do token');
-- Reenvio do mesmo id: duplicado, nada novo.
SELECT count(*) AS msg1 FROM public.lead_mensagens WHERE conversa_id = :'cv1' \gset
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('ok1', '5515981110001', 'Sim, tenho interesse'))->>'r' = 'duplicado',
            'R29 reenvio = duplicado');
SELECT t.ok((SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv1') = :msg1, 'R30 reenvio não grava de novo');
-- Resposta da IA (servidor) e reenvio depois da resposta: continua 1 resposta.
SELECT t.ok((public.lead_ia_aplicar(:'cv1', 1, 'finalidade', '{"interesse":true}', 'Você procura para comprar ou para alugar?', NULL, NULL)->>'ok')::boolean,
            'R31 IA responde (status pendente no canal real)');
SELECT t.ok((SELECT status = 'pendente' FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND autor = 'ia' ORDER BY created_at DESC LIMIT 1),
            'R32 resposta fica pendente para o envio');
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('ok1', '5515981110001', 'Sim, tenho interesse'))->>'r' = 'duplicado'
            AND (SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND autor = 'ia') = 2,
            'R33 reenvio depois da resposta: sem resposta dupla');
-- Mesmo id na imobiliária B não colide (dedup por imobiliária) — B recusa por estar em teste, sem gravar.
SELECT t.ok((SELECT count(*) FROM public.lead_ia_retorno_eventos WHERE organization_id = :orgB) = 0, 'R34 nada gravado na B');

-- Limite por minuto: 2 respostas na conversa no último minuto segura a próxima resposta.
SELECT public.lead_ia_retorno_receber(:'toka', t.m('ok2', '15981110001', 'comprar')) AS r2 \gset
SELECT t.ok(((:'r2')::jsonb->>'responder')::boolean, 'R35 2ª mensagem ainda responde (1 resposta no minuto + a 1ª msg)')
  WHERE (SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND autor IN ('ia','sistema') AND created_at > now() - interval '1 minute') < 2;
SELECT t.ok(true, 'R35 (2 respostas já no minuto: limite segura, conferido em R36)')
  WHERE (SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND autor IN ('ia','sistema') AND created_at > now() - interval '1 minute') >= 2;
SELECT public.lead_ia_retorno_receber(:'toka', t.m('ok3', '15981110001', 'em 3 meses')) AS r3 \gset
SELECT t.ok((:'r3')::jsonb->>'r' = 'ok' AND NOT ((:'r3')::jsonb->>'responder')::boolean AND ((:'r3')::jsonb->>'limite')::boolean,
            'R36 limite por minuto: grava a mensagem mas não responde');
SELECT t.ok((SELECT resultado = 'limite_minuto' FROM public.lead_ia_retorno_eventos ORDER BY id DESC LIMIT 1), 'R37 evento marcado limite_minuto');
-- Envelhece as mensagens (como se tivesse passado 1 min).
UPDATE public.lead_mensagens SET created_at = created_at - interval '2 minutes' WHERE organization_id = :orgA;

-- Limite total por conversa: passa ao corretor.
UPDATE public.lead_config SET ia_resp_max_conversa = 2 WHERE organization_id = :orgA;
SELECT public.lead_ia_retorno_receber(:'toka', t.m('ok4', '15981110001', 'financiamento')) AS r4 \gset
SELECT t.ok(NOT ((:'r4')::jsonb->>'responder')::boolean
            AND (SELECT estado = 'passada' AND motivo_fim = 'limite' FROM public.lead_conversas WHERE id = :'cv1'),
            'R38 limite por conversa: IA para e passa ao corretor');
UPDATE public.lead_config SET ia_resp_max_conversa = 20 WHERE organization_id = :orgA;

-- SAIR pelo WhatsApp (outro lead do mesmo número): para, grava opt-out, mensagem de saída pendente.
UPDATE public.lead_mensagens SET created_at = created_at - interval '2 minutes' WHERE organization_id = :orgA;
SELECT public.lead_inserir(:orgA, 'Denis Segundo', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'r3') AS l3 \gset
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas WHERE lead_id = :'l3')
            OR (SELECT estado = 'ativa' FROM public.lead_conversas WHERE lead_id = :'l3'), 'R39 novo lead do mesmo número');
SELECT id AS cv3 FROM public.lead_conversas WHERE lead_id = :'l3' \gset
SELECT public.lead_ia_retorno_receber(:'toka', t.m('sair1', '15981110001', 'SAIR')) AS r5 \gset
SELECT t.ok((:'r5')::jsonb->>'r' = 'ok' AND NOT ((:'r5')::jsonb->>'responder')::boolean
            AND (SELECT estado = 'optout' FROM public.lead_conversas WHERE id = :'cv3')
            AND EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = :orgA AND contato = '15981110001'),
            'R40 SAIR pelo WhatsApp: opt-out gravado e IA parada');
SELECT t.ok((SELECT status = 'pendente' FROM public.lead_mensagens WHERE conversa_id = :'cv3' AND autor = 'sistema'),
            'R41 confirmação do SAIR vai pelo WhatsApp (pendente)');
-- Depois do SAIR, uma nova mensagem não gera resposta.
SELECT t.ok(NOT (public.lead_ia_retorno_receber(:'toka', t.m('pos1', '15981110001', 'oi'))->>'responder')::boolean,
            'R42 depois do SAIR: não responde mais');
-- Envio reservado respeita o opt-out (só a confirmação do SAIR pode sair).
SELECT t.ok((SELECT count(*) <= 1 FROM public.lead_ia_envio_reservar(:'l3')), 'R43 reservar após SAIR: no máximo a confirmação');

-- Pedido de humano: num lead novo de outro número liberado.
DELETE FROM public.lead_ia_optouts WHERE organization_id = :orgA;
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110001', '15981110005']);
SELECT public.lead_inserir(:orgA, 'Pede Humano', '15981110005', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'r5') AS l5 \gset
SELECT public.lead_ia_retorno_receber(:'toka', t.m('h1', '15981110005', 'quero falar com o corretor')) AS r6 \gset
SELECT id AS cv5 FROM public.lead_conversas WHERE lead_id = :'l5' \gset
SELECT t.ok(((:'r6')::jsonb->>'responder')::boolean, 'R44 pedido de humano chega à IA (o roteiro decide)');
SELECT (public.lead_ia_aplicar(:'cv5', ((:'r6')::jsonb->'ctx'->>'versao')::int, 'fim', '{}',
          'Claro! Vou pedir para o corretor responsável falar com você.', 'pediu_pessoa', 'Cliente pediu para falar com uma pessoa.')->>'ok')::boolean AS ap5 \gset
SELECT t.ok(:'ap5'::boolean AND (SELECT estado = 'passada' AND motivo_fim = 'pediu_pessoa' FROM public.lead_conversas WHERE id = :'cv5'),
            'R45 pedido de humano: passa ao corretor');
SELECT t.ok(EXISTS (SELECT 1 FROM public.notifications WHERE organization_id = :orgA AND mensagem LIKE '%Pede Humano%'),
            'R46 sino avisado');

-- Mídia: chega como "[áudio ou arquivo recebido]" e tipo midia.
SELECT public.lead_inserir(:orgA, 'Manda Audio', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'r6') AS l6 \gset
UPDATE public.lead_mensagens SET created_at = created_at - interval '2 minutes' WHERE organization_id = :orgA;
SELECT public.lead_ia_retorno_receber(:'toka', t.m('au1', '15981110001', '', '{"tipo":"midia"}')) AS r7 \gset
SELECT t.ok((:'r7')::jsonb->>'tipo' = 'midia' AND ((:'r7')::jsonb->>'responder')::boolean
            AND EXISTS (SELECT 1 FROM public.lead_mensagens WHERE texto = '[áudio ou arquivo recebido]' AND status = 'recebida'),
            'R47 áudio: gravado sem conteúdo e vai para a resposta pedindo texto');

-- Conta como interação (lead aceito).
UPDATE public.leads SET aceito_em = now(), responsavel_id = :c1, ultima_interacao_em = now() - interval '5 days' WHERE id = :'l6';
UPDATE public.lead_mensagens SET created_at = created_at - interval '2 minutes' WHERE organization_id = :orgA;
SELECT public.lead_ia_retorno_receber(:'toka', t.m('int1', '15981110001', 'comprar'));
SELECT t.ok((SELECT ultima_interacao_em > now() - interval '1 minute' FROM public.leads WHERE id = :'l6'), 'R48 mensagem pelo WhatsApp conta como interação');

-- Isolamento: token da A não acha lead da B com o mesmo telefone; B no canal real só vê B.
SELECT public.lead_ia_canal_definir(:orgB, 'ziontalk'), public.lead_ia_allowlist_definir(:orgB, ARRAY['15981110007']);
SELECT public.lead_inserir(:orgB, 'Lead da B', '15981110007', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'b1') AS lb \gset
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110007']);
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('iso1', '15981110007', 'oi'))->>'r' = 'desconhecido',
            'R49 token da A não alcança lead da B');
SELECT t.ok(public.lead_ia_retorno_receber(:'tokb', t.m('iso1', '15981110007', 'oi'))->>'r' = 'ok',
            'R50 mesmo id na B é outra mensagem (dedup por imobiliária) e acha o lead da B');
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_mensagens m JOIN public.lead_conversas c ON c.id = m.conversa_id
              WHERE c.lead_id = :'lb' AND m.organization_id <> :orgB), 'R51 mensagens da B ficam na B');
SELECT t.como(:admA);
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_conversas WHERE lead_id = :'lb'), 'R52 admin A não vê conversa da B');
SELECT t.dono();

-- Lead simulado nunca recebe pelo retorno.
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110008']);
SELECT public.lead_inserir(:orgA, 'Simulado', '15981110008', NULL, 'olx', NULL, NULL, NULL, true, NULL, 'sim1');
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('sim1', '15981110008', 'oi'))->>'r' = 'desconhecido', 'R53 lead simulado é ignorado');

-- Desligar o token: 401 depois.
SELECT t.como(:admA);
SELECT public.lead_ia_retorno_token('desligar');
SELECT t.dono();
SELECT t.ok(public.lead_ia_retorno_receber(:'toka', t.m('z1', '15981110001', 'oi'))->>'r' = 'token', 'R54 desligar: token antigo deixa de valer');

-- Permissões.
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.lead_ia_retorno_receber(text, jsonb)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.lead_ia_retorno_receber(text, jsonb)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.lead_ia_canal_numero_definir(uuid, text)', 'EXECUTE'),
            'R55 só o servidor recebe o retorno e define o número do canal');
SELECT t.ok(NOT has_table_privilege('authenticated', 'public.lead_ia_retorno_eventos', 'SELECT')
            AND NOT has_column_privilege('authenticated', 'public.lead_config', 'ia_retorno_token_hash', 'SELECT')
            AND NOT has_column_privilege('authenticated', 'public.lead_config', 'ia_canal_numero', 'SELECT')
            AND has_column_privilege('authenticated', 'public.lead_config', 'ia_modelo', 'SELECT'),
            'R56 app não lê eventos, hash nem número do canal; lê o modelo');

-- Modelo: gestor escolhe; formato validado; corretor não.
SELECT t.como(:gesA);
SELECT public.lead_ia_modelo_salvar('openrouter', 'Anthropic/Claude-Haiku-5.5');
SELECT t.ok((SELECT ia_modelo_provedor = 'openrouter' AND ia_modelo = 'anthropic/claude-haiku-5.5' FROM public.lead_config),
            'R57 gestor escolhe modelo do OpenRouter');
SELECT t.ok(t.falha($$SELECT public.lead_ia_modelo_salvar('openrouter', 'sem barra')$$)
            AND t.falha($$SELECT public.lead_ia_modelo_salvar('outro', NULL)$$), 'R58 modelo inválido recusado');
SELECT public.lead_ia_modelo_salvar('gemini', 'ignorado/x');
SELECT t.ok((SELECT ia_modelo_provedor = 'gemini' AND ia_modelo IS NULL FROM public.lead_config), 'R59 voltar ao Gemini limpa o modelo');
SELECT t.como(:c1);
SELECT t.ok(t.falha($$SELECT public.lead_ia_modelo_salvar('gemini', NULL)$$), 'R60 corretor não escolhe modelo');
SELECT t.dono();

-- Uso dos modelos: gestor da A lê só da A; corretor não; sem conteúdo.
INSERT INTO public.lead_ia_uso (organization_id, conversa_id, provedor, modelo, ok, tokens_entrada, tokens_saida, custo_usd)
VALUES (:orgA, :'cv1', 'openrouter', 'anthropic/claude-haiku-5.5', true, 80, 10, 0.000013),
       (:orgB, NULL, 'gemini', 'gemini-flash-latest', true, 80, 10, 0.0001);
SELECT t.como(:gesA);
SELECT t.ok((SELECT count(*) = 1 AND bool_and(organization_id = 'aaaaaaaa-0000-0000-0000-000000000000') FROM public.lead_ia_uso),
            'R61 gestor A vê só o uso da A');
SELECT t.ok(t.falha($$INSERT INTO public.lead_ia_uso (organization_id, provedor, modelo, ok) VALUES ('aaaaaaaa-0000-0000-0000-000000000000', 'gemini', 'x', true)$$),
            'R62 app não grava uso');
SELECT t.como(:c1);
SELECT t.ok((SELECT count(*) = 0 FROM public.lead_ia_uso), 'R63 corretor não vê uso');
SELECT t.dono();
SELECT t.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_ia_uso'
                         AND column_name ~ '(tel|texto|fone|conteudo|prompt|resposta)'), 'R64 uso sem conteúdo');

SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail FROM t.res;
SELECT label FROM t.res WHERE NOT ok;
