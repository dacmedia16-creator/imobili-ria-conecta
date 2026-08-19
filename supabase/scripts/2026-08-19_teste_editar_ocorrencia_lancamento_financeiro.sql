-- Script DESCARTÁVEL, só para o Supabase local (Docker via `supabase start`), NUNCA rodar em
-- produção. Testa editar_ocorrencia_lancamento_financeiro() (migration 20260819060000) nos cenários
-- exigidos: edição válida, usuário sem permissão, status proibido, rollback em falha no meio,
-- inclusão/alteração/remoção de comissão, reexecução sem duplicidade, e conclusão após editar. O
-- teste de concorrência (duas edições simultâneas) está num script bash separado (usa 2 sessões).

DO $$
DECLARE
  v_owner uuid := '200b4e33-27a4-49f2-bd1d-e4813f8f84cf'; -- detalhe.c, corretor+lancamento, sem financeiro
  v_pessoa_b uuid := 'ba7526db-242e-4ded-ab80-a6f0992249e7'; -- detalhe.b, corretor
  v_sale_id uuid;
  v_occ_id uuid;
  v_extra1 uuid;
  v_extra2 uuid;
BEGIN
  DELETE FROM public.sales WHERE codigo_interno = 'TESTE-EDITAR-FIN-LANC';

  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, percentual_comissao, valor_total_comissao, codigo_interno, imovel_id)
  VALUES (v_owner, 'ocorrencia_analise_financeiro', 'lancamento', 300000, 5, 15000, 'TESTE-EDITAR-FIN-LANC', 'IMOVEL-TESTE-EDITAR')
  RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_commission_extras (sale_id, papel, nome, user_id, percentual, valor, sem_cadastro_confirmado)
  VALUES (v_sale_id, 'corretor_vendedor', 'Detalhe Teste C', v_owner, 60, 9000, false)
  RETURNING id INTO v_extra1;
  INSERT INTO public.sale_commission_extras (sale_id, papel, nome, user_id, percentual, valor, sem_cadastro_confirmado)
  VALUES (v_sale_id, 'team_leader', 'Detalhe Teste B', v_pessoa_b, 20, 3000, false)
  RETURNING id INTO v_extra2;

  INSERT INTO public.occurrences (sale_id, codigo_imovel, valor_negociado, percentual_comissao, valor_comissao, status)
  VALUES (v_sale_id, 'IMOVEL-TESTE-EDITAR', 300000, 5, 15000, 'pendente')
  RETURNING id INTO v_occ_id;

  INSERT INTO public.occurrence_commissions (occurrence_id, papel, nome, user_id, percentual, valor, sale_commission_extra_id, managed_by_sale, sem_cadastro_confirmado)
  VALUES
    (v_occ_id, 'corretor_vendedor', 'Detalhe Teste C', v_owner, 60, 9000, v_extra1, true, false),
    (v_occ_id, 'team_leader', 'Detalhe Teste B', v_pessoa_b, 20, 3000, v_extra2, true, false);

  RAISE NOTICE 'sale_id=%, occ_id=%, extra1=%, extra2=%', v_sale_id, v_occ_id, v_extra1, v_extra2;
END $$;

\echo '=== SETUP: venda de teste criada ==='
SELECT id, status, valor_negociado, valor_total_comissao FROM sales WHERE codigo_interno = 'TESTE-EDITAR-FIN-LANC' \gset teste_
\echo 'sale_id capturado:'
SELECT :'teste_id' AS sale_id;

\echo ''
\echo '=== TESTE 1: edição válida (financeiro) ==='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','ffffffff-0000-0000-0000-000000000001','role','authenticated')::text, false);
SELECT jsonb_pretty(public.editar_ocorrencia_lancamento_financeiro(
  :'teste_id'::uuid,
  jsonb_build_object(
    'imovel_id', 'IMOVEL-TESTE-EDITAR-CORRIGIDO',
    'valor_negociado', 320000,
    'percentual_comissao', 5,
    'valor_total_comissao', 16000,
    'negociacao_observacoes', 'Corrigido pelo financeiro no teste'
  ),
  jsonb_build_object('financiamento', false),
  jsonb_build_array(
    jsonb_build_object('id', (SELECT id::text FROM sale_commission_extras WHERE sale_id = :'teste_id'::uuid AND papel = 'corretor_vendedor'), 'papel','corretor_vendedor','nome','Detalhe Teste C','user_id','200b4e33-27a4-49f2-bd1d-e4813f8f84cf','percentual',62.5,'valor',10000,'sem_cadastro_confirmado',false),
    jsonb_build_object('id', (SELECT id::text FROM sale_commission_extras WHERE sale_id = :'teste_id'::uuid AND papel = 'team_leader'), 'papel','team_leader','nome','Detalhe Teste B','user_id','ba7526db-242e-4ded-ab80-a6f0992249e7','percentual',18.75,'valor',3000,'sem_cadastro_confirmado',false)
  ),
  'Corretor tinha digitado o valor do imóvel errado e a comissão do vendedor não batia com o combinado — teste automatizado.'
));

\echo '--- sales após edição válida ---'
SELECT imovel_id, valor_negociado, valor_total_comissao, negociacao_observacoes FROM sales WHERE id = :'teste_id'::uuid;
\echo '--- occurrences após edição válida (deve refletir o patch) ---'
SELECT codigo_imovel, valor_negociado, valor_comissao FROM occurrences WHERE sale_id = :'teste_id'::uuid;
\echo '--- occurrence_commissions após edição válida (deve ter 2 linhas, valores atualizados) ---'
SELECT papel, nome, valor FROM occurrence_commissions WHERE occurrence_id = (SELECT id FROM occurrences WHERE sale_id = :'teste_id'::uuid) ORDER BY papel;
\echo '--- activity_logs: deve ter 1 linha lancamento_editado_financeiro com motivo ---'
SELECT payload->>'motivo' AS motivo, jsonb_pretty(payload->'resumo_alteracoes') AS resumo_alteracoes FROM activity_logs WHERE sale_id = :'teste_id'::uuid AND acao = 'lancamento_editado_financeiro';

RESET ROLE;

\echo ''
\echo '=== TESTE 2: usuário sem permissão (corretor dono, sem papel financeiro) — deve FALHAR ==='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','200b4e33-27a4-49f2-bd1d-e4813f8f84cf','role','authenticated')::text, false);
DO $$
BEGIN
  BEGIN
    PERFORM public.editar_ocorrencia_lancamento_financeiro(
      (SELECT id FROM sales WHERE codigo_interno = 'TESTE-EDITAR-FIN-LANC'),
      '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'tentativa sem permissão'
    );
    RAISE NOTICE 'FALHA DO TESTE: deveria ter levantado exceção de permissão';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK — bloqueado como esperado: %', SQLERRM;
  END;
END $$;
RESET ROLE;

\echo ''
\echo '=== TESTE 3a: status proibido — ocorrencia_concluida ==='
-- Desliga só pra manipular o dado de teste diretamente (senão os triggers de transição/validação de
-- saldo, que testam OUTRA coisa, impediriam de sequer chegar no estado que este teste precisa).
ALTER TABLE sales DISABLE TRIGGER trg_validate_sale_status;
ALTER TABLE sales DISABLE TRIGGER trg_validar_distribuicao_concluir_lancamento;
UPDATE sales SET status = 'ocorrencia_concluida' WHERE id = :'teste_id'::uuid;
ALTER TABLE sales ENABLE TRIGGER trg_validate_sale_status;
ALTER TABLE sales ENABLE TRIGGER trg_validar_distribuicao_concluir_lancamento;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','ffffffff-0000-0000-0000-000000000001','role','authenticated')::text, false);
DO $$
BEGIN
  BEGIN
    PERFORM public.editar_ocorrencia_lancamento_financeiro(
      (SELECT id FROM sales WHERE codigo_interno = 'TESTE-EDITAR-FIN-LANC'),
      jsonb_build_object('valor_negociado', 320000, 'valor_total_comissao', 16000),
      '{}'::jsonb, '[]'::jsonb, 'tentativa em status proibido'
    );
    RAISE NOTICE 'FALHA DO TESTE: deveria ter bloqueado (ocorrencia_concluida)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK — bloqueado como esperado: %', SQLERRM;
  END;
END $$;
RESET ROLE;

\echo '=== TESTE 3b: status proibido — rascunho ==='
ALTER TABLE sales DISABLE TRIGGER trg_validate_sale_status;
UPDATE sales SET status = 'rascunho' WHERE id = :'teste_id'::uuid;
ALTER TABLE sales ENABLE TRIGGER trg_validate_sale_status;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','ffffffff-0000-0000-0000-000000000001','role','authenticated')::text, false);
DO $$
BEGIN
  BEGIN
    PERFORM public.editar_ocorrencia_lancamento_financeiro(
      (SELECT id FROM sales WHERE codigo_interno = 'TESTE-EDITAR-FIN-LANC'),
      jsonb_build_object('valor_negociado', 320000, 'valor_total_comissao', 16000),
      '{}'::jsonb, '[]'::jsonb, 'tentativa em status proibido (rascunho)'
    );
    RAISE NOTICE 'FALHA DO TESTE: deveria ter bloqueado (rascunho)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK — bloqueado como esperado: %', SQLERRM;
  END;
END $$;
RESET ROLE;

\echo '=== restaura status pra análise financeiro pros próximos testes ==='
ALTER TABLE sales DISABLE TRIGGER trg_validate_sale_status;
UPDATE sales SET status = 'ocorrencia_analise_financeiro' WHERE id = :'teste_id'::uuid;
ALTER TABLE sales ENABLE TRIGGER trg_validate_sale_status;

\echo ''
\echo '=== TESTE 4: falha no meio (distribuição inválida) deve reverter TUDO ==='
\echo '--- snapshot antes da tentativa inválida ---'
SELECT count(*) AS n_extras_antes FROM sale_commission_extras WHERE sale_id = :'teste_id'::uuid;
SELECT valor_negociado AS valor_negociado_antes FROM sales WHERE id = :'teste_id'::uuid;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','ffffffff-0000-0000-0000-000000000001','role','authenticated')::text, false);
DO $$
BEGIN
  BEGIN
    PERFORM public.editar_ocorrencia_lancamento_financeiro(
      (SELECT id FROM sales WHERE codigo_interno = 'TESTE-EDITAR-FIN-LANC'),
      jsonb_build_object('valor_negociado', 999999, 'valor_total_comissao', 100),
      '{}'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', null, 'papel','outro','nome','Linha Absurda','user_id',null,'percentual',null,'valor',999999,'sem_cadastro_confirmado',true)
      ),
      'forçando inconsistência pra testar rollback'
    );
    RAISE NOTICE 'FALHA DO TESTE: deveria ter rejeitado (comissão > bruto)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK — rejeitado como esperado: %', SQLERRM;
  END;
END $$;
RESET ROLE;
\echo '--- snapshot depois da tentativa inválida (tem que ser IGUAL ao de antes) ---'
SELECT count(*) AS n_extras_depois FROM sale_commission_extras WHERE sale_id = :'teste_id'::uuid;
SELECT valor_negociado AS valor_negociado_depois FROM sales WHERE id = :'teste_id'::uuid;

\echo ''
\echo '=== TESTE 5: inclusão + alteração + remoção de comissão numa única chamada ==='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','ffffffff-0000-0000-0000-000000000001','role','authenticated')::text, false);
SELECT jsonb_pretty(public.editar_ocorrencia_lancamento_financeiro(
  :'teste_id'::uuid,
  jsonb_build_object('valor_negociado', 320000, 'valor_total_comissao', 16000),
  '{}'::jsonb,
  jsonb_build_array(
    -- mantém e altera a linha do corretor_vendedor
    jsonb_build_object('id', (SELECT id::text FROM sale_commission_extras WHERE sale_id = :'teste_id'::uuid AND papel = 'corretor_vendedor'), 'papel','corretor_vendedor','nome','Detalhe Teste C','user_id','200b4e33-27a4-49f2-bd1d-e4813f8f84cf','percentual',50,'valor',8000,'sem_cadastro_confirmado',false),
    -- OMITE a linha team_leader (remoção)
    -- inclui uma linha nova (sem id)
    jsonb_build_object('id', null, 'papel','outro','nome','Parceiro Novo','user_id',null,'percentual',null,'valor',8000,'sem_cadastro_confirmado',true)
  ),
  'Removeu team leader, ajustou vendedor e incluiu parceiro externo — teste automatizado.'
));
\echo '--- sale_commission_extras final (esperado: 2 linhas — corretor_vendedor atualizado + outro novo) ---'
SELECT papel, nome, valor, sem_cadastro_confirmado FROM sale_commission_extras WHERE sale_id = :'teste_id'::uuid ORDER BY papel;
\echo '--- occurrence_commissions final (tem que espelhar exatamente as 2 linhas acima) ---'
SELECT papel, nome, valor FROM occurrence_commissions WHERE occurrence_id = (SELECT id FROM occurrences WHERE sale_id = :'teste_id'::uuid) ORDER BY papel;
RESET ROLE;

\echo ''
\echo '=== TESTE 6: reexecução com o MESMO payload — não pode duplicar nada ==='
SELECT count(*) AS n_extras_antes_reexec FROM sale_commission_extras WHERE sale_id = :'teste_id'::uuid;
SELECT count(*) AS n_occ_comm_antes_reexec FROM occurrence_commissions WHERE occurrence_id = (SELECT id FROM occurrences WHERE sale_id = :'teste_id'::uuid);
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','ffffffff-0000-0000-0000-000000000001','role','authenticated')::text, false);
SELECT public.editar_ocorrencia_lancamento_financeiro(
  :'teste_id'::uuid,
  jsonb_build_object('valor_negociado', 320000, 'valor_total_comissao', 16000),
  '{}'::jsonb,
  (SELECT jsonb_agg(jsonb_build_object('id', id::text, 'papel', papel, 'nome', nome, 'user_id', user_id::text, 'percentual', percentual, 'valor', valor, 'sem_cadastro_confirmado', sem_cadastro_confirmado)) FROM sale_commission_extras WHERE sale_id = :'teste_id'::uuid),
  'reexecução idêntica — não pode duplicar'
) IS NOT NULL AS chamada_ok;
RESET ROLE;
SELECT count(*) AS n_extras_depois_reexec FROM sale_commission_extras WHERE sale_id = :'teste_id'::uuid;
SELECT count(*) AS n_occ_comm_depois_reexec FROM occurrence_commissions WHERE occurrence_id = (SELECT id FROM occurrences WHERE sale_id = :'teste_id'::uuid);

\echo ''
\echo '=== TESTE 7: concluir a ocorrência depois de editar (fluxo já existente continua funcionando) ==='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','ffffffff-0000-0000-0000-000000000001','role','authenticated')::text, false);
SELECT jsonb_pretty((SELECT public.calcular_distribuicao_venda(:'teste_id'::uuid))) AS distribuicao_antes_concluir;
DO $$
DECLARE
  v_dist jsonb;
BEGIN
  v_dist := public.calcular_distribuicao_venda((SELECT id FROM sales WHERE codigo_interno = 'TESTE-EDITAR-FIN-LANC'));
  PERFORM public.concluir_lancamento(
    (SELECT id FROM sales WHERE codigo_interno = 'TESTE-EDITAR-FIN-LANC'),
    (v_dist->>'saldo_imobiliaria')::numeric
  );
  RAISE NOTICE 'OK — concluir_lancamento() funcionou normalmente após a edição do financeiro';
END $$;
RESET ROLE;
SELECT status, lancamento_saldo_imobiliaria FROM sales WHERE id = :'teste_id'::uuid;
