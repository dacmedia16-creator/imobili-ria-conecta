-- Testes da migration 20261027090000 (Nicole oferece imóvel parecido do XML, card t_232e13cb) em PostgreSQL
-- descartável com 2 imobiliárias (A e B). Dados 100% fictícios. Uso: bash scripts/leads-ia-test/test_parecido.sh
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
-- Códigos dos itens devolvidos, na ordem.
CREATE FUNCTION t.cods(_r jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(i->>'codigo', ',' ORDER BY o), '') FROM jsonb_array_elements(_r->'itens') WITH ORDINALITY AS x(i, o) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set admB '''b0000000-0000-0000-0000-00000000000a'''
\set c1 '''a0000000-0000-0000-0000-0000000000c1'''
\set capA '''cccccccc-0000-0000-0000-000000000001'''

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
INSERT INTO public.exclusive_captures (id, organization_id, captor_id, form_data, status) VALUES
 (:capA, :orgA, :c1, '{"imovel":{"tipo_imovel":"Apartamento","bairro":"Campolim","municipio":"Sorocaba"}}', 'aprovada');
SELECT t.como(:admA); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.como(:admB); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.dono();

-- Catálogo A (preço do pedido P1 = 600 mil; ±15% = 510 a 690 mil). Mesmo condomínio = mesma rua+número.
SELECT public.remax_xml_ingest(:orgA, '[
 {"code":"P1","tipo":"apartamento","rua":"Av. A","numero":"100","bairro":"Campolim","cidade":"Sorocaba","quartos":3,"area_util":90,"preco":600000,"url":"https://imob.exemplo.test/imovel/P1"},
 {"code":"C1","tipo":"apartamento","rua":"Av. A","numero":"100","bairro":"Campolim","cidade":"Sorocaba","quartos":3,"area_util":88,"preco":680000},
 {"code":"B1","tipo":"apartamento","rua":"Rua B","numero":"5","bairro":"Campolim","cidade":"Sorocaba","quartos":3,"area_util":85,"preco":590000},
 {"code":"B2","tipo":"apartamento","rua":"Rua C","numero":"9","bairro":"Parque Campolim","cidade":"Sorocaba","quartos":2,"area_util":70,"preco":520000},
 {"code":"O1","tipo":"apartamento","rua":"Rua D","numero":"1","bairro":"Centro","cidade":"Sorocaba","quartos":3,"area_util":95,"preco":605000},
 {"code":"CARO","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","preco":900000},
 {"code":"CASA","tipo":"casa","bairro":"Campolim","cidade":"Sorocaba","preco":600000},
 {"code":"VOTO","tipo":"apartamento","bairro":"Campolim","cidade":"Votorantim","preco":600000},
 {"code":"SEMP","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba"},
 {"code":"SAI1","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","preco":600000}
]'::jsonb, 10, now(), 'generico') ->> 'status' AS s1 \gset
-- Catálogo B: mesmo bairro/cidade, outra imobiliária (nunca pode aparecer para A).
SELECT public.remax_xml_ingest(:orgB, '[
 {"code":"BX1","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","preco":600000},
 {"code":"P1","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","preco":610000}
]'::jsonb, 2, now(), 'generico') IS NOT NULL;

SELECT public.lead_inserir(:orgA, 'Maria', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'p1') AS l1 \gset
UPDATE public.leads SET anuncio_codigo = 'P1', portal_transacao = 'venda' WHERE id = :'l1';
SELECT id AS cv1 FROM public.lead_conversas WHERE lead_id = :'l1' \gset

-- 1) Regra do parecido ---------------------------------------------------------------------------------
SELECT public.lead_ia_imoveis_parecidos(:'cv1', '{}', NULL, NULL, NULL, 'venda', 3) AS r1 \gset
SELECT t.ok(t.cods(:'r1') = 'C1,B1,SAI1', 'P01 ordem: mesmo condomínio, depois mesmo bairro, depois quartos e preço mais perto (±15%; "Parque Campolim" não é Campolim)');
SELECT t.ok(t.cods(:'r1') !~ '(P1|CARO|CASA|VOTO|SEMP|BX1)', 'P02 nunca: o próprio pedido, fora de ±15%, outro tipo, outra cidade, sem preço, outra imobiliária');
SELECT t.ok((:'r1')::jsonb -> 'itens' -> 0 ->> 'mesmo_condominio' = 'true' AND (:'r1')::jsonb -> 'itens' -> 0 ->> 'preco' = 'R$ 680.000,00'
        AND (:'r1')::jsonb -> 'referencia' ->> 'codigo' = 'P1' AND (:'r1')::jsonb -> 'referencia' ->> 'no_xml' = 'true',
            'P03 item com preço formatado e marca de mesmo condomínio; referência = pedido no XML');
SELECT t.ok(NOT ((:'r1')::jsonb -> 'itens' -> 0 ?| ARRAY['rua','numero','disponivel','aceita_permuta','aceita_financiamento','andar','corretor_nome','corretor_telefone']),
            'P04 item sem endereço, contato, disponibilidade, permuta, financiamento ou andar');
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos(:'cv1', ARRAY['C1','b1'], NULL, NULL, NULL, 'venda', 3)) = 'SAI1,O1,B2',
            'P05 nunca repete os já oferecidos (sem diferença de maiúsculas)');
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos(:'cv1', '{}', NULL, NULL, NULL, 'venda', 1)) = 'C1'
        AND t.cods(public.lead_ia_imoveis_parecidos(:'cv1', '{}', NULL, NULL, NULL, 'venda', 99)) = 'C1,B1,SAI1',
            'P06 1 por vez; no máximo 3 mesmo pedindo mais');
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos(:'cv1', '{}', NULL, 560000, NULL, 'venda', 3)) = 'B2'
        AND t.cods(public.lead_ia_imoveis_parecidos(:'cv1', '{}', 850000, 950000, NULL, 'venda', 3)) = 'CARO',
            'P07 faixa do cliente substitui o ±15%');
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos(:'cv1', '{}', NULL, NULL, 'centro', 'venda', 3)) = 'O1',
            'P08 bairro desejado pelo cliente filtra');
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos(:'cv1', '{}', NULL, NULL, NULL, 'venda', 3, true)) = 'B1,B2',
            'P09 "mais barato": só abaixo do preço do pedido');
SELECT t.ok(public.lead_ia_imoveis_parecidos(:'cv1', '{}', NULL, NULL, NULL, 'locacao', 3) -> 'itens' = '[]'::jsonb,
            'P10 locação: nunca oferece venda');

-- 2) Pedido que saiu do XML, código informado na conversa, captação ----------------------------------------
SELECT public.remax_xml_ingest(:orgA, '[
 {"code":"P1","tipo":"apartamento","rua":"Av. A","numero":"100","bairro":"Campolim","cidade":"Sorocaba","preco":600000},
 {"code":"C1","tipo":"apartamento","rua":"Av. A","numero":"100","bairro":"Campolim","cidade":"Sorocaba","preco":680000},
 {"code":"B1","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","preco":590000},
 {"code":"B2","tipo":"apartamento","bairro":"Parque Campolim","cidade":"Sorocaba","preco":520000},
 {"code":"O1","tipo":"apartamento","bairro":"Centro","cidade":"Sorocaba","preco":605000},
 {"code":"CARO","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","preco":900000},
 {"code":"CASA","tipo":"casa","bairro":"Campolim","cidade":"Sorocaba","preco":600000},
 {"code":"VOTO","tipo":"apartamento","bairro":"Campolim","cidade":"Votorantim","preco":600000},
 {"code":"SEMP","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba"}
]'::jsonb, 9, now(), 'generico') IS NOT NULL;
SELECT public.lead_inserir(:orgA, 'Joao', '15981110002', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'p2') AS l2 \gset
UPDATE public.leads SET anuncio_codigo = 'SAI1' WHERE id = :'l2';
SELECT public.lead_ia_imoveis_parecidos((SELECT id FROM public.lead_conversas WHERE lead_id = :'l2'), '{}', NULL, NULL, NULL, 'venda', 1) AS r2 \gset
SELECT t.ok((:'r2')::jsonb -> 'referencia' ->> 'saiu' = 'true' AND t.cods(:'r2') = 'P1',
            'P11 pedido que saiu do XML: marca "saiu" e ainda acha parecido pelos dados antigos');
SELECT public.lead_inserir(:orgA, 'Lead Grupo ZAP', '15981110003', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'p3') AS l3 \gset
SELECT id AS cv3 FROM public.lead_conversas WHERE lead_id = :'l3' \gset
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos(:'cv3', '{}', NULL, NULL, NULL, 'venda', 1)) = ''
        AND t.cods(public.lead_ia_imoveis_parecidos(:'cv3', '{}', NULL, NULL, NULL, 'venda', 1, false, 'p1')) = 'C1',
            'P12 sem imóvel = nada; com o código informado no turno = acha');
UPDATE public.lead_conversas SET dados = '{"imovel_xml_codigo":"P1"}' WHERE id = :'cv3';
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos(:'cv3', '{}', NULL, NULL, NULL, 'venda', 1)) = 'C1',
            'P13 código guardado na conversa vale nos turnos seguintes');
SELECT public.lead_inserir(:orgA, 'Ana', '15981110004', NULL, 'olx', NULL, :capA, NULL, false, NULL, 'p4') AS l4 \gset
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos((SELECT id FROM public.lead_conversas WHERE lead_id = :'l4'), '{}', 500000, 620000, NULL, 'venda', 3)) = 'B1,P1,B2',
            'P14 lead de captação (sem XML): usa tipo/bairro/cidade da captação e a faixa do cliente');
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos((SELECT id FROM public.lead_conversas WHERE lead_id = :'l4'), '{}', NULL, NULL, NULL, 'venda', 3)) = '',
            'P15 sem preço do pedido e sem faixa do cliente: não chuta');

-- 3) Isolamento e permissões -------------------------------------------------------------------------------
SELECT public.lead_inserir(:orgB, 'Bia', '15981110005', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'b1') AS lb \gset
UPDATE public.leads SET anuncio_codigo = 'P1' WHERE id = :'lb';
SELECT t.ok(t.cods(public.lead_ia_imoveis_parecidos((SELECT id FROM public.lead_conversas WHERE lead_id = :'lb'), '{}', NULL, NULL, NULL, 'venda', 3)) = 'BX1',
            'P16 isolamento: conversa da B só vê o catálogo da B (mesmo código P1)');
SELECT t.ok(public.lead_ia_imoveis_parecidos(gen_random_uuid(), '{}') IS NULL, 'P17 conversa inexistente = nada');
SELECT t.ok(t.falha(format('SELECT public.lead_ia_imoveis_parecidos(%L, ''{}'', NULL, NULL, NULL, ''aluguel'')', :'cv1'))
        AND t.falha(format('SELECT public.lead_ia_imoveis_parecidos(%L, ''{}'', -1)', :'cv1'))
        AND t.falha(format('SELECT public.lead_ia_imoveis_parecidos(%L, ''{}'', NULL, NULL, NULL, ''venda'', 1, false, repeat(''x'', 61))', :'cv1')),
            'P18 entrada inválida recusada (negócio, faixa, código longo)');
SELECT t.como(:admA);
SELECT t.ok(t.falha(format('SELECT public.lead_ia_imoveis_parecidos(%L)', :'cv1')), 'P19 app (usuário logado) não chama a busca; só o servidor');
SELECT t.dono();
SELECT t.ok((SELECT count(*) FROM public.remax_xml_listings) = 12 AND (SELECT dados FROM public.lead_conversas WHERE id = :'cv1') = '{}'::jsonb,
            'P20 só leitura: nenhum imóvel nem conversa alterados pela busca');

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT 'FAIL ' || label FROM t.res WHERE NOT ok;
