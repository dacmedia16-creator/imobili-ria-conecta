-- Testes da migration 20261027110000 (Nicole: busca NOVA no meio da conversa, card t_5b493bc9) em PostgreSQL
-- descartável com 2 imobiliárias (A e B). Dados 100% fictícios. Uso: bash scripts/leads-ia-test/test_busca_nova.sh
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set admB '''b0000000-0000-0000-0000-00000000000a'''

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
SELECT t.como(:admA); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.como(:admB); SELECT public.lead_ia_config_salvar(true, 'Nicole', NULL);
SELECT t.dono();

-- Catálogo A: o lead é a CASA H1 (Ibiti); o cliente pede um apartamento para o filho no Campolim, até 400 mil.
SELECT public.remax_xml_ingest(:orgA, '[
 {"code":"H1","tipo":"casa","bairro":"Condominio Ibiti Reserva","cidade":"Sorocaba","quartos":3,"preco":1199000},
 {"code":"A1","tipo":"apartamento","rua":"Rua X","numero":"1","bairro":"Parque Campolim","cidade":"Sorocaba","quartos":2,"vagas":1,"area_util":60,"preco":390000,"url":"https://imob.exemplo.test/imovel/A1"},
 {"code":"A2","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","quartos":2,"area_util":55,"preco":350000},
 {"code":"A3","tipo":"apartamento","bairro":"Centro","cidade":"Sorocaba","quartos":2,"preco":395000},
 {"code":"A4","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","quartos":3,"preco":520000},
 {"code":"A5","tipo":"apartamento","bairro":"Campolim","cidade":"Votorantim","quartos":2,"preco":380000},
 {"code":"A6","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","quartos":2,"url":"http://inseguro.test/a6","preco":300000},
 {"code":"C9","tipo":"casa","bairro":"Campolim","cidade":"Sorocaba","quartos":3,"preco":390000},
 {"code":"L1","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","quartos":2,"negocio":"locacao","preco_aluguel":2500}
]'::jsonb, 9, now(), 'generico') IS NOT NULL;
-- Catálogo B: mesmo bairro/tipo/preço, outra imobiliária (nunca pode aparecer para A).
SELECT public.remax_xml_ingest(:orgB, '[
 {"code":"BX1","tipo":"apartamento","bairro":"Campolim","cidade":"Sorocaba","preco":380000}
]'::jsonb, 1, now(), 'generico') IS NOT NULL;

SELECT public.lead_inserir(:orgA, 'Cliente ZZ', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'h1') AS l1 \gset
UPDATE public.leads SET anuncio_codigo = 'H1', portal_transacao = 'venda' WHERE id = :'l1';
SELECT id AS cv1 FROM public.lead_conversas WHERE lead_id = :'l1' \gset
SELECT dados AS dados_antes FROM public.lead_conversas WHERE id = :'cv1' \gset

-- 1) Regra da busca -------------------------------------------------------------------------------------
SELECT public.lead_ia_imoveis_busca(:'cv1', 'apartamento', 'venda', NULL, 400000, 'campolim', 'Sorocaba', '{}', 3) AS r1 \gset
SELECT t.ok(t.cods(:'r1') = 'A1,A2,A6', 'B01 apartamento até 400 mil no Campolim de Sorocaba: preço mais perto do teto primeiro ("Parque Campolim" também bate)');
SELECT t.ok(t.cods(:'r1') !~ '(H1|A3|A4|A5|C9|L1|BX1)', 'B02 nunca: o imóvel do lead, outro bairro, acima da faixa, mesmo bairro em OUTRA cidade (A5), outro tipo, locação, outra imobiliária');
SELECT t.ok((:'r1')::jsonb -> 'itens' -> 0 ->> 'preco' = 'R$ 390.000' AND (:'r1')::jsonb -> 'itens' -> 0 ->> 'url' = 'https://imob.exemplo.test/imovel/A1',
            'B03 item com preço formatado e link https do XML');
SELECT t.ok(NOT ((:'r1')::jsonb -> 'itens' -> 2 ? 'url'), 'B04 link http inseguro não sai');
SELECT t.ok(NOT ((:'r1')::jsonb -> 'itens' -> 0 ?| ARRAY['rua','numero','disponivel','aceita_permuta','aceita_financiamento','andar','corretor_nome','corretor_telefone']),
            'B05 item sem endereço, contato, disponibilidade, permuta, financiamento ou andar');
SELECT t.ok(t.cods(public.lead_ia_imoveis_busca(:'cv1', 'apartamento', 'venda', NULL, 400000, 'campolim', 'Sorocaba', ARRAY['a1', 'A6'], 3)) = 'A2',
            'B06 nunca repete os já oferecidos (sem diferença de maiúsculas)');
SELECT t.ok(t.cods(public.lead_ia_imoveis_busca(:'cv1', 'apartamento', 'venda', NULL, 400000, 'campolim', 'Sorocaba', '{}', 1)) = 'A1'
        AND t.cods(public.lead_ia_imoveis_busca(:'cv1', 'apartamento', 'venda', NULL, 400000, 'campolim', 'Sorocaba', '{}', 99)) = 'A1,A2,A6',
            'B07 1 por vez; no máximo 3 mesmo pedindo mais');
SELECT t.ok(t.cods(public.lead_ia_imoveis_busca(:'cv1', 'apartamento', 'venda', NULL, 400000, NULL, 'Sorocaba', '{}', 3)) = 'A3,A1,A2'
        AND t.cods(public.lead_ia_imoveis_busca(:'cv1', 'apartamento', 'venda', NULL, 400000, 'votorantim', 'Sorocaba', '{}', 3)) = 'A5',
            'B08 sem região: cidade do imóvel do lead (Votorantim fora); se o cliente disser a cidade, vale a cidade dele');
SELECT t.ok(t.cods(public.lead_ia_imoveis_busca(:'cv1', 'apartamento', 'locacao', NULL, 3000, 'campolim', NULL, '{}', 3)) = 'L1'
        AND (public.lead_ia_imoveis_busca(:'cv1', 'apartamento', 'locacao', NULL, 3000, 'campolim', NULL, '{}', 3) -> 'itens' -> 0 ->> 'aluguel') = 'R$ 2.500',
            'B09 locação: só locação, com o aluguel');
SELECT t.ok(t.cods(public.lead_ia_imoveis_busca(:'cv1', NULL, 'venda', 380000, 400000, 'campolim', 'Sorocaba', '{}', 3)) = 'A1,C9'
        -- sem cidade nenhuma (não acontece pelo servidor), o bairro vale em qualquer cidade da própria imobiliária
        AND t.cods(public.lead_ia_imoveis_busca(:'cv1', NULL, 'venda', 380000, 400000, 'campolim', NULL, '{}', 3)) = 'A1,C9,A5',
            'B10 sem tipo = qualquer tipo; faixa mínima e máxima respeitadas');
SELECT t.ok(t.cods(public.lead_ia_imoveis_busca(:'cv1', 'cobertura', 'venda', NULL, NULL, NULL, NULL, '{}', 3)) = '',
            'B11 nada no perfil: lista vazia (a Nicole diz que vai procurar)');

-- 2) Isolamento e permissões ----------------------------------------------------------------------------
SELECT public.lead_inserir(:orgB, 'Bia', '15981110005', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'b1') AS lb \gset
SELECT t.ok(t.cods(public.lead_ia_imoveis_busca((SELECT id FROM public.lead_conversas WHERE lead_id = :'lb'), 'apartamento', 'venda', NULL, 400000, 'campolim', NULL, '{}', 3)) = 'BX1',
            'B12 isolamento: conversa da B só vê o catálogo da B');
SELECT t.ok(public.lead_ia_imoveis_busca(gen_random_uuid(), 'apartamento') IS NULL, 'B13 conversa inexistente = nada');
SELECT t.ok(t.falha(format('SELECT public.lead_ia_imoveis_busca(%L, ''apartamento'', ''aluguel'')', :'cv1'))
        AND t.falha(format('SELECT public.lead_ia_imoveis_busca(%L, ''castelo'')', :'cv1'))
        AND t.falha(format('SELECT public.lead_ia_imoveis_busca(%L, NULL, ''venda'', -1)', :'cv1'))
        AND t.falha(format('SELECT public.lead_ia_imoveis_busca(%L, NULL, ''venda'', NULL, NULL, repeat(''x'', 61))', :'cv1')),
            'B14 entrada inválida recusada (negócio, tipo, faixa, região longa)');
SELECT t.como(:admA);
SELECT t.ok(t.falha(format('SELECT public.lead_ia_imoveis_busca(%L)', :'cv1')), 'B15 app (usuário logado) não chama a busca; só o servidor');
SELECT t.dono();
SELECT t.ok((SELECT count(*) FROM public.remax_xml_listings) = 10 AND (SELECT dados FROM public.lead_conversas WHERE id = :'cv1') = (:'dados_antes')::jsonb,
            'B16 só leitura: nenhum imóvel nem conversa alterados pela busca');

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT 'FAIL ' || label FROM t.res WHERE NOT ok;
