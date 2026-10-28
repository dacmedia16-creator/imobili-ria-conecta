-- Testes da migration 20261028100000 (t_228659f0): busca por nome de condomínio e limite da conversa com aviso.
-- PostgreSQL descartável, 2 imobiliárias, dados 100% fictícios. Uso: bash scripts/leads-ia-test/test_nome_limite.sh
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
CREATE FUNCTION t.m(_id text, _tel text, _txt text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', _id, 'telefone', _tel, 'texto', _txt, 'tipo', 'texto', 'grupo', false, 'status', false, 'proprio', false) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set admB '''b0000000-0000-0000-0000-00000000000a'''

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
SELECT t.como(:admA); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT public.lead_ia_retorno_token('gerar') AS toka \gset
SELECT t.como(:admB); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.dono();

-- Catálogo A igual ao caso real (ZZ, 28/10): o nome "Residencial Cannes" só aparece na DESCRIÇÃO.
SELECT public.remax_xml_ingest(:orgA, '[
 {"code":"VIP0137","tipo":"casa-de-condominio","bairro":"Horto Florestal","cidade":"Sorocaba","quartos":3,"suites":2,"preco":685000,"url":"https://imob.example.com.br/imovel/VIP0137"},
 {"code":"VIP0136","tipo":"apartamento","bairro":"Parque Campolim","cidade":"Sorocaba","quartos":3,"suites":1,"preco":999000,"url":"https://imob.example.com.br/imovel/VIP0136",
  "titulo":"Apartamento à venda, 3 quartos, Parque Campolim, Sorocaba/SP","busca_texto":"Lindo apto no RESIDENCIAL CANNES, lazer completo. Ligue (15) 99999-1234 ou veja https://x.com/a"},
 {"code":"822","tipo":"apartamento","bairro":"Parque Campolim","cidade":"Sorocaba","quartos":3,"suites":1,"preco":1100000,"url":"https://imob.example.com.br/imovel/822",
  "titulo":"Apartamento à venda, 3 quartos, Parque Campolim, Sorocaba/SP","busca_texto":"Condomínio Cannes, andar alto"},
 {"code":"VIP0036","tipo":"apartamento","bairro":"Parque Campolim","cidade":"Sorocaba","quartos":3,"suites":3,"preco":1170000,"url":"https://imob.example.com.br/imovel/VIP0036",
  "titulo":"Apartamento à venda, 3 quartos, Parque Campolim, Sorocaba/SP","busca_texto":"Edifício Cannesville Tower"}
]'::jsonb, 4, now(), 'generico') IS NOT NULL;
-- Imobiliária B também tem um "Cannes": nunca pode aparecer para a A.
SELECT public.remax_xml_ingest(:orgB, '[
 {"code":"B1","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","quartos":2,"preco":500000,"busca_texto":"Residencial Cannes"}
]'::jsonb, 1, now(), 'generico') IS NOT NULL;

SELECT public.lead_inserir(:orgA, 'Cliente', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'c1') AS l1 \gset
UPDATE public.leads SET anuncio_codigo = 'VIP0137', portal_transacao = 'venda' WHERE id = :'l1';
SELECT id AS cv1 FROM public.lead_conversas WHERE lead_id = :'l1' \gset

-- 1) Coluna busca_texto: gravada normalizada, sem telefone nem link ---------------------------------------------
SELECT busca_texto AS bt FROM public.remax_xml_listings WHERE organization_id = :orgA AND code = 'VIP0136' \gset
SELECT t.ok(:'bt' LIKE '%residencial cannes%', 'N1 descrição gravada em minúsculas, sem acento: ' || :'bt');
SELECT t.ok(:'bt' !~ '[0-9]{4}-?[0-9]{4}' AND :'bt' !~ 'https?:', 'N2 sem telefone nem link');

-- 2) Busca por nome --------------------------------------------------------------------------------------------
SELECT public.lead_ia_imoveis_nome(:'cv1', 'Cannes') AS n1 \gset
SELECT t.ok(t.cods(:'n1') = 'VIP0136,822', 'N3 "Cannes" acha VIP0136 e 822 (mais barato primeiro), não acha Cannesville nem a outra imobiliária: ' || t.cods(:'n1'));
SELECT t.ok((:'n1'::jsonb)->'itens'->0->>'preco' = 'R$ 999.000' AND (:'n1'::jsonb)->'itens'->0->>'url' LIKE 'https://%', 'N4 com preço e link');
SELECT public.lead_ia_imoveis_nome(:'cv1', 'CÂNNES') AS n2 \gset
SELECT t.ok(t.cods(:'n2') = 'VIP0136,822', 'N5 sem distinguir maiúsculas nem acentos');
SELECT public.lead_ia_imoveis_nome(:'cv1', 'residencial cannes') AS n3 \gset
SELECT t.ok(t.cods(:'n3') = 'VIP0136', 'N6 nome com a palavra "residencial": ' || t.cods(:'n3'));
SELECT public.lead_ia_imoveis_nome(:'cv1', 'cannes', 'venda', ARRAY['VIP0136']) AS n4 \gset
SELECT t.ok(t.cods(:'n4') = '822', 'N7 excluir funciona');
SELECT public.lead_ia_imoveis_nome(:'cv1', 'horto') AS n5 \gset
SELECT t.ok(t.cods(:'n5') = 'VIP0137', 'N8 nome no bairro também vale');
SELECT t.ok(t.cods(public.lead_ia_imoveis_nome(:'cv1', 'monaco')) = '', 'N9 nome que não existe: vazio');
DO $$ BEGIN PERFORM public.lead_ia_imoveis_nome((SELECT id FROM public.lead_conversas LIMIT 1), 'ab');
  PERFORM t.ok(false, 'N10 nome curto barra'); EXCEPTION WHEN sqlstate '22023' THEN PERFORM t.ok(true, 'N10 nome curto barra'); END $$;
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.lead_ia_imoveis_nome(uuid,text,text,text[],integer)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.lead_ia_imoveis_nome(uuid,text,text,text[],integer)', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.lead_ia_imoveis_nome(uuid,text,text,text[],integer)', 'EXECUTE'),
            'S1 busca por nome só service_role');

-- 3) Limite da conversa -----------------------------------------------------------------------------------------
SELECT public.lead_ia_canal_definir(:orgA, 'ziontalk'), public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110001', '15981110002']);
SELECT public.lead_ia_canal_numero_definir(:orgA, '+55 15 98111-1149');
UPDATE public.lead_config SET ia_resp_max_conversa = 3 WHERE organization_id = :orgA;
UPDATE public.lead_conversas SET estado = 'ativa', canal = 'ziontalk', passo = 'interesse' WHERE id = :'cv1';
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
SELECT :orgA, :'cv1', 'ia', 'resposta ' || g, 'enviada' FROM generate_series(1, 3) g;
SELECT public.lead_ia_retorno_receber(:'toka', t.m('l1', '15981110001', 'qual o valor do iptu?')) AS r1 \gset
SELECT t.ok((:'r1'::jsonb)->>'responder' = 'false', 'L1 no limite: a IA não responde');
SELECT t.ok((SELECT estado || '/' || motivo_fim FROM public.lead_conversas WHERE id = :'cv1') = 'passada/limite', 'L2 passa ao corretor (limite)');
SELECT t.ok((SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND autor = 'sistema' AND status = 'pendente'
              AND texto ~ 'corretor' AND texto ~ 'continua') = 1, 'L3 cliente recebe 1 aviso curto (pendente = vai pelo canal)');
SELECT t.ok((SELECT encerrada_em IS NOT NULL FROM public.lead_conversas WHERE id = :'cv1'), 'L4 encerrada_em marcado (espera de 10 min funciona)');
-- Aviso de espera: cliente escreve depois e ninguém responde em 10 min.
UPDATE public.lead_mensagens SET status = 'enviada', created_at = now() - interval '2 hours' WHERE conversa_id = :'cv1';
UPDATE public.lead_conversas SET encerrada_em = now() - interval '1 hour' WHERE id = :'cv1';
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status, created_at)
VALUES (:orgA, :'cv1', 'cliente', 'oi?', 'recebida', now() - interval '11 minutes');
SELECT t.ok((SELECT count(*) FROM public.lead_ia_espera_preparar()) = 1, 'L5 depois do limite, a espera de 10 min dispara');

-- Visita em curso: não corta no meio; termina com até +4 respostas e depois passa como "visita".
SELECT public.lead_inserir(:orgA, 'Cliente 2', '15981110002', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'c2') AS l2 \gset
UPDATE public.leads SET anuncio_codigo = 'VIP0137', portal_transacao = 'venda' WHERE id = :'l2';
SELECT id AS cv2 FROM public.lead_conversas WHERE lead_id = :'l2' \gset
UPDATE public.lead_conversas SET estado = 'ativa', canal = 'ziontalk', passo = 'interesse', dados = '{"convite_visita":true}' WHERE id = :'cv2';
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
SELECT :orgA, :'cv2', 'ia', 'resposta ' || g, 'enviada' FROM generate_series(1, 3) g;
SELECT public.lead_ia_retorno_receber(:'toka', t.m('v1', '15981110002', 'Amanhã a tarde não tem como ?')) AS v1 \gset
SELECT t.ok((:'v1'::jsonb)->>'responder' = 'true', 'L6 visita sendo combinada no limite: a IA ainda responde');
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
SELECT :orgA, :'cv2', 'ia', 'visita ' || g, 'enviada' FROM generate_series(1, 4) g;
SELECT public.lead_ia_retorno_receber(:'toka', t.m('v2', '15981110002', 'pode ser sabado de manha?')) AS v2 \gset
SELECT t.ok((:'v2'::jsonb)->>'responder' = 'false'
            AND (SELECT motivo_fim FROM public.lead_conversas WHERE id = :'cv2') = 'visita', 'L7 passou de +4: passa como visita');
SELECT t.ok((SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv2' AND autor = 'sistema' AND texto ~ 'visita') = 1, 'L8 aviso de visita ao cliente');
SELECT t.ok((SELECT resumo FROM public.lead_conversas WHERE id = :'cv2') ~ 'sabado de manha', 'L9 o corretor vê o pedido do cliente no resumo');

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT 'FAIL ' || label FROM t.res WHERE NOT ok;
