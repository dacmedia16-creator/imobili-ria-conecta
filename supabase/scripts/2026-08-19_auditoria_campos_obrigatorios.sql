-- AUDITORIA READ-ONLY (só SELECT, seguro pra rodar em produção) — lista vendas/ocorrências
-- existentes que já ficariam inconsistentes com as 3 checagens novas da migration
-- 20260819070000_campos_obrigatorios_comissao_e_recebimento.sql. Não depende das funções novas
-- (calcula as mesmas condições direto em SQL), então pode rodar ANTES ou DEPOIS de aplicar a
-- migration — a trava só vale pras próximas transições, isto aqui é só o retrato do passivo atual
-- pra ir corrigindo aos poucos, nada aqui é travado retroativamente.
--
-- Rodar via mcp__supabase__execute_sql (ou psql/SQL editor do Supabase) e revisar as 3 listas.

\pset pager off

-- ============================================================================================
-- 1) Comissão bruta não informada (nem percentual_comissao nem valor_total_comissao preenchidos,
--    com valor_negociado já preenchido) — venda "passa" hoje com comissão R$ 0 sem avisar.
-- ============================================================================================
select
  s.id as sale_id,
  coalesce(s.imovel_id, s.codigo_interno) as codigo,
  s.status,
  s.modalidade,
  s.valor_negociado,
  s.percentual_comissao,
  s.valor_total_comissao,
  s.created_at
from public.sales s
where s.status not in ('cancelada', 'arquivada')
  and coalesce(s.valor_negociado, 0) > 0
  and coalesce(s.percentual_comissao, 0) <= 0
  and coalesce(s.valor_total_comissao, 0) <= 0
order by s.created_at desc;

-- ============================================================================================
-- 2) Parceria externa marcada (parceria_tipo preenchido) sem percentual nem valor de comissão
--    informado — só existe no fluxo padrão (Lançamento usa sale_commission_extras pra isso).
-- ============================================================================================
select
  s.id as sale_id,
  coalesce(s.imovel_id, s.codigo_interno) as codigo,
  s.status,
  s.parceria_tipo,
  s.parceria_nome,
  s.parceria_percentual,
  s.parceria_valor,
  s.created_at
from public.sales s
where s.status not in ('cancelada', 'arquivada')
  and s.parceria_tipo is not null
  and coalesce(s.parceria_percentual, 0) <= 0
  and coalesce(s.parceria_valor, 0) <= 0
order by s.created_at desc;

-- ============================================================================================
-- 3) Previsão de recebimento ausente ou divergente da comissão da Ocorrência (achado original —
--    ocorrência 630601113-11). Cobre tanto "nunca preencheu nada" quanto "preencheu mas não bate".
-- ============================================================================================
select
  o.id as occurrence_id,
  o.sale_id,
  o.codigo_imovel,
  o.status,
  o.valor_comissao,
  o.premio_valor,
  (coalesce(o.prev_recebimento_valor, 0) + coalesce(o.prev_recebimento2_valor, 0) + coalesce(o.prev_recebimento3_valor, 0)) as soma_previsto,
  (coalesce(o.valor_comissao, 0) + coalesce(o.premio_valor, 0)) as comissao_esperada,
  (coalesce(o.valor_comissao, 0) + coalesce(o.premio_valor, 0))
    - (coalesce(o.prev_recebimento_valor, 0) + coalesce(o.prev_recebimento2_valor, 0) + coalesce(o.prev_recebimento3_valor, 0)) as diferenca
from public.occurrences o
where (coalesce(o.valor_comissao, 0) + coalesce(o.premio_valor, 0)) > 0
  and abs(
    (coalesce(o.valor_comissao, 0) + coalesce(o.premio_valor, 0))
    - (coalesce(o.prev_recebimento_valor, 0) + coalesce(o.prev_recebimento2_valor, 0) + coalesce(o.prev_recebimento3_valor, 0))
  ) > 0.01
order by diferenca desc;
