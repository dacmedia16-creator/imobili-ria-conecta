-- Script de VERIFICAÇÃO MANUAL (mesma natureza dos scripts já existentes em supabase/scripts/) pros
-- 3 bugs bloqueadores corrigidos na branch fix/lancamento-bloqueadores-preexistentes. Rodar num
-- Supabase LOCAL (`supabase start`), NUNCA em produção.
--
-- Cobre só o BUG #3 (criar_ocorrencia_lancamento aceitar comissão por percentual) -- é o único dos
-- três com lógica no banco. Bugs #1 e #2 são de frontend (LancamentoDetail.tsx) e têm cobertura de
-- regressão em src/lib/lancamento-resumo.test.ts e src/lib/lancamento-pessoas.test.ts.

\set ON_ERROR_STOP off
\pset pager off

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111111','role','authenticated')::text, false);

-- Fixture: venda de Lançamento em rascunho, só com percentual_comissao (sem valor_total_comissao) --
-- o cenário que antes travava "Enviar ao financeiro" mesmo com dado suficiente pra calcular.
insert into public.sales (id, corretor_id, modalidade, status, valor_negociado, percentual_comissao)
values ('88888888-8888-8888-8888-888888888801'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'lancamento', 'rascunho', 100000, 6);

insert into public.sale_commission_extras (sale_id, papel, user_id, valor, sem_cadastro_confirmado)
values ('88888888-8888-8888-8888-888888888801'::uuid, 'corretor_vendedor', '11111111-1111-1111-1111-111111111111'::uuid, 6000, false);

-- ============================================================================================
-- 1) SÓ PERCENTUAL (sem valor_total_comissao) -> deve ACEITAR agora (antes: "Informe o valor total
--    da comissão...", mesmo com dado suficiente pra calcular via percentual_comissao * valor_negociado).
-- ============================================================================================
select public.criar_ocorrencia_lancamento('88888888-8888-8888-8888-888888888801'::uuid) as resultado_percentual_only;
-- ESPERADO: sucesso, jsonb com occurrence_id e comissao_bruta=6000.00 (6% de 100.000)
select o.valor_comissao from public.occurrences o where o.sale_id = '88888888-8888-8888-8888-888888888801'::uuid;
-- ESPERADO: 6000.00 -- valor_comissao da Ocorrência precisa vir DERIVADO do percentual, não NULL
--           (era o gap real: mesmo se a checagem de entrada relaxasse, sem isso a Ocorrência nascia
--           com valor_comissao nulo).

delete from public.occurrences where sale_id = '88888888-8888-8888-8888-888888888801'::uuid;
delete from public.sales where id = '88888888-8888-8888-8888-888888888801'::uuid;

-- ============================================================================================
-- 2) SÓ VALOR_TOTAL_COMISSAO explícito (sem percentual) -> continua funcionando (compatibilidade
--    com o caminho que já funcionava antes).
-- ============================================================================================
insert into public.sales (id, corretor_id, modalidade, status, valor_negociado, valor_total_comissao)
values ('88888888-8888-8888-8888-888888888802'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'lancamento', 'rascunho', 100000, 5000);
insert into public.sale_commission_extras (sale_id, papel, user_id, valor, sem_cadastro_confirmado)
values ('88888888-8888-8888-8888-888888888802'::uuid, 'corretor_vendedor', '11111111-1111-1111-1111-111111111111'::uuid, 5000, false);
select public.criar_ocorrencia_lancamento('88888888-8888-8888-8888-888888888802'::uuid) as resultado_valor_total_only;
-- ESPERADO: sucesso, comissao_bruta=5000.00
select o.valor_comissao from public.occurrences o where o.sale_id = '88888888-8888-8888-8888-888888888802'::uuid;
-- ESPERADO: 5000.00

delete from public.occurrences where sale_id = '88888888-8888-8888-8888-888888888802'::uuid;
delete from public.sales where id = '88888888-8888-8888-8888-888888888802'::uuid;

-- ============================================================================================
-- 3) PERCENTUAL E VALOR_TOTAL_COMISSAO DIVERGENTES -> percentual*negociado prevalece (mesma regra
--    de precedência que calcular_distribuicao_venda já usa pra Venda Normal -- fonte única).
-- ============================================================================================
insert into public.sales (id, corretor_id, modalidade, status, valor_negociado, percentual_comissao, valor_total_comissao)
values ('88888888-8888-8888-8888-888888888803'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'lancamento', 'rascunho', 100000, 6, 999999);
insert into public.sale_commission_extras (sale_id, papel, user_id, valor, sem_cadastro_confirmado)
values ('88888888-8888-8888-8888-888888888803'::uuid, 'corretor_vendedor', '11111111-1111-1111-1111-111111111111'::uuid, 6000, false);
select public.criar_ocorrencia_lancamento('88888888-8888-8888-8888-888888888803'::uuid) as resultado_percentual_prevalece;
select o.valor_comissao from public.occurrences o where o.sale_id = '88888888-8888-8888-8888-888888888803'::uuid;
-- ESPERADO: 6000.00 (percentual*negociado), não 999999.00

delete from public.occurrences where sale_id = '88888888-8888-8888-8888-888888888803'::uuid;
delete from public.sales where id = '88888888-8888-8888-8888-888888888803'::uuid;

-- ============================================================================================
-- 4) NEM PERCENTUAL NEM VALOR_TOTAL_COMISSAO -> continua REJEITADO, com mensagem cobrindo os dois
--    caminhos possíveis (regressão: não pode voltar a aceitar comissão zerada).
-- ============================================================================================
insert into public.sales (id, corretor_id, modalidade, status, valor_negociado)
values ('88888888-8888-8888-8888-888888888804'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'lancamento', 'rascunho', 100000);
insert into public.sale_commission_extras (sale_id, papel, user_id, valor, sem_cadastro_confirmado)
values ('88888888-8888-8888-8888-888888888804'::uuid, 'corretor_vendedor', '11111111-1111-1111-1111-111111111111'::uuid, 0, false);
select public.criar_ocorrencia_lancamento('88888888-8888-8888-8888-888888888804'::uuid) as resultado_sem_nenhum;
-- ESPERADO: ERRO "Informe o percentual de comissão (junto com o valor negociado) ou o valor total
--           da comissão antes de enviar ao financeiro."

delete from public.sale_commission_extras where sale_id = '88888888-8888-8888-8888-888888888804'::uuid;
delete from public.sales where id = '88888888-8888-8888-8888-888888888804'::uuid;
