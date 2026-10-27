-- Testes da migration 20261027180000 (t_82c89141): parecidos por tipo normalizado, resposta de espera depois do
-- repasse e avisos da OLX juntados (caso Afonso). PostgreSQL descartável, 2 imobiliárias, dados 100% fictícios.
-- Uso: bash scripts/leads-ia-test/test_6_correcoes.sh
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
CREATE FUNCTION t.cods(_r jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(i->>'codigo', ',' ORDER BY o), '') FROM jsonb_array_elements(_r->'itens') WITH ORDINALITY AS x(i, o) $$;
CREATE FUNCTION t.m(_id text, _tel text, _txt text, _proprio boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', _id, 'telefone', _tel, 'texto', _txt, 'tipo', 'texto', 'grupo', false, 'status', false, 'proprio', _proprio) $$;
CREATE FUNCTION t.olx(_ext text, _cod text, _tipo text, _tel text DEFAULT '15981110077') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('originLeadId', _ext, 'clientListingId', _cod, 'name', 'Afonso Teste', 'ddd', left(_tel, 2),
    'phone', substr(_tel, 3), 'message', 'Olá, tenho interesse', 'transactionType', 'SELL',
    'extraData', jsonb_build_object('leadType', _tipo)) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set admB '''b0000000-0000-0000-0000-00000000000a'''
\set corA '''a0000000-0000-0000-0000-0000000000c1'''

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
SELECT t.como(:admA); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT public.lead_ia_retorno_token('gerar') AS toka \gset
SELECT public.lead_grupo_olx_token('gerar') AS olxa \gset
SELECT t.como(:admB); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT public.lead_grupo_olx_token('gerar') AS olxb \gset
SELECT t.dono();

-- Catálogo A igual ao caso real (ZZ, 27/10): o lead viu a "casa" 3975 (R$ 899 mil); na faixa ±15% em Sorocaba
-- só há "casa-de-condominio" (e um apartamento, que não pode entrar).
SELECT public.remax_xml_ingest(:orgA, '[
 {"code":"3975","tipo":"casa","bairro":"Jardim Ibiti","cidade":"Sorocaba","quartos":3,"suites":1,"preco":899000,"iptu":167,"iptu_periodo":"anual"},
 {"code":"VIP0131","tipo":"casa-de-condominio","bairro":"Ibiti Royal Park","cidade":"Sorocaba","quartos":3,"suites":3,"preco":920000},
 {"code":"VIP0140","tipo":"casa-de-condominio","bairro":"Jardim Ibiti","cidade":"Sorocaba","quartos":3,"suites":2,"preco":850000},
 {"code":"AP900","tipo":"apartamento","bairro":"Jardim Ibiti","cidade":"Sorocaba","quartos":3,"suites":1,"preco":900000},
 {"code":"VIP0148","tipo":"casa-de-condominio","bairro":"Centro","cidade":"Sorocaba","quartos":3,"preco":700000},
 {"code":"VIP0143","tipo":"casa-de-condominio","bairro":"Centro","cidade":"Sorocaba","quartos":2,"preco":650000},
 {"code":"C2","tipo":"casa","bairro":"Jardim Ibiti","cidade":"Sorocaba","quartos":3,"preco":880000}
]'::jsonb, 7, now(), 'generico') IS NOT NULL;

SELECT public.lead_inserir(:orgA, 'Cliente', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'c1') AS l1 \gset
UPDATE public.leads SET anuncio_codigo = '3975', portal_transacao = 'venda' WHERE id = :'l1';
SELECT id AS cv1 FROM public.lead_conversas WHERE lead_id = :'l1' \gset

-- 1) Parecidos por tipo normalizado ------------------------------------------------------------------------------
SELECT public.lead_ia_imoveis_parecidos(:'cv1', '{}', NULL, NULL, NULL, 'venda', 3) AS p1 \gset
SELECT t.ok(t.cods(:'p1') = 'C2,VIP0140,VIP0131', 'P1 casa acha casa de condomínio; mesmo tipo do XML e mesmo bairro primeiro: ' || t.cods(:'p1'));
SELECT t.ok(position('AP900' IN t.cods(:'p1')) = 0, 'P2 apartamento não entra em busca de casa');
SELECT t.ok((:'p1'::jsonb)->'referencia'->>'tipo' = 'casa', 'P3 referência continua a casa 3975');
SELECT public.lead_ia_imoveis_parecidos(:'cv1', '{C2}', NULL, NULL, NULL, 'venda', 3) AS p2 \gset
SELECT t.ok(t.cods(:'p2') = 'VIP0140,VIP0131', 'P4 excluir já oferecidos continua valendo: ' || t.cods(:'p2'));

-- 7) Avisos da OLX juntados (caso Afonso: 3 eventos, 2 anúncios, 3 minutos) ----------------------------------------
SELECT public.lead_ia_canal_definir(:orgA, 'ziontalk'), public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110001', '15981110077']);
SELECT public.lead_ia_canal_numero_definir(:orgA, '+55 15 98111-1149');
SELECT count(*) AS n_notif0 FROM public.notifications \gset
SELECT public.lead_grupo_olx_receber(:'olxa', t.olx('af-1', 'VIP0148', 'CONTACT_FORM'))->>'r' AS r1 \gset
SELECT public.lead_grupo_olx_receber(:'olxa', t.olx('af-2', 'VIP0148', 'PHONE_VIEW'))->>'r' AS r2 \gset
SELECT public.lead_grupo_olx_receber(:'olxa', t.olx('af-3', 'VIP0143', 'CLICK_WHATSAPP'))->>'r' AS r3 \gset
SELECT public.lead_grupo_olx_receber(:'olxa', t.olx('af-3', 'VIP0143', 'CLICK_WHATSAPP'))->>'r' AS r4 \gset
SELECT t.ok(:'r1' = 'ok' AND :'r2' = 'juntado' AND :'r3' = 'juntado', 'J1 Afonso: 1º cria, 2º e 3º juntam: ' || :'r1' || '/' || :'r2' || '/' || :'r3');
SELECT t.ok(:'r4' = 'duplicado', 'J2 reenvio do mesmo evento continua "duplicado"');
SELECT id AS laf FROM public.leads WHERE organization_id = :orgA AND telefone = '15981110077' \gset
SELECT t.ok((SELECT count(*) FROM public.leads WHERE organization_id = :orgA AND telefone = '15981110077') = 1, 'J3 3 eventos -> 1 lead');
SELECT t.ok((SELECT count(*) FROM public.lead_conversas WHERE lead_id = :'laf') = 1, 'J4 1 conversa');
SELECT t.ok((SELECT count(*) FROM public.lead_mensagens m JOIN public.lead_conversas c ON c.id = m.conversa_id
              WHERE c.lead_id = :'laf' AND m.autor = 'ia') <= 1, 'J5 no máximo 1 primeira mensagem');
SELECT t.ok((SELECT count(*) FROM public.lead_eventos WHERE lead_id = :'laf' AND tipo = 'atribuido') <= 1
            AND (SELECT count(*) FROM public.lead_eventos WHERE lead_id = :'laf' AND tipo IN ('redistribuido')) = 0,
            'J6 não entra de novo na fila');
SELECT t.ok((SELECT count(*) FROM public.lead_eventos WHERE lead_id = :'laf' AND para = 'aviso juntado') = 2
            AND EXISTS (SELECT 1 FROM public.lead_eventos WHERE lead_id = :'laf' AND para = 'aviso juntado'
                         AND nota LIKE '%VIP0143%outro imóvel%'), 'J7 histórico registra os 2 avisos e o anúncio extra');
SELECT id AS cvaf FROM public.lead_conversas WHERE lead_id = :'laf' \gset
SELECT public.lead_ia_registrar_cliente(:'cvaf', 'oi', 'recebida') AS ctxaf \gset
SELECT t.ok((:'ctxaf'::jsonb)->'outros_anuncios'->0->>'codigo' = 'VIP0143'
            AND jsonb_array_length((:'ctxaf'::jsonb)->'outros_anuncios') = 1
            AND (:'ctxaf'::jsonb)->'outros_anuncios'->0->'ficha'->>'bairro' = 'Centro',
            'J8 Nicole recebe o outro anúncio (só o diferente, com ficha do XML)');
-- Outra imobiliária, mesmo telefone: não junta.
SELECT public.lead_grupo_olx_receber(:'olxb', t.olx('af-b1', 'X1', 'CONTACT_FORM'))->>'r' AS rb \gset
SELECT t.ok(:'rb' = 'ok' AND (SELECT count(*) FROM public.leads WHERE organization_id = :orgB AND telefone = '15981110077') = 1,
            'J9 outra imobiliária com o mesmo telefone cria o lead dela');
-- Lead fechado ou fora da janela: cria lead novo.
UPDATE public.leads SET created_at = now() - interval '25 hours' WHERE id = :'laf';
SELECT public.lead_grupo_olx_receber(:'olxa', t.olx('af-4', 'VIP0148', 'CONTACT_FORM'))->>'r' AS r5 \gset
SELECT t.ok(:'r5' = 'ok', 'J10 fora da janela de 24 h cria lead novo');
UPDATE public.lead_config SET leads_juntar_horas = 0 WHERE organization_id = :orgA;
SELECT public.lead_grupo_olx_receber(:'olxa', t.olx('af-5', 'VIP0148', 'PHONE_VIEW'))->>'r' AS r6 \gset
SELECT t.ok(:'r6' = 'ok', 'J11 janela 0 = desligado (cria lead como antes)');
UPDATE public.lead_config SET leads_juntar_horas = 24 WHERE organization_id = :orgA;

-- 6b) Resposta de espera depois do repasse --------------------------------------------------------------------------
SELECT public.lead_ia_passar(:'cv1', 'qualificado', 'teste');
UPDATE public.lead_conversas SET canal = 'ziontalk', encerrada_em = now() - interval '1 hour' WHERE id = :'cv1';
UPDATE public.lead_mensagens SET created_at = now() - interval '2 hours' WHERE conversa_id = :'cv1';
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.lead_ia_espera_preparar()), 'E1 sem mensagem do cliente depois do repasse: nada');
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status, created_at)
VALUES (:orgA, :'cv1', 'cliente', 'e aí, o corretor vai me chamar?', 'recebida', now() - interval '5 minutes');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.lead_ia_espera_preparar()), 'E2 antes de 10 min: nada');
UPDATE public.lead_mensagens SET created_at = now() - interval '11 minutes' WHERE conversa_id = :'cv1' AND autor = 'cliente';
SELECT count(*) AS n_notif1 FROM public.notifications \gset
SELECT count(*) AS e3 FROM public.lead_ia_espera_preparar() \gset
SELECT t.ok(:e3 = 1, 'E3 depois de 10 min sem resposta: 1 espera');
SELECT t.ok((SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND autor = 'sistema' AND status = 'pendente'
              AND texto ~ 'corretor' AND texto !~ '[0-9]') = 1, 'E4 1 resposta curta, pendente, sem horário');
SELECT t.ok((SELECT count(*) FROM public.notifications) > :n_notif1, 'E5 sininho de novo');
SELECT t.ok((SELECT estado FROM public.lead_conversas WHERE id = :'cv1') = 'passada', 'E6 conversa continua com o corretor');
-- Mesmo com nova mensagem do cliente, no máximo 1 a cada 2 h.
UPDATE public.lead_mensagens SET status = 'enviada', created_at = now() - interval '20 minutes'
 WHERE conversa_id = :'cv1' AND status = 'pendente';
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status, created_at)
VALUES (:orgA, :'cv1', 'cliente', 'oi?', 'recebida', now() - interval '11 minutes');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.lead_ia_espera_preparar()), 'E7 no máximo 1 a cada 2 h');
UPDATE public.lead_conversas SET espera_em = now() - interval '3 hours' WHERE id = :'cv1';
-- Equipe respondeu pelo número da imobiliária (mensagem própria que não é eco da Nicole): nada.
SELECT public.lead_ia_retorno_receber(:'toka', t.m('eq1', '15981110001', 'Oi! Aqui é o João, corretor.', true))->>'r' AS req \gset
SELECT t.ok(:'req' = 'ignorado' AND (SELECT equipe_em FROM public.lead_conversas WHERE id = :'cv1') IS NOT NULL, 'E8 mensagem da equipe marca equipe_em');
UPDATE public.lead_conversas SET equipe_em = now() WHERE id = :'cv1';
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.lead_ia_espera_preparar()), 'E9 equipe respondeu: nada');
UPDATE public.lead_conversas SET equipe_em = NULL WHERE id = :'cv1';
-- Eco da própria Nicole não conta como equipe.
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status) VALUES (:orgA, :'cv1', 'ia', 'Eco teste', 'enviada');
SELECT public.lead_ia_retorno_receber(:'toka', t.m('eq2', '15981110001', 'Eco teste', true)) IS NOT NULL AS x \gset
SELECT t.ok((SELECT equipe_em FROM public.lead_conversas WHERE id = :'cv1') IS NULL, 'E10 eco da Nicole não conta como equipe');
DELETE FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND texto = 'Eco teste';
-- Corretor registrou algo no lead (evento com autor) depois da mensagem: nada.
INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, nota, autor_id) VALUES (:orgA, :'l1', 'nota', 'liguei', :corA);
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.lead_ia_espera_preparar()), 'E11 evento do corretor depois da mensagem: nada');
DELETE FROM public.lead_eventos WHERE lead_id = :'l1' AND nota = 'liguei';
-- Desligado por imobiliária (0).
UPDATE public.lead_config SET ia_espera_min = 0 WHERE organization_id = :orgA;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.lead_ia_espera_preparar()), 'E12 ia_espera_min = 0 desliga');
UPDATE public.lead_config SET ia_espera_min = 10 WHERE organization_id = :orgA;
-- Fora da lista de liberados: não grava nada.
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110077']);
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.lead_ia_espera_preparar()), 'E13 fora da lista de liberados: nada');
SELECT public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110001', '15981110077']);
SELECT t.ok((SELECT count(*) FROM public.lead_ia_espera_preparar()) = 1, 'E14 passadas 2 h, pode 1 nova espera');

-- Permissões -------------------------------------------------------------------------------------------------------
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.lead_ia_espera_preparar()', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.lead_ia_espera_preparar()', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.lead_ia_espera_preparar()', 'EXECUTE'), 'S1 espera só service_role');
SELECT t.ok(NOT has_table_privilege('authenticated', 'public.lead_portal_avisos', 'SELECT'), 'S2 avisos juntados: só o servidor');
SELECT t.ok(has_column_privilege('authenticated', 'public.lead_config', 'ia_espera_min', 'SELECT')
            AND NOT has_column_privilege('authenticated', 'public.lead_config', 'grupo_olx_token_hash', 'SELECT'), 'S3 config legível sem o hash');

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT 'FAIL ' || label FROM t.res WHERE NOT ok;
