-- Testes da migration 20261027080000 (link do anúncio + locação + 1ª mensagem com o imóvel, card t_25fe1197)
-- em PostgreSQL descartável com 2 imobiliárias (A e B). Dados fictícios, exceto o VIP0040, copiado do XML
-- público da ZZ (só dados do imóvel, nenhum contato). Uso: bash scripts/leads-ia-test/test_link.sh
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
\set capA '''cccccccc-0000-0000-0000-000000000001'''
\set c1 '''a0000000-0000-0000-0000-0000000000c1'''

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
UPDATE public.organizations SET nome = 'ZZ Teste Provisionamento' WHERE id = :orgA;
INSERT INTO public.exclusive_captures (id, organization_id, captor_id, form_data, status) VALUES
 (:capA, :orgA, :c1, '{"imovel":{"tipo_imovel":"Casa","bairro":"Jardim Europa","municipio":"Sorocaba"},"ficha":{"quartos":"4"}}', 'aprovada');
SELECT t.como(:admA); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.como(:admB); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.dono();

-- 1) Ingestão genérica: link seguro do domínio principal + locação ----------------------------------------
SELECT public.remax_xml_ingest(:orgA, '[
  {"code":"VIP0040","tipo":"apartamento","bairro":"Jardim São Carlos","cidade":"Sorocaba","quartos":2,"suites":1,"banheiros":2,"vagas":1,
   "area":59,"area_util":59,"preco":430000,"condominio":478,"iptu":58,"iptu_periodo":"mensal","negocio":"venda",
   "url":"https://vipsevenimoveis.com.br/imovel/VIP0040"},
  {"code":"VIP0041","tipo":"casa","bairro":"Campolim","cidade":"Sorocaba","quartos":3,"preco":800000,"negocio":"venda",
   "url":"https://www.vipsevenimoveis.com.br/imovel/VIP0041"},
  {"code":"VIP0042","tipo":"apartamento","bairro":"Centro","cidade":"Sorocaba","quartos":1,"preco":250000,"negocio":"venda",
   "url":"https://encurta.dor/abc"},
  {"code":"VIP0043","tipo":"apartamento","bairro":"Centro","cidade":"Sorocaba","preco":260000,"url":"http://vipsevenimoveis.com.br/imovel/VIP0043"},
  {"code":"VIP0044","tipo":"apartamento","bairro":"Centro","cidade":"Sorocaba","preco":270000,"url":"https://u:p@vipsevenimoveis.com.br/x"},
  {"code":"VIP0045","tipo":"apartamento","bairro":"Centro","cidade":"Sorocaba","preco":270000,"url":"https://vipsevenimoveis.com.br:8443/x"},
  {"code":"LOC0001","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","quartos":2,"condominio":600,"negocio":"locacao",
   "preco_aluguel":2500,"url":"https://vipsevenimoveis.com.br/imovel/LOC0001"},
  {"code":"LOC0002","tipo":"casa","bairro":"Éden","cidade":"Sorocaba","quartos":3,"preco":500000,"preco_aluguel":3000,"negocio":"venda_locacao"},
  {"code":"XLOC","tipo":"casa","negocio":"leilao"}
]'::jsonb, 9, now(), 'generico') AS r1 \gset
SELECT t.ok((:'r1')::jsonb ->> 'status' = 'ok' AND (:'r1')::jsonb ->> 'venda' = '7' AND (:'r1')::jsonb ->> 'locacao' = '2',
            'L01 coleta: contagem de venda continua só venda (7); locação separada (2); negócio desconhecido vira venda');
SELECT t.ok((SELECT string_agg(code || '=' || coalesce(url, '-'), ' ' ORDER BY code) FROM public.remax_xml_listings WHERE organization_id = :orgA)
  = 'LOC0001=https://vipsevenimoveis.com.br/imovel/LOC0001 LOC0002=- VIP0040=https://vipsevenimoveis.com.br/imovel/VIP0040 '
    || 'VIP0041=https://www.vipsevenimoveis.com.br/imovel/VIP0041 VIP0042=- VIP0043=- VIP0044=- VIP0045=- XLOC=-',
            'L02 link: só https do domínio principal do feed (www igual); outro domínio, http, usuário/senha e porta = sem link');
SELECT t.ok((SELECT venda FROM public.remax_xml_runs WHERE organization_id = :orgA AND status = 'ok' ORDER BY started_at DESC LIMIT 1) = 7,
            'L03 remax_xml_runs.venda conta só venda');
SELECT t.ok((SELECT string_agg(code || ':' || negocio || ':' || coalesce(preco_aluguel::text, '-'), ' ' ORDER BY code)
               FROM public.remax_xml_listings WHERE organization_id = :orgA AND code LIKE 'LOC%') = 'LOC0001:locacao:2500 LOC0002:venda_locacao:3000',
            'L04 locação guardada com o negócio e o aluguel');
SELECT t.ok(public.xml_url_anuncio_ok('https://vipsevenimoveis.com.br/imovel/VIP0040')
        AND NOT public.xml_url_anuncio_ok('https://10.0.0.1/a') AND NOT public.xml_url_anuncio_ok('https://localhost/a')
        AND NOT public.xml_url_anuncio_ok('https://x.com.br/' || repeat('a', 300)) AND NOT public.xml_url_anuncio_ok('javascript:alert(1)')
        AND NOT public.xml_url_anuncio_ok('https://x.com.br/a b') AND NOT public.xml_url_anuncio_ok(NULL),
            'L05 xml_url_anuncio_ok: IP, sem ponto, >300, javascript, espaço e nulo recusados');
-- Única Escolha (modo remax): link continua só remax.com.br, aluguel continua fora.
SELECT public.remax_xml_ingest(:orgB, '[
  {"code":"123456789-1","tipo":"casa","url":"https://www.remax.com.br/imoveis/1"},
  {"code":"123456789-2","tipo":"casa","url":"https://vipsevenimoveis.com.br/imovel/2"},
  {"code":"123456789-3","tipo":"casa","negocio":"locacao","preco_aluguel":2000}
]'::jsonb, 3, now()) AS r2 \gset
SELECT t.ok((:'r2')::jsonb ->> 'venda' = '3' AND (SELECT string_agg(code || '=' || coalesce(url, '-') || ':' || negocio || ':' || coalesce(preco_aluguel::text, '-'), ' ' ORDER BY code)
               FROM public.remax_xml_listings WHERE organization_id = :orgB)
  = '123456789-1=https://www.remax.com.br/imoveis/1:venda:- 123456789-2=-:venda:- 123456789-3=-:venda:-',
            'L06 Única Escolha (remax) não muda: só link remax.com.br, tudo venda, sem aluguel');

-- 2) Ficha do XML com valor e link --------------------------------------------------------------------------
SELECT t.ok(public.lead_ia_ficha_xml(:orgA, 'VIP0040') = '{"tipo":"apartamento","bairro":"Jardim São Carlos","cidade":"Sorocaba","quartos":"2",
  "suites":"1","banheiros":"2","vagas":"1","area_util_m2":"59","condominio":"R$ 478,00","iptu":"R$ 58,00 por mês","negocio":"venda",
  "preco":"R$ 430.000","preco_valor":430000,"link":"https://vipsevenimoveis.com.br/imovel/VIP0040"}'::jsonb,
            'L07 ficha VIP0040 com preço, link, condomínio e IPTU');
SELECT t.ok(public.lead_ia_ficha_xml(:orgA, 'LOC0001') ->> 'aluguel' = 'R$ 2.500' AND NOT (public.lead_ia_ficha_xml(:orgA, 'LOC0001') ? 'preco')
        AND public.lead_ia_ficha_xml(:orgA, 'LOC0002') ->> 'preco' = 'R$ 500.000' AND public.lead_ia_ficha_xml(:orgA, 'LOC0002') ->> 'aluguel' = 'R$ 3.000',
            'L08 ficha de locação: aluguel; venda e locação: os dois');
SELECT t.ok(NOT (public.lead_ia_ficha_xml(:orgA, 'VIP0040') ?| ARRAY['disponivel','aceita_permuta','aceita_financiamento','andar']),
            'L09 ficha nunca traz disponibilidade, permuta, financiamento ou andar');

-- 3) 1ª mensagem ------------------------------------------------------------------------------------------
-- Como o Grupo ZAP faz: INSERT do lead (1ª mensagem nasce) e DEPOIS o UPDATE com o código do anúncio.
SELECT public.lead_inserir(:orgA, 'Denis', '15981110001', NULL, 'grupo_olx', NULL, NULL, NULL, false, NULL, 'z1') AS l1 \gset
SELECT texto AS antes FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l1' \gset
UPDATE public.leads SET anuncio_codigo = 'VIP0040', portal_transacao = 'venda' WHERE id = :'l1';
SELECT texto AS msg1 FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l1' \gset
\echo PREVIA_VIP0040: :msg1
SELECT t.ok(:'antes' = 'Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse no imóvel que você viu. Quer saber mais detalhes ou já prefere agendar uma visita?',
            'L10 sem código ainda: texto neutro e SEM "assistente virtual"');
SELECT t.ok(:'msg1' = 'Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse no apartamento de 2 quartos no bairro Jardim São Carlos, em Sorocaba, anunciado por R$ 430.000. Anúncio: https://vipsevenimoveis.com.br/imovel/VIP0040 Quer saber mais detalhes ou já prefere agendar uma visita?',
            'L11 VIP0040: código gravado depois do INSERT remonta a 1ª mensagem com imóvel, valor e link');
SELECT t.ok((SELECT count(*) FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l1') = 1,
            'L12 continua UMA mensagem (não duplica)');
SELECT t.ok(:'msg1' !~* '(dispon|permuta|financ|andar|assistente virtual)', 'L13 nunca disponibilidade, permuta, financiamento, andar nem "assistente virtual"');
-- Locação
SELECT public.lead_inserir(:orgA, 'Ana Lima', '15981110002', NULL, 'grupo_olx', NULL, NULL, NULL, false, NULL, 'z2') AS l2 \gset
UPDATE public.leads SET anuncio_codigo = 'LOC0001', portal_transacao = 'aluguel' WHERE id = :'l2';
SELECT texto AS msg2 FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l2' \gset
\echo PREVIA_LOCACAO: :msg2
SELECT t.ok(:'msg2' = 'Oi, Ana! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse no apartamento de 2 quartos no bairro Campolim, em Sorocaba, para alugar por R$ 2.500 por mês. Anúncio: https://vipsevenimoveis.com.br/imovel/LOC0001 Quer saber mais detalhes ou já prefere agendar uma visita?',
            'L14 locação: aluguel por mês e link');
-- Venda e locação com lead de compra; imóvel sem link; lead com captação e sem XML.
SELECT public.lead_inserir(:orgA, 'Bia', '15981110003', NULL, 'grupo_olx', NULL, NULL, NULL, false, NULL, 'z3') AS l3 \gset
UPDATE public.leads SET anuncio_codigo = 'loc0002', portal_transacao = 'venda' WHERE id = :'l3';
SELECT texto AS msg3 FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l3' \gset
SELECT t.ok(:'msg3' = 'Oi, Bia! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Éden, em Sorocaba, anunciada por R$ 500.000. Quer saber mais detalhes ou já prefere agendar uma visita?',
            'L15 venda e locação + lead de compra: preço de venda; sem link no XML = sem "Anúncio:"');
SELECT public.lead_inserir(:orgA, 'Caio', '15981110004', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'z4') AS l4 \gset
SELECT texto AS msg4 FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l4' \gset
SELECT t.ok(:'msg4' ~ '^Oi, Caio! Aqui é a Nicole, da ZZ Teste Provisionamento\. Vi seu interesse .*Jardim Europa.*\. Quer saber mais detalhes' AND :'msg4' !~ 'http',
            'L16 sem XML: a captação, como antes, sem link');
-- Nome do lead com cara de link nunca entra.
SELECT public.lead_inserir(:orgA, 'golpe.com.br', '15981110005', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'z5') AS l5 \gset
SELECT texto AS msg5 FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l5' \gset
SELECT t.ok(:'msg5' ~ '^Oi! Aqui é a Nicole' AND :'msg5' !~ 'golpe', 'L17 nome com cara de link vira "Oi!"');
-- Já saiu: não remonta.
UPDATE public.lead_conversas SET primeira_enviada_em = now() WHERE lead_id = :'l4';
UPDATE public.leads SET anuncio_codigo = 'VIP0040' WHERE id = :'l4';
SELECT t.ok((SELECT texto FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l4') = :'msg4',
            'L18 1ª mensagem já enviada nunca é alterada');
-- Com resposta do cliente na conversa: não remonta.
INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
SELECT :orgA, id, 'cliente', 'oi', 'recebida' FROM public.lead_conversas WHERE lead_id = :'l5';
UPDATE public.leads SET anuncio_codigo = 'VIP0040' WHERE id = :'l5';
SELECT t.ok((SELECT texto FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l5' AND m.autor = 'ia') = :'msg5',
            'L19 conversa já com resposta: não remonta');
-- Isolamento: código só existe na A; lead da B com o mesmo código não usa o XML da A.
SELECT public.lead_inserir(:orgB, 'Davi', '15981110006', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'z6') AS l6 \gset
UPDATE public.leads SET anuncio_codigo = 'VIP0040' WHERE id = :'l6';
SELECT t.ok((SELECT texto FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l6') !~ '(Jardim São Carlos|vipseven)',
            'L20 isolamento: a B nunca usa o XML (nem o link) da A');
-- Texto personalizado com {link} é aceito pelo banco (o marcador não é link) e link literal continua barrado.
SELECT t.como(:admA);
SELECT t.ok(NOT t.falha($$SELECT public.lead_ia_roteiro_salvar('Oi {nome}! Aqui é a {assistente}. {link}Posso ajudar?', false)$$)
        AND t.falha($$SELECT public.lead_ia_roteiro_salvar('Veja https://x.com.br Posso ajudar?', false)$$),
            'L21 {link} aceito no texto personalizado; link literal continua barrado');
SELECT t.dono();
SELECT public.lead_inserir(:orgA, 'Eva', '15981110007', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'z7') AS l7 \gset
UPDATE public.leads SET anuncio_codigo = 'VIP0040' WHERE id = :'l7';
SELECT t.ok((SELECT texto FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id WHERE cv.lead_id = :'l7')
  = 'Oi Eva! Aqui é a Nicole. Anúncio: https://vipsevenimoveis.com.br/imovel/VIP0040 Posso ajudar?', 'L22 texto personalizado recebe o link pelo marcador');

-- 4) Telas: mapa e Feedback continuam só com venda ----------------------------------------------------------
SELECT t.ok(pg_get_functiondef('public.mapa_anuncios_xml()'::regprocedure) ~ 'l\.negocio = ''venda'''
        AND pg_get_functiondef('public.feedback_xml_base()'::regprocedure) ~ 'l\.negocio = ''venda''',
            'L23 mapa_anuncios_xml e feedback_xml_base filtram negocio = venda');
SELECT t.ok((SELECT column_default FROM information_schema.columns WHERE table_name = 'lead_config' AND column_name = 'ia_nome') = '''Nicole''::text',
            'L24 nome padrão da IA para imobiliária nova: Nicole');

-- 5) Permissões ------------------------------------------------------------------------------------------
SELECT t.como(:admA);
SELECT t.ok(t.falha($$SELECT public.lead_ia_xml_frase_msg(NULL::public.remax_xml_listings, 'venda')$$)
        AND t.falha($$SELECT public.remax_xml_ingest('aaaaaaaa-0000-0000-0000-000000000000', '[]', 0, now(), 'generico')$$)
        AND t.falha($$SELECT public.lead_ia_ficha_xml('aaaaaaaa-0000-0000-0000-000000000000', 'VIP0040')$$),
            'L25 app não chama as funções internas, a ficha nem a coleta');
SELECT t.dono();

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT 'FAIL ' || label FROM t.res WHERE NOT ok;
