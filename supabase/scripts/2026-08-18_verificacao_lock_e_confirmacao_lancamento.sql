-- Script de VERIFICAÇÃO MANUAL (não faz parte da suíte automatizada — mesma natureza de
-- 2026-08-18_verificacao_manual_lancamento_saldo_imobiliaria.sql) pros 4 cenários pedidos na
-- revisão que corrigiu validar_distribuicao_antes_concluir_lancamento() e adicionou FOR UPDATE em
-- salvar_divisao_comissao_lancamento()/concluir_lancamento(). Rodar num Supabase LOCAL
-- (`supabase start`) ou branch de staging, NUNCA em produção.
--
-- Cenários 1-3 são de execução única (rodar este arquivo direto). Cenário 4 (concorrência real)
-- PRECISA de duas conexões psql simultâneas — não dá pra reproduzir num único arquivo/sessão; o
-- roteiro exato está no comentário da seção 4 abaixo (foi assim que foi validado: dois processos
-- `docker exec ... psql` lançados em paralelo no mesmo shell, com `&`/`wait`, nunca sequenciais —
-- lançados um depois do outro sem `&` não prova nada, o segundo simplesmente roda depois que o
-- primeiro já terminou).

\set ON_ERROR_STOP off
\pset pager off

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111111','role','authenticated')::text, false);

-- Fixture: reaproveita o mesmo padrão dos outros scripts desta pasta — troque o uuid do
-- financeiro de teste por um usuário real (papel financeiro/admin) antes de rodar.
insert into public.sales (id, corretor_id, modalidade, status, valor_negociado, percentual_comissao)
values ('77777777-7777-7777-7777-777777777701'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'lancamento', 'ocorrencia_analise_financeiro', 100000, 6);

select public.salvar_divisao_comissao_lancamento(
  '77777777-7777-7777-7777-777777777701'::uuid,
  jsonb_build_array(
    jsonb_build_object('id', null, 'papel', 'corretor_vendedor', 'user_id', '11111111-1111-1111-1111-111111111111', 'valor', 4000, 'sem_cadastro_confirmado', false),
    jsonb_build_object('id', null, 'papel', 'team_leader', 'user_id', '11111111-1111-1111-1111-111111111111', 'valor', 2000, 'sem_cadastro_confirmado', false)
  )
);
-- saldo_imobiliaria = 0, calculo_valido = true a partir daqui.

-- ============================================================================================
-- 1) DISTRIBUIÇÃO VÁLIDA + UPDATE DIRETO SEM SNAPSHOT → deve ser REJEITADO (achado corrigido:
--    antes desta revisão, um UPDATE direto matematicamente correto conseguia concluir sem passar
--    pela confirmação explícita).
-- ============================================================================================
update public.sales set status = 'ocorrencia_concluida' where id = '77777777-7777-7777-7777-777777777701'::uuid;
-- ESPERADO: ERRO "o saldo da imobiliária/construtora não foi confirmado (ou está desatualizado)"
select status from public.sales where id = '77777777-7777-7777-7777-777777777701'::uuid;
-- ESPERADO: ocorrencia_analise_financeiro (não concluiu)

-- ============================================================================================
-- 2) DISTRIBUIÇÃO VÁLIDA VIA RPC → concluída com os 3 campos de auditoria preenchidos.
-- ============================================================================================
select public.concluir_lancamento('77777777-7777-7777-7777-777777777701'::uuid, 0);
select status, lancamento_saldo_imobiliaria,
  lancamento_saldo_confirmado_em is not null as confirmado_em_preenchido,
  lancamento_saldo_confirmado_por
from public.sales where id = '77777777-7777-7777-7777-777777777701'::uuid;
-- ESPERADO: ocorrencia_concluida | 0.00 | t | <uuid do financeiro>

-- ============================================================================================
-- 3) SALDO CONFIRMADO DESATUALIZADO → deve ser REJEITADO (reabre, muda a comissão, confirma o
--    valor ANTIGO que já não bate mais).
-- ============================================================================================
update public.sales set status = 'ocorrencia_analise_financeiro' where id = '77777777-7777-7777-7777-777777777701'::uuid;
select public.salvar_divisao_comissao_lancamento(
  '77777777-7777-7777-7777-777777777701'::uuid,
  jsonb_build_array(
    jsonb_build_object('id', null, 'papel', 'corretor_vendedor', 'user_id', '11111111-1111-1111-1111-111111111111', 'valor', 4000, 'sem_cadastro_confirmado', false),
    jsonb_build_object('id', null, 'papel', 'team_leader', 'user_id', '11111111-1111-1111-1111-111111111111', 'valor', 1000, 'sem_cadastro_confirmado', false)
  )
);
-- novo saldo real = 1000, mas confirma o antigo (0):
select public.concluir_lancamento('77777777-7777-7777-7777-777777777701'::uuid, 0);
-- ESPERADO: ERRO "não corresponde ao saldo calculado agora (R$ 1000.00)"

-- ============================================================================================
-- 4) EDIÇÃO E CONCLUSÃO CONCORRENTES → sem snapshot inconsistente (via FOR UPDATE).
--
-- NÃO dá pra rodar dentro deste arquivo — precisa de 2 sessões psql simultâneas. Roteiro exato
-- usado na validação real (2026-08-17, banco local descartável):
--
--   Restaura a fixture pra saldo=0 primeiro (mesma chamada salvar_divisao_comissao_lancamento
--   acima, com team_leader = 2000 de novo).
--
--   sessao_a.sql:
--     select set_config('request.jwt.claims', ..., false);
--     select clock_timestamp() as a_inicio;
--     begin;
--     select * from public.sales where id = '77777777-7777-7777-7777-777777777701'::uuid for update;
--     select pg_sleep(4);
--     update public.sale_commission_extras set valor = 1000
--       where sale_id = '77777777-7777-7777-7777-777777777701'::uuid and papel = 'team_leader';
--     commit;
--     select clock_timestamp() as a_fim;
--
--   sessao_b.sql:
--     select set_config('request.jwt.claims', ..., false);
--     select clock_timestamp() as b_inicio;
--     select public.concluir_lancamento('77777777-7777-7777-7777-777777777701'::uuid, 0);
--     select clock_timestamp() as b_fim;
--
--   Lançar as duas em PARALELO no mesmo shell (essencial — sequencial não prova nada):
--     ( docker exec -i <container> psql -U postgres -d postgres < sessao_a.sql > out_a.txt 2>&1 ) &
--     ( docker exec -i <container> psql -U postgres -d postgres < sessao_b.sql > out_b.txt 2>&1 ) &
--     wait
--
-- RESULTADO OBTIDO na validação real (timestamps reais, não simulados):
--   a_inicio = 19:28:50.576327   b_inicio = 19:28:50.573378   (praticamente simultâneos, 3ms de diferença)
--   a_fim    = 19:28:54.584723   b_fim    = 19:28:54.593081   (B terminou ~8ms DEPOIS de A)
--   Tempo de execução de concluir_lancamento() na sessão B: 4020.865 ms — ou seja, B ficou
--   BLOQUEADO no SELECT ... FOR UPDATE por ~4 segundos (exatamente o pg_sleep(4) de A), só
--   prosseguiu depois que A commitou.
--   Resultado de B: ERRO "O saldo confirmado (R$ 0.00) não corresponde ao saldo calculado agora
--   (R$ 1000.00)" — B recalculou DEPOIS do commit de A (viu o dado já atualizado, não uma versão
--   obsoleta) e corretamente rejeitou a confirmação stale. Nenhum snapshot inconsistente foi
--   gravado — a venda permaneceu em ocorrencia_analise_financeiro.
-- ============================================================================================

delete from public.sales where id = '77777777-7777-7777-7777-777777777701'::uuid;
