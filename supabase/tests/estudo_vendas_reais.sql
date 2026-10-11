-- Suíte de estudo_vendas_reais (migration 20261011100000). Roda DENTRO de transação revertida
-- (run-estudo-vendas-reais.sh), só em homologação/clone. A = Única (…0001), B = agencia-b-homolog.
-- Dados 100% fictícios, marcados QA-EVR-%.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION pg_temp.h(_t text) RETURNS text LANGUAGE sql AS
  $$ SELECT encode(extensions.digest(_t, 'sha256'), 'hex') $$;

-- 0) Rua sem número: formatos reais (anonimizados) do ADM ------------------------------------------
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua das Acácias, 412 - Apto 31', '412', 'Apto 31') = 'Rua das Acácias', 'vírgula + número + apto -> só a rua');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua Maria Exemplo 375 Quadra Bl 1 Lote', '375', NULL) = 'Rua Maria Exemplo', 'número solto + quadra/bloco/lote cortados');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua: Jose Exemplo Quadra: J Lote Jardim Residencial', NULL, NULL) = 'Rua Jose Exemplo', '"Rua:" e "Quadra:" -> só a rua');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua 02', '15', NULL) = 'Rua 02', 'mantém rua cujo nome é número');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua 17 Vivalegro', '80', NULL) = 'Rua 17 Vivalegro', 'mantém "Rua 17 Vivalegro"');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Avenida 31 de Março', '1200', NULL) = 'Avenida 31 de Março', 'mantém "Avenida 31 de Março"');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Av. Brasil nº 1500 bloco B', '1500', 'bloco B') = 'Av. Brasil', 'nº e bloco cortados');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua da Penha (fundos)', NULL, NULL) = 'Rua da Penha', 'parênteses cortados');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua Sem Saída S/N', NULL, NULL) = 'Rua Sem Saída', 'S/N cortado');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua X, 18015-000', NULL, NULL) = 'Rua X', 'CEP cortado');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua 15', '15', NULL) IS NULL, 'trava: se o número da casa sobrar, não devolve a rua');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('Rua Treze Apto 31', NULL, 'Apto 31') = 'Rua Treze', 'complemento no texto cortado');
SELECT pg_temp.ok(public.estudo_rua_sem_numero('', NULL, NULL) IS NULL AND public.estudo_rua_sem_numero(NULL, NULL, NULL) IS NULL, 'vazio -> NULL');

-- 1) Fixtures: A e B, assinadas/não assinadas, dentro/fora de 12 meses ------------------------------
SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
CREATE TEMP TABLE fx(cod text PRIMARY KEY, id uuid);
DO $fx$
DECLARE _a uuid := '00000000-0000-4000-8000-000000000001'; _b uuid := '2a000000-0000-4000-8000-0000000000b0';
        _ca uuid; _cb uuid; _id uuid; r record; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT ur.user_id INTO STRICT _ca FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
    WHERE ur.organization_id = _a AND ur.role = 'admin' ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO STRICT _cb FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
    WHERE ur.organization_id = _b AND ur.role = 'admin' ORDER BY 1 LIMIT 1;
  FOR r IN SELECT * FROM (VALUES
    -- org, cod, status, rua, numero, complemento, bairro, cidade, tipo, area, valor, dias atrás
    (_a, 'QA-EVR-A1', 'contrato_assinado',   'Rua das Acácias, 412 - Apto 31', '412', 'Apto 31', 'Jardim EVR QA', 'Sorocaba', 'Apartamento', 80::numeric, 400000::numeric, 30),
    (_a, 'QA-EVR-A2', 'ocorrencia_concluida', 'Avenida QA Norte 9876', '9876', NULL, 'Centro EVR QA', 'Sorocaba', 'Casa', NULL, 650000, 200),
    (_a, 'QA-EVR-A3', 'contrato_assinado',   'Rua Terreno QA 55', '55', 'Lote 7', 'Bairro EVR QA', 'Sorocaba', 'Terreno', 300, 240000, 60),
    (_a, 'QA-EVR-A4', 'contrato_assinado',   'Rua Antiga QA 10', '10', NULL, 'Velho EVR QA', 'Sorocaba', 'Casa', 100, 300000, 400),
    (_a, 'QA-EVR-A5', 'em_elaboracao_contrato', 'Rua Rascunho QA 11', '11', NULL, 'Bairro EVR QA', 'Sorocaba', 'Casa', 100, 300000, 10),
    (_a, 'QA-EVR-A6', 'cancelada',           'Rua Cancelada QA 12', '12', NULL, 'Bairro EVR QA', 'Sorocaba', 'Casa', 100, 300000, 10),
    (_a, 'QA-EVR-A7', 'aguardando_assinatura', 'Rua Aguardando QA 13', '13', NULL, 'Bairro EVR QA', 'Sorocaba', 'Casa', 100, 300000, 10),
    (_b, 'QA-EVR-B1', 'contrato_assinado',   'Rua Campinas QA 777', '777', NULL, 'Cambuí EVR QA', 'Campinas', 'Apartamento', 70, 560000, 20)
  ) v(org, cod, st, rua, num, compl, bairro, cidade, tipo, area, valor, dias) LOOP
    INSERT INTO public.sales (organization_id, corretor_id, status, modalidade, codigo_interno, imovel_id,
      imovel_endereco, imovel_logradouro, imovel_numero, imovel_complemento, imovel_bairro, imovel_cidade, imovel_uf,
      valor_negociado, valor_total_comissao, data_assinatura, tipo_imovel,
      area_util_m2, area_terreno_m2, quartos, vagas)
    VALUES (r.org, CASE WHEN r.org = _a THEN _ca ELSE _cb END, r.st::public.sale_status, 'padrao', r.cod, r.cod,
      r.rua, r.rua, r.num, r.compl, r.bairro, r.cidade, 'SP', r.valor, r.valor * 0.06, _hoje - r.dias, r.tipo,
      CASE WHEN r.tipo <> 'Terreno' THEN r.area END, CASE WHEN r.tipo = 'Terreno' THEN r.area END,
      CASE WHEN r.tipo <> 'Terreno' THEN 3 END, CASE WHEN r.tipo <> 'Terreno' THEN 2 END)
    RETURNING id INTO _id;
    INSERT INTO fx VALUES (r.cod, _id);
    IF r.st IN ('contrato_assinado', 'ocorrencia_concluida', 'cancelada') THEN
      INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
      VALUES (_id, r.org, 'contrato_assinado',
              ((_hoje - r.dias)::timestamp + time '15:00') AT TIME ZONE 'America/Sao_Paulo');
    END IF;
  END LOOP;
END $fx$;
INSERT INTO public.estudo_vendas_api_keys (organization_id, key_hash, label) VALUES
  (:'org_a', pg_temp.h('qa-chave-A-ficticia-0123456789abcdef'), 'QA A'),
  (:'org_b', pg_temp.h('qa-chave-B-ficticia-0123456789abcdef'), 'QA B'),
  (:'org_a', pg_temp.h('qa-chave-A-revogada-0123456789abcdef'), 'QA A revogada');
UPDATE public.estudo_vendas_api_keys SET revoked_at = now() WHERE label = 'QA A revogada';

-- 2) Resultado como service_role (quem a Edge Function usa) ----------------------------------------
CREATE TEMP TABLE ra AS SELECT * FROM public.estudo_vendas_reais(repeat('0', 64)) WITH NO DATA;
CREATE TEMP TABLE rb AS SELECT * FROM ra WITH NO DATA;
GRANT ALL ON ra, rb TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO ra SELECT * FROM public.estudo_vendas_reais(pg_temp.h('qa-chave-A-ficticia-0123456789abcdef'));
INSERT INTO rb SELECT * FROM public.estudo_vendas_reais(pg_temp.h('qa-chave-B-ficticia-0123456789abcdef'));
RESET ROLE;

SELECT pg_temp.ok((SELECT count(*) FROM ra WHERE bairro LIKE '% EVR QA') = 3, 'A recebe só as 3 vendas assinadas dos últimos 12 meses (A1, A2, A3)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM ra WHERE rua ~ '(Antiga|Rascunho|Cancelada|Aguardando)'),
  'fora: assinada há mais de 12 meses, em elaboração, cancelada e aguardando assinatura');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM ra WHERE cidade = 'Campinas' OR bairro LIKE 'Cambuí EVR%'), 'isolamento: A não vê venda de B');
SELECT pg_temp.ok((SELECT count(*) FROM rb WHERE bairro LIKE '% EVR QA') = 1 AND NOT EXISTS (SELECT 1 FROM rb WHERE bairro LIKE '% EVR QA' AND cidade = 'Sorocaba'),
  'isolamento: B vê só a própria venda');
SELECT pg_temp.ok((SELECT rua FROM ra WHERE bairro = 'Jardim EVR QA') = 'Rua das Acácias', 'A1: rua sem número e sem apto');
SELECT pg_temp.ok((SELECT rua FROM ra WHERE bairro = 'Centro EVR QA') = 'Avenida QA Norte', 'A2: rua sem número');
SELECT pg_temp.ok((SELECT preco_m2 FROM ra WHERE bairro = 'Jardim EVR QA') = 5000, 'A1: R$/m² = valor / área útil');
SELECT pg_temp.ok((SELECT preco_m2 IS NULL AND area_m2 IS NULL FROM ra WHERE bairro = 'Centro EVR QA'), 'A2 sem área: aparece sem R$/m²');
SELECT pg_temp.ok((SELECT area_m2 = 300 AND preco_m2 = 800 FROM ra WHERE bairro = 'Bairro EVR QA'), 'Terreno usa área do terreno');
SELECT pg_temp.ok((SELECT mes_assinatura ~ '^\d{4}-\d{2}$' FROM ra WHERE bairro = 'Jardim EVR QA'), 'só o mês da assinatura (AAAA-MM), nunca o dia');

-- Nenhum número da casa, complemento, código, nome ou CPF em NENHUMA coluna de saída
SELECT pg_temp.ok(NOT EXISTS (
  SELECT 1 FROM (SELECT row_to_json(x)::text j FROM ra x UNION ALL SELECT row_to_json(y)::text FROM rb y) t
  WHERE j ~ '(412|9876|"55"| 55|Apto|Lote 7|777|QA-EVR)'), 'saída sem número, complemento e código do imóvel');
SELECT pg_temp.ok(NOT EXISTS (
  SELECT 1 FROM ra x, fx f, public.sales s JOIN public.profiles p ON p.id = s.corretor_id
   WHERE s.id = f.id AND position(p.nome IN row_to_json(x)::text) > 0 AND length(p.nome) > 2),
  'saída sem nome do corretor');
SELECT pg_temp.ok((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
   WHERE attrelid = 'pg_temp.ra'::regclass AND attnum > 0 AND NOT attisdropped)
  = ARRAY['tipo_imovel','area_m2','valor_venda','preco_m2','mes_assinatura','rua','bairro','cidade','uf','quartos','suites','banheiros','vagas','modalidade'],
  'contrato de colunas: só a lista permitida (sem id, código, pessoas, comissão, coordenada)');

-- 3) Chave: inválida, revogada, ausente -> erro; sem acesso para anon/authenticated -----------------
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.estudo_vendas_reais(pg_temp.h('chave-que-nao-existe'))$q$) = '28000', 'chave desconhecida -> recusada');
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.estudo_vendas_reais(pg_temp.h('qa-chave-A-revogada-0123456789abcdef'))$q$) = '28000', 'chave revogada -> recusada');
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.estudo_vendas_reais('nao-e-hash')$q$) = '28000', 'formato inválido -> recusado');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.estudo_vendas_reais(pg_temp.h('qa-chave-A-ficticia-0123456789abcdef'))$q$) = '42501', 'authenticated não executa a função');
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.estudo_vendas_api_keys$q$) = '42501', 'authenticated não lê as chaves');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err($q$SELECT * FROM public.estudo_vendas_reais(pg_temp.h('qa-chave-A-ficticia-0123456789abcdef'))$q$) = '42501', 'anon não executa a função');
RESET ROLE;
SELECT pg_temp.ok(NOT has_table_privilege('service_role', 'public.estudo_vendas_api_keys', 'INSERT,UPDATE,DELETE'),
  'service_role só lê as chaves (cadastro de chave é ação de administrador do banco)');
SELECT pg_temp.ok((SELECT provolatile = 's' AND NOT prosecdef FROM pg_proc WHERE oid = 'public.estudo_vendas_reais(text)'::regprocedure),
  'função STABLE e SECURITY INVOKER (não escreve, não sobe privilégio)');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
