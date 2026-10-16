-- Teste RLS/RPC dos dados para pagamento da equipe:
--   20261016220000_dados_pagamento_equipe (card t_a4ef3b48) +
--   20261016230000_pagamento_equipe_qualquer_preenche (card t_19cd1fc1: qualquer pessoa com acesso
--   à venda preenche; cadastro continua só do dono; máscara igual; registra quem preencheu).
-- Uso (homologação, nunca produção): roda tudo numa transação e termina em ROLLBACK.
--   sed '/^BEGIN;$/d;/^COMMIT;$/d' <arquivo> > /tmp/x.sql   (para as 2 migrations e os 2 rollbacks)
--   psql "$HOMOLOG" -v ON_ERROR_STOP=1 -v mig=/tmp/mig.sql -v mig2=/tmp/mig2.sql \
--        -v rb2=/tmp/rb2.sql -v rb=/tmp/rb.sql -f scripts/test-dados-pagamento-equipe.sql
--   Se a migration base já estiver aplicada no banco, passe -v mig=/dev/null.
-- Fixtures UE (org 00000000-0000-4000-8000-000000000001): ...01 admin, ...02 gestor, ...03 corretor,
-- ...04 financeiro; ebffaded-... "QA A Corretor Dois" (outro corretor da venda);
-- 5745cbff-... "QA A Corretor Um" (mesma org, sem acesso à venda); 4996f8c5-... admin de outra org.
-- Venda 15000000-0000-4000-8000-000000000001.
\set QUIET on
BEGIN;
\i :mig
\i :mig2
-- Equipe da venda de teste: captador = corretor (03), vendedor = gestor (02),
-- gestor/TL do captador = Corretor Dois (outro corretor da venda, só papel corretor).
UPDATE public.sales SET corretor_captador_id = '10000000-0000-4000-8000-000000000003',
                        corretor_vendedor_id = '10000000-0000-4000-8000-000000000002',
                        lider_captador_id = 'ebffaded-075c-493f-89e2-1d3d62901dc4', status = 'rascunho'
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

-- 7) Corretor grava o bloco dele usando a conta salva (RPC antiga continua funcionando)
SELECT public.salvar_meus_dados_pagamento_venda('15000000-0000-4000-8000-000000000001', 'conta_propria', true);
INSERT INTO resultado(caso, ok)
SELECT '07 corretor grava bloco dele (cópia do cadastro, RPC antiga)', count(*) = 1 FROM public.sale_dados_pagamento
 WHERE user_id = '10000000-0000-4000-8000-000000000003' AND conta = '98765-4' AND modo = 'conta_propria'
   AND preenchido_por = '10000000-0000-4000-8000-000000000003' AND preenchido_em IS NOT NULL;

-- 8) Cópia é independente: mudar o cadastro depois não altera a venda
UPDATE public.corretor_dados_pagamento SET conta = '11111-1' WHERE user_id = '10000000-0000-4000-8000-000000000003';
INSERT INTO resultado(caso, ok)
SELECT '08 mudar cadastro não altera a cópia da venda', conta = '98765-4'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000003';

-- 9) Gestor (vendedor da venda) grava o próprio "pela imobiliária" e depois PIX salvando no cadastro
SELECT pg_temp.como('10000000-0000-4000-8000-000000000002');
SELECT public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 'imobiliaria');
INSERT INTO resultado(caso, ok)
SELECT '09a gestor marca "pela imobiliária" no próprio bloco', modo = 'imobiliaria'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000002';
SELECT public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 'conta_propria', false,
  '{"titular":"UE Gestor","pix_tipo":"email","pix_chave":"gestor@teste.local"}'::jsonb, true);
INSERT INTO resultado(caso, ok)
SELECT '09b gestor digita PIX e salva no próprio cadastro', count(*) = 1 FROM public.corretor_dados_pagamento
 WHERE user_id = '10000000-0000-4000-8000-000000000002' AND pix_chave = 'gestor@teste.local';

-- 10) NOVO: gestor grava o bloco do corretor (conta nova) -> permitido, registra quem preencheu
SELECT public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', 'conta_propria', false,
  '{"titular":"UE Corretor","banco":"Banco Novo","agencia":"5678","conta":"22233-9","pix_tipo":"aleatoria","pix_chave":"chave-nova-abcd"}'::jsonb);
INSERT INTO resultado(caso, ok, detalhe)
SELECT '10a gestor grava o bloco do corretor e fica registrado como quem preencheu',
       preenchido_por = '10000000-0000-4000-8000-000000000002' AND preenchido_por_nome = 'UE Gestor'
       AND preenchido_em IS NOT NULL AND origem = 'venda',
       coalesce(preenchido_por_nome, '-')
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000003';
-- 10b) Máscara continua: quem preencheu (gestor) vê o corretor MASCARADO depois de salvar
INSERT INTO resultado(caso, ok, detalhe)
SELECT '10b gestor vê os dados do corretor mascarados (mesmo tendo preenchido)',
       NOT dados_completos AND conta = '***33-9' AND agencia = '***' AND pix_chave = '***abcd',
       conta || ' / ' || agencia || ' / ' || pix_chave
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000003';
INSERT INTO resultado(caso, ok)
SELECT '10c gestor vê os próprios dados completos', dados_completos AND pix_chave = 'gestor@teste.local'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000002';
INSERT INTO resultado(caso, ok)
SELECT '10d gestor NÃO lê cópia do corretor direto na tabela', count(*) = 0 FROM public.sale_dados_pagamento
 WHERE user_id = '10000000-0000-4000-8000-000000000003';

-- 11) NOVO: ninguém salva no cadastro de outra pessoa pela venda
DO $$ BEGIN
  PERFORM public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003', 'conta_propria', false,
    '{"titular":"X","pix_tipo":"email","pix_chave":"golpe@teste.local"}'::jsonb, true);
  INSERT INTO resultado(caso, ok) VALUES ('11a gestor NÃO salva no cadastro do corretor', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('11a gestor NÃO salva no cadastro do corretor', true);
END $$;
RESET ROLE;
INSERT INTO resultado(caso, ok, detalhe)
SELECT '11b cadastro do corretor ficou intacto', conta = '11111-1' AND pix_chave = '12345678901', conta
  FROM public.corretor_dados_pagamento WHERE user_id = '10000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;

-- 12) NOVO: outro corretor da venda (Corretor Dois, só papel corretor) grava o bloco do gestor
SELECT pg_temp.como('ebffaded-075c-493f-89e2-1d3d62901dc4');
SELECT public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 'imobiliaria');
INSERT INTO resultado(caso, ok)
SELECT '12a outro corretor da venda grava o bloco do gestor', modo = 'imobiliaria'
       AND preenchido_por = 'ebffaded-075c-493f-89e2-1d3d62901dc4'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000002';
INSERT INTO resultado(caso, ok, detalhe)
SELECT '12b outro corretor vê o corretor mascarado', NOT dados_completos AND conta = '***33-9', conta
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000003';

-- 13) NOVO: ADM (fora da equipe) grava o bloco de uma pessoa da equipe; vê completo
SELECT pg_temp.como('10000000-0000-4000-8000-000000000001');
SELECT public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
  'ebffaded-075c-493f-89e2-1d3d62901dc4', 'conta_propria', false,
  '{"titular":"QA Dois","pix_tipo":"celular","pix_chave":"15999990000"}'::jsonb);
INSERT INTO resultado(caso, ok)
SELECT '13a admin grava o bloco de outra pessoa e vê completo', dados_completos AND pix_chave = '15999990000'
       AND preenchido_por = '10000000-0000-4000-8000-000000000001'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = 'ebffaded-075c-493f-89e2-1d3d62901dc4';
-- 13b) Admin pede "usar o cadastro" do corretor: copia o cadastro dele (sem expor ao chamador comum)
SELECT public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', 'conta_propria', true);
INSERT INTO resultado(caso, ok)
SELECT '13b admin usa a conta salva no cadastro do corretor', conta = '11111-1'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000003';

-- 14) Financeiro vê completo e grava por outra pessoa; não grava para quem não está na equipe
SELECT pg_temp.como('10000000-0000-4000-8000-000000000004');
INSERT INTO resultado(caso, ok)
SELECT '14a financeiro vê dados completos', bool_and(dados_completos) AND count(*) = 3
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001');
SELECT public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 'imobiliaria');
INSERT INTO resultado(caso, ok)
SELECT '14b financeiro grava o bloco do gestor', preenchido_por = '10000000-0000-4000-8000-000000000004'
  FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001')
 WHERE user_id = '10000000-0000-4000-8000-000000000002';
DO $$ BEGIN
  PERFORM public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004', 'imobiliaria');
  INSERT INTO resultado(caso, ok) VALUES ('14c quem não é da equipe NÃO ganha bloco', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('14c quem não é da equipe NÃO ganha bloco', true);
END $$;

-- 15) NOVO: corretor da mesma org SEM acesso à venda não grava nem lê
SELECT pg_temp.como('5745cbff-22b6-4a28-a515-dd6706504b8b');
DO $$ BEGIN
  PERFORM public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003', 'imobiliaria');
  INSERT INTO resultado(caso, ok) VALUES ('15a usuário sem acesso à venda NÃO grava', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('15a usuário sem acesso à venda NÃO grava', true);
END $$;
DO $$ BEGIN
  PERFORM public.salvar_meus_dados_pagamento_venda('15000000-0000-4000-8000-000000000001', 'imobiliaria');
  INSERT INTO resultado(caso, ok) VALUES ('15b usuário sem acesso NÃO grava pela RPC antiga', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('15b usuário sem acesso NÃO grava pela RPC antiga', true);
END $$;

-- 16) Usuário de outra organização não lê nem grava
SELECT pg_temp.como('4996f8c5-3b3d-4ea6-9f5b-671b79941a7e');
DO $$ BEGIN
  PERFORM * FROM public.venda_dados_pagamento('15000000-0000-4000-8000-000000000001');
  INSERT INTO resultado(caso, ok) VALUES ('16a admin de outra org NÃO lê dados da venda', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('16a admin de outra org NÃO lê dados da venda', true);
END $$;
DO $$ BEGIN
  PERFORM public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003', 'imobiliaria');
  INSERT INTO resultado(caso, ok) VALUES ('16b admin de outra org NÃO grava', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('16b admin de outra org NÃO grava', true);
END $$;
INSERT INTO resultado(caso, ok) SELECT '16c admin de outra org NÃO lê cadastros', count(*) = 0 FROM public.corretor_dados_pagamento;

-- 17) Anônimo não executa as RPCs
RESET ROLE;
INSERT INTO resultado(caso, ok)
SELECT '17 anon sem EXECUTE nas RPCs', NOT has_function_privilege('anon', 'public.venda_dados_pagamento(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.salvar_meus_dados_pagamento_venda(uuid,text,boolean,jsonb,boolean)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.salvar_dados_pagamento_venda(uuid,uuid,text,boolean,jsonb,boolean)', 'EXECUTE')
   AND NOT has_table_privilege('anon', 'public.corretor_dados_pagamento', 'SELECT');

-- 18) Venda encerrada: ninguém altera mais
-- (triggers de fluxo desligados só nesta transação de teste: o objetivo é só simular o status final)
SET LOCAL session_replication_role = replica;
UPDATE public.sales SET status = 'ocorrencia_concluida' WHERE id = '15000000-0000-4000-8000-000000000001';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('10000000-0000-4000-8000-000000000001');
DO $$ BEGIN
  PERFORM public.salvar_dados_pagamento_venda('15000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003', 'imobiliaria');
  INSERT INTO resultado(caso, ok) VALUES ('18 venda concluída trava alteração', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO resultado(caso, ok) VALUES ('18 venda concluída trava alteração', true);
END $$;
RESET ROLE;

\set QUIET off
SELECT n, caso, CASE WHEN ok THEN 'PASSOU' ELSE 'FALHOU' END AS r, detalhe FROM resultado ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) AS total FROM resultado;

-- Rollbacks também precisam rodar limpos (primeiro o da regra nova, depois o da base)
\i :rb2
SELECT 'rollback 230000 ok: ' || (to_regprocedure('public.salvar_dados_pagamento_venda(uuid,uuid,text,boolean,jsonb,boolean)') IS NULL
   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'sale_dados_pagamento' AND column_name IN ('preenchido_por', 'preenchido_em'))
   AND to_regprocedure('public.salvar_meus_dados_pagamento_venda(uuid,text,boolean,jsonb,boolean)') IS NOT NULL) AS rb2;
\i :rb
SELECT 'rollback 220000 ok: ' || (to_regclass('public.corretor_dados_pagamento') IS NULL
                           AND to_regclass('public.sale_dados_pagamento') IS NULL) AS rb;
ROLLBACK;
