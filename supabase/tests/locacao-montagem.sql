-- Executado após o preparo fictício de locacao-ficha.sql (linhas 1–207), em transação desfeita.
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.locacao_montagem'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.locacao_montagem', 'SELECT')
  AND NOT has_function_privilege('anon', 'public.locacao_montagem_ler(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.locacao_montagem_ler(uuid)', 'EXECUTE'),
  'RLS ligada; tabela fechada; só RPC autenticada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_ler(%L)', pg_temp.id('L'))) IS NULL,
  'contratos lê montagem quando os documentos estão completos');
SELECT pg_temp.put('mont', public.locacao_montagem_ler(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('mont')->'contrato'->>'prop_nome' = 'Proprietária Fictícia'
  AND pg_temp.j('mont')->'contrato'->>'loc_nome' = 'Locatário Exemplo (fictício)'
  AND pg_temp.j('mont')->'contrato'->>'fia_nome' = 'Fiador Fictício',
  'dados dos documentos e candidato entram pré-preenchidos');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_salvar(%L, %L)', pg_temp.id('L'), '{"campo_inventado":"x"}')) LIKE '22023%', 'campo não permitido negado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_salvar(%L, %L)', pg_temp.id('L'), '{"d_loc_nome":4}')) LIKE '22023%', 'tipo não string negado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_salvar(%L, %L)', pg_temp.id('L'), '{"d_dia_vencimento":"30"}')) LIKE '22023%', 'vencimento fora do limite negado');
SELECT public.locacao_montagem_salvar(pg_temp.id('L'), '{"d_prop_nome":"Locadora Corrigida (fictícia)","imovel_endereco":"Rua Exemplo, 10","aluguel":"2400.00","nota_fiscal":"sim","irrf":"nao","dimob":"sim","repasse_tipo":"manual","repasse_dias_uteis":"4","conta_bancaria":"Conta Teste 1","cobranca":"mes_vencido"}');
SELECT pg_temp.ok(public.locacao_montagem_ler(pg_temp.id('L'))->'campos'->>'d_prop_nome' = 'Locadora Corrigida (fictícia)'
  AND public.locacao_montagem_ler(pg_temp.id('L'))->'campos'->>'aluguel' = '2400.00'
  AND public.locacao_montagem_ler(pg_temp.id('L'))->'campos'->>'dimob' = 'sim',
  'correção e opções de tributação/financeiro persistidas sem executar financeiro');
SELECT public.locacao_montagem_salvar(pg_temp.id('L'), '{"prop_sexo":"feminino","loc_sexo":"masculino","fia_sexo":"masculino"}');
SELECT pg_temp.ok(public.locacao_montagem_ler(pg_temp.id('L'))->'campos'->>'prop_sexo' = 'feminino'
  AND public.locacao_montagem_ler(pg_temp.id('L'))->'campos'->>'loc_sexo' = 'masculino',
  'sexo gramatical da montagem persistido');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_salvar(%L, %L)', pg_temp.id('L'), '{"prop_sexo":"neutro"}')) LIKE '22023%', 'sexo inválido negado');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_ler(%L)', pg_temp.id('L'))) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.locacao_montagem_salvar(%L, %L)', pg_temp.id('L'), '{"numero":"x"}')) LIKE '42501%',
  'corretor não lê nem altera a montagem do setor de contratos');
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_ler(%L)', pg_temp.id('L'))) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.locacao_montagem_salvar(%L, %L)', pg_temp.id('L'), '{"numero":"x"}')) LIKE '42501%',
  'outra imobiliária não lê nem altera a montagem');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT public.locacao_config_salvar(jsonb_build_object('documentos', (public.locacao_contexto()->'config'->'documentos')
  || jsonb_build_object('fiador', (public.locacao_contexto()->'config'->'documentos'->'fiador')
       || '["Documento novo obrigatório (fictício)"]'::jsonb)));
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_ler(%L)', pg_temp.id('L'))) LIKE '22023%Montar contrato travado%'
  AND pg_temp.err(format('SELECT public.locacao_montagem_salvar(%L, %L)', pg_temp.id('L'), '{"numero":"x"}')) LIKE '22023%Montar contrato travado%',
  'mudança da lista invalida imediatamente leitura e gravação');
SELECT 'TOTAL=' || count(*) || ' PASS=' || count(*) FILTER (WHERE ok) || ' FAIL=' || count(*) FILTER (WHERE NOT ok) FROM r;
SELECT msg FROM r WHERE NOT ok;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM r WHERE NOT ok) THEN
  RAISE EXCEPTION 'Suíte montagem falhou' USING ERRCODE = 'P0001';
END IF; END $$;
