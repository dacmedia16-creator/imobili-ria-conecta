-- Teste RLS/RPC da migration 20261016220000_dados_pagamento_equipe (card t_a4ef3b48).
-- Uso (homologação, nunca produção): roda tudo numa transação e termina em ROLLBACK.
--   sed '/^BEGIN;$/d;/^COMMIT;$/d' supabase/migrations/20261016220000_dados_pagamento_equipe.sql > /tmp/mig.sql
--   psql "$HOMOLOG" -v ON_ERROR_STOP=1 -v mig=/tmp/mig.sql -f scripts/test-dados-pagamento-equipe.sql
-- Fixtures UE (org 00000000-0000-4000-8000-000000000001): ...01 admin, ...02 gestor, ...03 corretor,
-- ...04 financeiro. Venda 15000000-0000-4000-8000-000000000001.
\set QUIET on
BEGIN;
\i :mig
-- Equipe da venda de teste: captador = corretor (03), vendedor = gestor (02).
UPDATE public.sales SET corretor_captador_id = '10000000-0000-4000-8000-000000000003',
                        corretor_vendedor_id = '10000000-0000-4000-8000-000000000002', status = 'rascunho'
 WHERE id = '15000000-0000-4000-8000-000000000001';

CREATE TEMP TABLE resultado(n serial, caso text, ok boolean, detalhe text);
GRANT ALL ON resultado TO authenticated; GRANT ALL ON SEQUENCE resultado_n_seq TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.como(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _uid, true);
END $$;

-- 1) Corretor salva o próprio cadastro (conta + PIX)
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('10000000-0000-4000-8000-000000000003');
INSERT INTO public.corretor_dados_pagamento (titular, documento, tipo_conta, banco, agencia, conta, pix_tipo, pix_chave)
VALUES ('UE Corretor', '12345678901', 'corrente', 'Banco Teste', '1234', '98765-4', 'cpf', '12345678901');
INSERT INTO resultado(caso, ok) SELECT '01 corretor grava o próprio cadastro', count(*) = 1
  FROM public.corretor_dados_pagamento WHERE user_id = '10000000-0000-4000-8000-000000000003';

-- 2) Corretor tenta gravar cadastro de outra pessoa -> bloqueado
DO $$ BEGIN
  INSERT INTO public.corretor_dados_pagamento (user_id, titular) VALUES ('10000000-0000-4000-8000-000000000002', 'X');
  INSERT INTO resultado(caso, ok) VALUES ('02 corretor NÃO grava cadastro de outro', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('02 corretor NÃO grava cadastro de outro', true);
END $$;

-- 3) Admin tenta gravar/alterar cadastro do corretor -> bloqueado (insert falha; update afeta 0 linhas)
SELECT pg_temp.como('10000000-0000-4000-8000-000000000001');
DO $$ DECLARE _n int; BEGIN
  BEGIN
    INSERT INTO public.corretor_dados_pagamento (user_id, titular) VALUES ('10000000-0000-4000-8000-000000000002', 'X');
    INSERT INTO resultado(caso, ok) VALUES ('03a admin NÃO cria cadastro de outro', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO resultado(caso, ok) VALUES ('03a admin NÃO cria cadastro de outro', true);
  END;
  UPDATE public.corretor_dados_pagamento SET pix_chave = 'golpe' WHERE user_id = '10000000-0000-4000-8000-000000000003';
  GET DIAGNOSTICS _n = ROW_COUNT;
  INSERT INTO resultado(caso, ok, detalhe) VALUES ('03b admin NÃO altera cadastro do corretor', _n = 0, _n || ' linhas');
END $$;

-- 4) Leitura do cadastro: admin e financeiro veem; gestor não
INSERT INTO resultado(caso, ok) SELECT '04a admin lê cadastro do corretor', count(*) = 1 FROM public.corretor_dados_pagamento;
SELECT pg_temp.como('10000000-0000-4000-8000-000000000004');
INSERT INTO resultado(caso, ok) SELECT '04b financeiro lê cadastro do corretor', count(*) = 1 FROM public.corretor_dados_pagamento;
SELECT pg_temp.como('10000000-0000-4000-8000-000000000002');
INSERT INTO resultado(caso, ok) SELECT '04c gestor NÃO lê cadastro do corretor', count(*) = 0 FROM public.corretor_dados_pagamento;

-- 5) Escrita direta na cópia da venda -> sem permissão (só RPC)
SELECT pg_temp.como('10000000-0000-4000-8000-000000000003');
DO $$ BEGIN
  INSERT INTO public.sale_dados_pagamento (organization_id, sale_id, user_id, modo)
  VALUES ('00000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000003', 'imobiliaria');
  INSERT INTO resultado(caso, ok) VALUES ('05 escrita direta na cópia bloqueada', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('05 escrita direta na cópia bloqueada', true);
END $$;

-- 6) Antes de gravar na venda: status vem do cadastro, completo
INSERT INTO resultado(caso, ok, detalhe)
SELECT '06 sem cópia usa cadastro (origem=cadastro, completo)', origem = 'cadastro' AND completo AND conta = '98765-4',
       origem || '/' || completo FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000003';

-- 7) Corretor grava o bloco dele usando a conta salva
SELECT public.salvar_meus_dados_pagamento_venda('15000000-0000-4000-8000-000000000001', 'conta_propria', true);
INSERT INTO resultado(caso, ok)
SELECT '07 corretor grava bloco dele (cópia do cadastro)', count(*) = 1 FROM public.sale_dados_pagamento
 WHERE user_id = '10000000-0000-4000-8000-000000000003' AND conta = '98765-4' AND modo = 'conta_propria';

-- 8) Cópia é independente: mudar o cadastro depois não altera a venda
UPDATE public.corretor_dados_pagamento SET conta = '11111-1' WHERE user_id = '10000000-0000-4000-8000-000000000003';
INSERT INTO resultado(caso, ok)
SELECT '08 mudar cadastro não altera a cópia da venda', conta = '98765-4'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000003';

-- 9) Gestor (vendedor da venda) grava "pela imobiliária" e digita conta nova salvando no cadastro
SELECT pg_temp.como('10000000-0000-4000-8000-000000000002');
SELECT public.salvar_meus_dados_pagamento_venda('15000000-0000-4000-8000-000000000001', 'imobiliaria');
INSERT INTO resultado(caso, ok)
SELECT '09a gestor marca "pela imobiliária" (completo dispensado no front)', modo = 'imobiliaria'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000002';
SELECT public.salvar_meus_dados_pagamento_venda('15000000-0000-4000-8000-000000000001', 'conta_propria', false,
  '{"titular":"UE Gestor","pix_tipo":"email","pix_chave":"gestor@teste.local"}'::jsonb, true);
INSERT INTO resultado(caso, ok)
SELECT '09b gestor digita PIX e salva no próprio cadastro', count(*) = 1 FROM public.corretor_dados_pagamento
 WHERE user_id = '10000000-0000-4000-8000-000000000002' AND pix_chave = 'gestor@teste.local';

-- 10) Gestor vê o corretor MASCARADO; vê o próprio completo
INSERT INTO resultado(caso, ok, detalhe)
SELECT '10a gestor vê dados do corretor mascarados', NOT dados_completos AND conta = '***65-4' AND pix_chave = '***8901',
       conta || ' / ' || pix_chave FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000003';
INSERT INTO resultado(caso, ok)
SELECT '10b gestor vê os próprios dados completos', dados_completos AND pix_chave = 'gestor@teste.local'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000002';
INSERT INTO resultado(caso, ok)
SELECT '10c gestor NÃO lê cópia do corretor direto na tabela', count(*) = 0 FROM public.sale_dados_pagamento
 WHERE user_id = '10000000-0000-4000-8000-000000000003';

-- 11) Financeiro vê completo
SELECT pg_temp.como('10000000-0000-4000-8000-000000000004');
INSERT INTO resultado(caso, ok)
SELECT '11 financeiro vê dados completos', bool_and(dados_completos) AND count(*) = 2
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001');

-- 12) Financeiro (não está na equipe) tenta gravar bloco -> bloqueado
DO $$ BEGIN
  PERFORM public.salvar_meus_dados_pagamento_venda('15000000-0000-4000-8000-000000000001', 'imobiliaria');
  INSERT INTO resultado(caso, ok) VALUES ('12 quem não é da equipe NÃO grava bloco', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('12 quem não é da equipe NÃO grava bloco', true);
END $$;

-- 13) Usuário de outra organização não enxerga a venda
SELECT pg_temp.como('4996f8c5-3b3d-4ea6-9f5b-671b79941a7e');
DO $$ BEGIN
  PERFORM * FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001');
  INSERT INTO resultado(caso, ok) VALUES ('13 admin de outra org NÃO lê dados da venda', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('13 admin de outra org NÃO lê dados da venda', true);
END $$;
INSERT INTO resultado(caso, ok) SELECT '13b admin de outra org NÃO lê cadastros', count(*) = 0 FROM public.corretor_dados_pagamento;

-- 14) Anônimo não executa as RPCs
RESET ROLE;
INSERT INTO resultado(caso, ok)
SELECT '14 anon sem EXECUTE nas RPCs', NOT has_function_privilege('anon', 'public.venda_dados_pagamento(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.salvar_meus_dados_pagamento_venda(uuid,text,boolean,jsonb,boolean)', 'EXECUTE')
   AND NOT has_table_privilege('anon', 'public.corretor_dados_pagamento', 'SELECT');

-- 15) Venda encerrada: corretor não altera mais
-- (triggers de fluxo desligados só nesta transação de teste: o objetivo é só simular o status final)
SET LOCAL session_replication_role = replica;
UPDATE public.sales SET status = 'ocorrencia_concluida' WHERE id = '15000000-0000-4000-8000-000000000001';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('10000000-0000-4000-8000-000000000003');
DO $$ BEGIN
  PERFORM public.salvar_meus_dados_pagamento_venda('15000000-0000-4000-8000-000000000001', 'imobiliaria');
  INSERT INTO resultado(caso, ok) VALUES ('15 venda concluída trava alteração', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('15 venda concluída trava alteração', true);
END $$;
RESET ROLE;

\set QUIET off
SELECT n, caso, CASE WHEN ok THEN 'PASSOU' ELSE 'FALHOU' END AS r, detalhe FROM resultado ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) AS total FROM resultado;

-- Rollback também precisa rodar limpo
\i :rb
SELECT 'rollback ok: ' || (to_regclass('public.corretor_dados_pagamento') IS NULL
                           AND to_regclass('public.sale_dados_pagamento') IS NULL) AS rb;
ROLLBACK;
