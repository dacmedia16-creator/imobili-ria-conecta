-- Script de VERIFICAÇÃO MANUAL — não faz parte da suíte automatizada (vitest só cobre a fórmula
-- pura em src/lib/lancamento-distribuicao.test.ts; o que só existe no banco — RPCs, trigger,
-- histórico — precisa ser conferido contra um Postgres de verdade). Rodar num Supabase LOCAL
-- (`supabase start`) ou branch de staging, NUNCA em produção.
--
-- Tudo dentro de uma única transação com ROLLBACK no final — mesmo se alguém rodar isso sem querer
-- contra o banco errado, nada fica gravado. Requer as duas migrations desta feature já aplicadas
-- (20260818000000 e 20260818010000) e pelo menos um usuário com papel 'financeiro' existente
-- (troque :financeiro_id abaixo por um id real antes de rodar).

begin;

-- 0) Fixture: um lançamento de teste, dono = o próprio :financeiro_id só pra simplificar o script
--    (em produção o dono normalmente tem o papel 'lancamento', não financeiro — RLS não é o foco
--    aqui, é o cálculo/trigger).
\set financeiro_id '00000000-0000-0000-0000-000000000000' -- TROCAR por um id real de public.profiles com papel financeiro/admin

insert into public.sales (id, corretor_id, modalidade, status, valor_negociado, percentual_comissao)
values ('99999999-9999-9999-9999-999999999901'::uuid, :'financeiro_id'::uuid, 'lancamento', 'ocorrencia_analise_financeiro', 100000, 6);

-- ============================================================================================
-- 1) VALOR EXATO — pessoas somam exatamente a comissão bruta (R$6.000): saldo da imobiliária = 0,
--    calculo_valido = true.
-- ============================================================================================
insert into public.sale_commission_extras (sale_id, papel, valor, sem_cadastro_confirmado)
values
  ('99999999-9999-9999-9999-999999999901'::uuid, 'corretor_vendedor', 4000, false),
  ('99999999-9999-9999-9999-999999999901'::uuid, 'team_leader', 2000, false);

select
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'comissao_bruta' as esperado_6000,
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'saldo_imobiliaria' as esperado_0,
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'calculo_valido' as esperado_true;

-- ============================================================================================
-- 2) EXCESSO — soma passa de R$6.000 em mais de R$0,01: saldo negativo, calculo_valido = false.
-- ============================================================================================
update public.sale_commission_extras set valor = 2500.02
where sale_id = '99999999-9999-9999-9999-999999999901'::uuid and papel = 'team_leader';

select
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'saldo_imobiliaria' as esperado_menos_0_02,
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'calculo_valido' as esperado_false;

-- 2b) Mesmo excesso, mas via a RPC transacional — deve dar ROLLBACK e lançar exceção (23514), NÃO
-- deve alterar nenhuma linha.
select public.salvar_divisao_comissao_lancamento(
  '99999999-9999-9999-9999-999999999901'::uuid,
  jsonb_build_array(
    jsonb_build_object('id', null, 'papel', 'corretor_vendedor', 'valor', 4000, 'sem_cadastro_confirmado', false),
    jsonb_build_object('id', null, 'papel', 'team_leader', 'valor', 2500.02, 'sem_cadastro_confirmado', false)
  )
); -- ESPERADO: erro "ultrapassa a comissão bruta"

-- corrige de volta pro estado válido pros testes seguintes
update public.sale_commission_extras set valor = 2000
where sale_id = '99999999-9999-9999-9999-999999999901'::uuid and papel = 'team_leader';

-- ============================================================================================
-- 3) SALDO AUTOMÁTICO — pessoas somam menos que o bruto: o resto vira saldo_imobiliaria sozinho,
--    sem precisar de nenhuma linha "Imobiliária" cadastrada à mão.
-- ============================================================================================
update public.sale_commission_extras set valor = 1000
where sale_id = '99999999-9999-9999-9999-999999999901'::uuid and papel = 'team_leader';

select
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'total_pessoas' as esperado_5000,
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'saldo_imobiliaria' as esperado_1000,
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'calculo_valido' as esperado_true;

-- ============================================================================================
-- 4) PARCERIA EXTERNA — linha com sem_cadastro_confirmado=true entra em parceria_externa (não em
--    total_pessoas), mas ainda conta pro saldo/bloqueio de excesso igual uma pessoa comum.
-- ============================================================================================
insert into public.sale_commission_extras (sale_id, papel, nome, valor, sem_cadastro_confirmado)
values ('99999999-9999-9999-9999-999999999901'::uuid, 'outro', 'Corretor parceiro sem cadastro', 500, true);

select
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'total_pessoas' as esperado_5000_sem_mudar,
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'parceria_externa' as esperado_500,
  (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999901'::uuid))->>'saldo_imobiliaria' as esperado_500;

-- ============================================================================================
-- 5) RASCUNHO INCOMPLETO — sem valor_negociado/comissão definidos, mesmo com linhas cadastradas,
--    nunca é inconsistência (comissao_bruta = 0 desativa o bloqueio).
-- ============================================================================================
insert into public.sales (id, corretor_id, modalidade, status)
values ('99999999-9999-9999-9999-999999999902'::uuid, :'financeiro_id'::uuid, 'lancamento', 'rascunho');
insert into public.sale_commission_extras (sale_id, papel, valor, sem_cadastro_confirmado)
values ('99999999-9999-9999-9999-999999999902'::uuid, 'corretor_vendedor', 99999, false);

select (calcular_distribuicao_venda('99999999-9999-9999-9999-999999999902'::uuid))->>'calculo_valido' as esperado_true_rascunho;

-- ============================================================================================
-- 6) CONCLUSÃO — exige saldo confirmado batendo com o calculado; grava lancamento_saldo_* e o
--    histórico (sale_status_history + activity_logs).
-- ============================================================================================
set local role postgres; -- simula auth.uid() = financeiro — ajuste conforme seu setup de teste local
select set_config('request.jwt.claims', json_build_object('sub', :'financeiro_id')::text, true);

-- 6a) confirmação com valor ERRADO deve falhar
select public.concluir_lancamento('99999999-9999-9999-9999-999999999901'::uuid, 999999);
-- ESPERADO: erro "não corresponde ao saldo calculado"

-- 6b) confirmação com o valor certo (500, do cenário 4) deve funcionar
select public.concluir_lancamento('99999999-9999-9999-9999-999999999901'::uuid, 500);

select status, lancamento_saldo_imobiliaria, lancamento_saldo_confirmado_em, lancamento_saldo_confirmado_por
from public.sales where id = '99999999-9999-9999-9999-999999999901'::uuid;
-- ESPERADO: status = ocorrencia_concluida, saldo = 500, confirmado_em preenchido

select para, motivo from public.sale_status_history
where sale_id = '99999999-9999-9999-9999-999999999901'::uuid order by created_at desc limit 1;
-- ESPERADO: para = ocorrencia_concluida, motivo menciona "Saldo da imobiliária/construtora confirmado: R$ 500.00"

select acao, payload from public.activity_logs
where sale_id = '99999999-9999-9999-9999-999999999901'::uuid order by created_at desc limit 3;
-- ESPERADO: 'lancamento_concluido' e 'status_change' presentes

-- ============================================================================================
-- 7) REABERTURA + CONCLUSÃO COM EXCESSO — trigger de segurança deve bloquear mesmo via UPDATE
--    direto (contornando concluir_lancamento()), depois de reaberto.
-- ============================================================================================
update public.sales set status = 'ocorrencia_analise_financeiro'
where id = '99999999-9999-9999-9999-999999999901'::uuid;

update public.sale_commission_extras set valor = 999999
where sale_id = '99999999-9999-9999-9999-999999999901'::uuid and papel = 'corretor_vendedor';

update public.sales set status = 'ocorrencia_concluida'
where id = '99999999-9999-9999-9999-999999999901'::uuid;
-- ESPERADO: erro "Não é possível concluir este lançamento" (vindo da trigger, não da RPC)

-- ============================================================================================
-- 8) REGISTROS ANTIGOS — confirma que os 5 lançamentos já existentes hoje (todos com diferença,
--    ver auditoria anterior) continuam com status inalterado e SEM lancamento_saldo_* preenchido
--    até que alguém explicitamente os reabra e conclua de novo.
-- ============================================================================================
select id, status, lancamento_saldo_imobiliaria, lancamento_saldo_confirmado_em
from public.sales
where modalidade = 'lancamento'
  and id not in ('99999999-9999-9999-9999-999999999901'::uuid, '99999999-9999-9999-9999-999999999902'::uuid)
order by created_at;
-- ESPERADO: as 5 linhas de produção, todas com lancamento_saldo_imobiliaria/confirmado_em = NULL
-- (colunas novas, nunca gravadas retroativamente) e status igual ao de antes desta migration.

rollback; -- nada acima fica gravado, mesmo que algum ESPERADO não bata.
