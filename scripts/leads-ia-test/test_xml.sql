-- Testes da migration 20261026190000 (Link do XML + Nicole lendo o XML, card t_76243950) em PostgreSQL
-- descartável com 2 imobiliárias (A e B). Dados 100% fictícios. Uso: bash scripts/leads-ia-test/test_xml.sh
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set admB '''b0000000-0000-0000-0000-00000000000a'''
\set c1 '''a0000000-0000-0000-0000-0000000000c1'''
\set plat '''99999999-0000-0000-0000-000000000001'''
\set capA '''cccccccc-0000-0000-0000-000000000001'''

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
INSERT INTO public.platform_admins (user_id) VALUES (:plat);
INSERT INTO public.exclusive_captures (id, organization_id, captor_id, form_data, status) VALUES
 (:capA, :orgA, :c1, '{"imovel":{"tipo_imovel":"Casa","bairro":"Jardim Europa","municipio":"Sorocaba"},"ficha":{"quartos":"4"}}', 'aprovada');
SELECT t.como(:admA); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.como(:admB); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);

-- 1) Campo "Link do XML": vazio, só o administrador da plataforma -------------------------------------
SELECT t.dono();
SELECT t.ok((SELECT count(*) = 0 FROM public.organization_xml_feeds), 'X01 link nasce vazio para todas as imobiliárias');
SELECT t.como(:admA);
SELECT t.ok(t.falha($$SELECT public.platform_xml_feed_salvar('aaaaaaaa-0000-0000-0000-000000000000', 'https://portal.exemplo.com/feed')$$),
            'X02 administrador da imobiliária NÃO altera o link');
SELECT t.ok(t.falha($$SELECT url FROM public.organization_xml_feeds$$), 'X03 usuário do app não lê a tabela do link');
SELECT t.como(:plat);
SELECT t.ok(t.falha($$SELECT public.platform_xml_feed_salvar('aaaaaaaa-0000-0000-0000-000000000000', 'http://portal.exemplo.com/feed')$$)
        AND t.falha($$SELECT public.platform_xml_feed_salvar('aaaaaaaa-0000-0000-0000-000000000000', 'https://10.0.0.1/feed')$$)
        AND t.falha($$SELECT public.platform_xml_feed_salvar('aaaaaaaa-0000-0000-0000-000000000000', 'https://x.com/a b')$$),
            'X04 só https com nome (http, IP e espaço recusados)');
SELECT public.platform_xml_feed_salvar(:orgA, 'https://portal.exemplo.com/feed/zap');
SELECT public.platform_xml_feed_salvar(:orgB, 'https://outro.exemplo.com/feed');
SELECT public.platform_xml_feed_salvar(:orgB, '');
SELECT t.dono();
SELECT t.ok((SELECT array_agg(organization_id::text) = ARRAY['aaaaaaaa-0000-0000-0000-000000000000'] FROM public.organization_xml_feeds),
            'X05 administrador da plataforma grava; vazio apaga');

-- 2) Ingestão genérica (sem contato) e RE/MAX intacta ---------------------------------------------------
SELECT public.remax_xml_ingest(:orgA, '[
  {"code":"VIP0028","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","quartos":3,"suites":1,"vagas":2,"banheiros":2,
   "area":92,"area_util":92,"condominio":720,"iptu":140,"iptu_periodo":"mensal","fotos_qtd":12,"titulo":"Apartamento no Campolim",
   "corretor_nome":"Fulano","corretor_email":"fulano@exemplo.test","corretor_telefone":"15999990000","escritorio":"Escritório X"},
  {"code":"3610","tipo":"casa-de-condominio","bairro":"Ibiti","cidade":"Sorocaba","quartos":3,"area_util":165,"area_terreno":250,"iptu":1680,"iptu_periodo":"anual"}
]'::jsonb, 2, now(), 'generico') ->> 'status' AS s1 \gset
SELECT t.ok(:'s1' = 'ok', 'X06 ingestão genérica aceita códigos livres');
SELECT t.ok((SELECT bool_and(agent_id IS NULL AND corretor_nome IS NULL AND corretor_email IS NULL AND corretor_telefone IS NULL AND escritorio IS NULL)
               FROM public.remax_xml_listings WHERE organization_id = :orgA), 'X07 modo genérico não guarda NENHUM contato');
SELECT t.ok(public.remax_xml_ingest(:orgB, '[{"code":"VIP0028","tipo":"apartamento"}]'::jsonb, 1, now()) ->> 'status' = 'rejeitado',
            'X08 modo RE/MAX (padrão) continua recusando código fora do padrão RE/MAX');
SELECT public.remax_xml_ingest(:orgB, (SELECT jsonb_agg(jsonb_build_object('code', 'B' || g, 'tipo', 'casa', 'bairro', 'Centro'))
  || '[{"code":"VIP0028","tipo":"casa","bairro":"Centro","cidade":"Itu"}]'::jsonb FROM generate_series(1, 24) g), 25, now(), 'generico') IS NOT NULL;

-- 3) Ficha pelo XML: isolamento, código ausente ------------------------------------------------------------
SELECT t.ok(public.lead_ia_ficha_xml(:orgA, 'VIP0028') = '{"tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","quartos":"3","suites":"1",
  "banheiros":"2","vagas":"2","area_util_m2":"92","condominio":"R$ 720,00","iptu":"R$ 140,00 por mês"}'::jsonb, 'X09 ficha do XML com condomínio e IPTU, sem preço nem contato');
SELECT t.ok(public.lead_ia_ficha_xml(:orgA, 'vip0028') ->> 'bairro' = 'Campolim'
        AND public.lead_ia_ficha_xml(:orgA, '3610') ->> 'iptu' = 'R$ 1.680,00 por ano'
        AND public.lead_ia_ficha_xml(:orgA, '3610') ->> 'tipo' = 'casa', 'X10 código sem diferença de maiúsculas; IPTU anual; tipo da conversa');
SELECT t.ok(public.lead_ia_ficha_xml(:orgB, 'VIP0028') ->> 'bairro' = 'Centro' AND public.lead_ia_ficha_xml(:orgA, 'B1') IS NULL,
            'X11 isolamento: mesmo código em outra org traz o imóvel dela; código só da B não aparece na A');
SELECT t.ok(public.lead_ia_ficha_xml(:orgA, 'NAOEXISTE') IS NULL AND public.lead_ia_ficha_xml(:orgA, NULL) IS NULL
        AND public.lead_ia_ficha_xml(:orgA, '') IS NULL, 'X12 código ausente = nada');
SELECT t.ok(NOT (public.lead_ia_ficha_xml(:orgA, 'VIP0028') ?| ARRAY['disponivel','aceita_permuta','aceita_financiamento','andar','preco']),
            'X13 ficha nunca traz disponibilidade, permuta, financiamento, andar ou preço');

-- 4) Nicole: XML primeiro, captação depois ---------------------------------------------------------------
SELECT public.lead_inserir(:orgA, 'Maria', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'x1') AS l1 \gset
UPDATE public.leads SET anuncio_codigo = 'VIP0028', portal_transacao = 'venda' WHERE id = :'l1';
SELECT id AS cv1 FROM public.lead_conversas WHERE lead_id = :'l1' \gset
SELECT public.lead_ia_registrar_cliente(:'cv1', 'qual o condomínio?', 'recebida') AS ctx1 \gset
SELECT t.ok((:'ctx1')::jsonb ->> 'imovel_fonte' = 'xml' AND (:'ctx1')::jsonb -> 'ficha' ->> 'condominio' = 'R$ 720,00'
        AND (:'ctx1')::jsonb ->> 'imovel_frase' = 'o apartamento do bairro Campolim', 'X14 lead do portal sem captação usa o XML');
SELECT t.ok((:'ctx1')::text !~ '(fulano|15999990000|Escrit)', 'X15 contexto sem contato do XML');
SELECT public.lead_inserir(:orgA, 'Joao', '15981110002', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'x2') AS l2 \gset
UPDATE public.leads SET anuncio_codigo = 'VIP0028' WHERE id = :'l2';
SELECT public.lead_inserir(:orgA, 'Ana', '15981110003', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'x3') AS l3 \gset
UPDATE public.leads SET anuncio_codigo = 'NAOEXISTE' WHERE id = :'l3';
SELECT public.lead_ia_registrar_cliente((SELECT id FROM public.lead_conversas WHERE lead_id = :'l2'), 'oi', 'recebida') ->> 'imovel_fonte' AS f2 \gset
SELECT public.lead_ia_registrar_cliente((SELECT id FROM public.lead_conversas WHERE lead_id = :'l3'), 'oi', 'recebida') AS ctx3 \gset
SELECT t.ok(:'f2' = 'xml' AND (:'ctx3')::jsonb ->> 'imovel_fonte' = 'captacao' AND (:'ctx3')::jsonb -> 'ficha' ->> 'quartos' = '4',
            'X16 prioridade: XML pelo código; sem o código no XML, a captação');
-- Código informado pelo cliente: busca no XML da própria org e vale nos turnos seguintes.
SELECT public.lead_inserir(:orgA, 'Lead Grupo ZAP', '15981110004', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'x4') AS l4 \gset
SELECT id AS cv4 FROM public.lead_conversas WHERE lead_id = :'l4' \gset
SELECT t.ok(public.lead_ia_imovel_por_codigo(:'cv4', 'vip0028') ->> 'xml_codigo' = 'VIP0028'
        AND public.lead_ia_imovel_por_codigo(:'cv4', 'vip0028') -> 'capture_id' = 'null'::jsonb
        AND public.lead_ia_imovel_por_codigo(:'cv4', 'B1') IS NULL, 'X17 código informado: XML da própria org (o da B não)');
SELECT public.lead_ia_registrar_cliente(:'cv4', 'oi', 'recebida') IS NOT NULL;
SELECT public.lead_ia_aplicar(:'cv4', 1, 'faixa', '{"imovel_xml_codigo":"3610"}'::jsonb, 'ok', NULL, NULL) IS NOT NULL;
SELECT public.lead_ia_registrar_cliente(:'cv4', 'comprar', 'recebida') ->> 'imovel_frase' AS fr4 \gset
SELECT t.ok(:'fr4' = 'a casa do bairro Ibiti', 'X18 código achado no XML vale nos turnos seguintes');

-- 5) Imóvel que saiu do XML e queda brusca ----------------------------------------------------------------
SELECT public.remax_xml_ingest(:orgA, '[{"code":"3610","tipo":"casa","bairro":"Ibiti"}]'::jsonb, 1, now(), 'generico') IS NOT NULL;
SELECT public.lead_ia_registrar_cliente(:'cv1', 'e o iptu?', 'recebida') AS ctx5 \gset
SELECT t.ok(public.lead_ia_ficha_xml(:orgA, 'VIP0028') IS NULL AND (:'ctx5')::jsonb -> 'ficha' = 'null'::jsonb
        AND (:'ctx5')::jsonb -> 'imovel_fonte' = 'null'::jsonb, 'X19 imóvel que saiu do XML não é mais usado');
SELECT t.ok(public.remax_xml_ingest(:orgB, '[{"code":"B1","tipo":"casa"}]'::jsonb, 1, now(), 'generico') ->> 'status' = 'rejeitado'
        AND public.lead_ia_ficha_xml(:orgB, 'VIP0028') ->> 'bairro' = 'Centro', 'X20 queda brusca rejeitada; versão anterior mantida');

-- 6) Permissões ------------------------------------------------------------------------------------------
SELECT t.como(:admA);
SELECT t.ok(t.falha($$SELECT public.lead_ia_ficha_xml('aaaaaaaa-0000-0000-0000-000000000000', 'VIP0028')$$)
        AND t.falha($$SELECT public.remax_xml_ingest('aaaaaaaa-0000-0000-0000-000000000000', '[]', 0, now(), 'generico')$$),
            'X21 app não lê a ficha do XML nem grava coleta');
SELECT t.dono();

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT 'FAIL ' || label FROM t.res WHERE NOT ok;
