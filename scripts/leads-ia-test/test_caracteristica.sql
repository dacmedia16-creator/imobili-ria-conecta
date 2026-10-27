-- Testes da migration 20261027130000 (card t_a9f1b447): busca por característica, conversa certa e nenhuma
-- mensagem sem resposta. PostgreSQL descartável, 2 imobiliárias, dados 100% fictícios.
-- Uso: bash scripts/leads-ia-test/test_caracteristica.sh
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
CREATE FUNCTION t.falha(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
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

-- Catálogo A, igual ao caso real (ZZ, 27/10): o lead é a casa 3881 (R$ 655 mil, 1 suíte); com 3+ suítes só
-- acima de R$ 975 mil.
SELECT public.remax_xml_ingest(:orgA, '[
 {"code":"3881","tipo":"casa-de-condominio","bairro":"Jardim Piratininga","cidade":"Sorocaba","quartos":3,"suites":1,"preco":655000},
 {"code":"3879","tipo":"casa-de-condominio","bairro":"Horto Florestal","cidade":"Sorocaba","quartos":3,"suites":1,"preco":645000,"url":"https://imob.exemplo.test/imovel/3879"},
 {"code":"VIP0137","tipo":"casa-de-condominio","bairro":"Horto Florestal","cidade":"Sorocaba","quartos":3,"suites":2,"preco":685000,"url":"https://imob.exemplo.test/imovel/VIP0137"},
 {"code":"VIP0015","tipo":"apartamento","bairro":"Centro","cidade":"Sorocaba","quartos":4,"suites":3,"area_util":135,"preco":975000,"url":"https://imob.exemplo.test/imovel/VIP0015"},
 {"code":"VIP0110","tipo":"casa-de-condominio","bairro":"Ibiti Royal Park","cidade":"Sorocaba","quartos":3,"suites":3,"vagas":4,"area_util":184,"preco":1050000,"url":"https://imob.exemplo.test/imovel/VIP0110"},
 {"code":"V3","tipo":"casa","bairro":"Centro","cidade":"Votorantim","quartos":3,"suites":3,"preco":600000},
 {"code":"L3","tipo":"casa","bairro":"Centro","cidade":"Sorocaba","quartos":3,"suites":3,"negocio":"locacao","preco_aluguel":5000}
]'::jsonb, 7, now(), 'generico') IS NOT NULL;
SELECT public.remax_xml_ingest(:orgB, '[
 {"code":"BX3","tipo":"casa","bairro":"Centro","cidade":"Sorocaba","quartos":3,"suites":3,"preco":650000}
]'::jsonb, 1, now(), 'generico') IS NOT NULL;

SELECT public.lead_inserir(:orgA, 'Cliente', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'c1') AS l1 \gset
UPDATE public.leads SET anuncio_codigo = '3881', portal_transacao = 'venda' WHERE id = :'l1';
SELECT id AS cv1 FROM public.lead_conversas WHERE lead_id = :'l1' \gset
SELECT dados AS dados_antes FROM public.lead_conversas WHERE id = :'cv1' \gset

-- 1) Busca por característica -------------------------------------------------------------------------------
SELECT public.lead_ia_imoveis_caracteristica(:'cv1', 'venda', 3, NULL, NULL, NULL, NULL, NULL, 556750, 753250, 'Sorocaba', '{}', 3) AS r1 \gset
SELECT t.ok(t.cods(:'r1') = '' AND (:'r1')::jsonb->'proximo'->>'codigo' = 'VIP0015',
            'C01 3 suítes na faixa de R$ 655 mil: nada dentro; o mais próximo é o mais em conta acima (VIP0015, R$ 975 mil)');
SELECT t.ok((:'r1')::jsonb->'proximo'->>'preco' = 'R$ 975.000' AND (:'r1')::jsonb->'proximo'->>'url' = 'https://imob.exemplo.test/imovel/VIP0015'
            AND (:'r1')::jsonb->'proximo'->>'suites' = '3', 'C02 o mais próximo vem com preço, link e suítes');
SELECT t.ok((:'r1')::jsonb->'proximo'->>'codigo' <> 'V3', 'C03 nunca outra cidade (V3 em Votorantim, R$ 600 mil)');
SELECT t.ok(t.cods(public.lead_ia_imoveis_caracteristica(:'cv1', 'venda', 3, NULL, NULL, NULL, NULL, NULL, 900000, 1100000, 'Sorocaba', '{}', 3)) = 'VIP0015,VIP0110'
            AND public.lead_ia_imoveis_caracteristica(:'cv1', 'venda', 3, NULL, NULL, NULL, NULL, NULL, 900000, 1100000, 'Sorocaba', '{}', 3)->'proximo' = 'null'::jsonb,
            'C04 com faixa que alcança: dentro da faixa, sem \"proximo\"');
SELECT t.ok(t.cods(public.lead_ia_imoveis_caracteristica(:'cv1', 'venda', 3, NULL, NULL, NULL, 'casa', NULL, 900000, 1100000, 'Sorocaba', '{}', 3)) = 'VIP0110',
            'C05 tipo pedido (casa): só casa');
SELECT t.ok(t.cods(public.lead_ia_imoveis_caracteristica(:'cv1', 'venda', 2, NULL, NULL, NULL, NULL, NULL, 556750, 753250, 'Sorocaba', '{}', 3)) = 'VIP0137',
            'C06 2 suítes na faixa: VIP0137 (o imóvel do lead e os de 1 suíte ficam fora)');
SELECT t.ok(t.cods(public.lead_ia_imoveis_caracteristica(:'cv1', 'venda', 3, NULL, NULL, NULL, NULL, NULL, 900000, 1100000, 'Sorocaba', ARRAY['vip0015'], 3)) = 'VIP0110',
            'C07 nunca repete os já oferecidos');
SELECT t.ok(t.cods(public.lead_ia_imoveis_caracteristica(:'cv1', 'venda', NULL, NULL, 4, 150, NULL, NULL, NULL, NULL, 'Sorocaba', '{}', 3)) = 'VIP0110',
            'C08 vagas e área mínima');
SELECT t.ok(t.cods(public.lead_ia_imoveis_caracteristica(:'cv1', 'locacao', 3, NULL, NULL, NULL, NULL, NULL, NULL, 6000, 'Sorocaba', '{}', 3)) = 'L3',
            'C09 locação: só locação');
SELECT t.ok(t.cods(public.lead_ia_imoveis_caracteristica(:'cv1', 'venda', 3, NULL, NULL, NULL, NULL, 'horto', NULL, NULL, 'Sorocaba', '{}', 3)) = ''
            AND t.cods(public.lead_ia_imoveis_caracteristica(:'cv1', 'venda', 2, NULL, NULL, NULL, NULL, 'horto', NULL, NULL, 'Sorocaba', '{}', 3)) = 'VIP0137',
            'C10 bairro pedido');
SELECT t.ok(NOT ((:'r1')::jsonb->'proximo' ?| ARRAY['rua','numero','corretor_nome','corretor_telefone','disponivel']), 'C11 sem endereço nem contato');
SELECT public.lead_inserir(:orgB, 'Bia', '15981110005', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'b1') AS lb \gset
SELECT t.ok(public.lead_ia_imoveis_caracteristica((SELECT id FROM public.lead_conversas WHERE lead_id = :'lb'), 'venda', 3)->'proximo' IS NULL
            OR t.cods(public.lead_ia_imoveis_caracteristica((SELECT id FROM public.lead_conversas WHERE lead_id = :'lb'), 'venda', 3)) = 'BX3',
            'C12 isolamento: conversa da B só vê a B');
SELECT t.ok(t.cods(:'r1') !~ 'BX3' AND (:'r1')::jsonb->'proximo'->>'codigo' <> 'BX3', 'C13 a A nunca vê a B');
SELECT t.ok(t.falha(format('SELECT public.lead_ia_imoveis_caracteristica(%L, ''aluguel'')', :'cv1'))
        AND t.falha(format('SELECT public.lead_ia_imoveis_caracteristica(%L, ''venda'', 99)', :'cv1'))
        AND t.falha(format('SELECT public.lead_ia_imoveis_caracteristica(%L, ''venda'', NULL, NULL, NULL, NULL, ''castelo'')', :'cv1')),
            'C14 entrada inválida recusada');
SELECT t.ok(public.lead_ia_imoveis_caracteristica(gen_random_uuid(), 'venda', 3) IS NULL, 'C15 conversa inexistente = nada');
SELECT t.como(:admA);
SELECT t.ok(t.falha(format('SELECT public.lead_ia_imoveis_caracteristica(%L)', :'cv1')), 'C16 app (usuário logado) não chama; só o servidor');
SELECT t.dono();
SELECT t.ok((SELECT dados FROM public.lead_conversas WHERE id = :'cv1') = (:'dados_antes')::jsonb, 'C17 só leitura: conversa intacta');

-- 2) Retorno: conversa certa e nunca sem resposta ------------------------------------------------------------
UPDATE public.lead_config SET ia_ativa = true, ia_nome = 'Nicole', ia_resp_max_minuto = 6 WHERE organization_id = :orgA;
SELECT public.lead_ia_canal_definir(:orgA, 'ziontalk'), public.lead_ia_allowlist_definir(:orgA, ARRAY['15981110001']);
SELECT public.lead_ia_canal_numero_definir(:orgA, '+55 15 98111-1149');
-- Conversa ANTIGA do mesmo telefone, que ficou \"ativa\" (como a de 25/10), e a nova (do lead mais recente).
UPDATE public.lead_conversas SET created_at = now() - interval '2 days', estado = 'ativa' WHERE id = :'cv1';
SELECT public.lead_inserir(:orgA, 'Cliente', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'c2') AS l2 \gset
SELECT id AS cv2 FROM public.lead_conversas WHERE lead_id = :'l2' \gset
UPDATE public.lead_conversas SET estado = 'ativa', canal = 'ziontalk' WHERE id = :'cv2';
SELECT public.lead_ia_retorno_receber(:'toka', t.m('m1', '15981110001', 'Qual valor de IPTU?')) AS r2 \gset
SELECT t.ok((:'r2')::jsonb->'ctx'->>'conversa_id' = :'cv2' AND ((:'r2')::jsonb->>'responder')::boolean,
            'C18 mensagem vai para a conversa do lead mais recente');
-- 3 mensagens seguidas, com 2 respostas da IA no último minuto: todas recebem resposta (antes: limite_minuto).
SELECT public.lead_ia_aplicar(:'cv2', (SELECT versao FROM public.lead_conversas WHERE id = :'cv2'), 'interesse', '{}', 'O IPTU é de R$ 55 por mês.', NULL, NULL) IS NOT NULL;
SELECT public.lead_ia_retorno_receber(:'toka', t.m('m2', '15981110001', 'Queria com 3 suítes')) AS r3 \gset
SELECT public.lead_ia_aplicar(:'cv2', (SELECT versao FROM public.lead_conversas WHERE id = :'cv2'), 'interesse', '{}', 'Com 3 suítes, nessa faixa não tenho.', NULL, NULL) IS NOT NULL;
SELECT public.lead_ia_retorno_receber(:'toka', t.m('m3', '15981110001', 'Teria com 3 suítes?')) AS r4 \gset
SELECT t.ok(((:'r3')::jsonb->>'responder')::boolean AND ((:'r4')::jsonb->>'responder')::boolean
            AND NOT EXISTS (SELECT 1 FROM public.lead_ia_retorno_eventos WHERE resultado = 'limite_minuto'),
            'C19 duas respostas no minuto não deixam a próxima mensagem sem resposta');
SELECT t.ok((SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND autor = 'cliente') = 0,
            'C20 nada caiu na conversa antiga');
-- Conversa nova passada ao corretor: a mensagem seguinte fica NELA (sem resposta da IA), não pula para a antiga.
SELECT public.lead_ia_passar(:'cv2', 'qualificado', 'teste');
SELECT public.lead_ia_retorno_receber(:'toka', t.m('m4', '15981110001', 'Vc é corretora?')) AS r5 \gset
SELECT t.ok(NOT ((:'r5')::jsonb->>'responder')::boolean
            AND (SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv1' AND autor = 'cliente') = 0
            AND (SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = :'cv2' AND autor = 'cliente' AND texto = 'Vc é corretora?') = 1,
            'C21 lead novo já passado: mensagem registrada na conversa certa, IA não responde na antiga');
-- Limite por minuto da IMOBILIÁRIA continua valendo.
UPDATE public.lead_conversas SET estado = 'ativa' WHERE id = :'cv2';
UPDATE public.lead_config SET ia_resp_max_minuto = 1 WHERE organization_id = :orgA;
SELECT t.ok(((public.lead_ia_retorno_receber(:'toka', t.m('m5', '15981110001', 'oi'))->>'limite'))::boolean,
            'C22 limite por minuto da imobiliária continua');

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT 'FAIL ' || label FROM t.res WHERE NOT ok;
