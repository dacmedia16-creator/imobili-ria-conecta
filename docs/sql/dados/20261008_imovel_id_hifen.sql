-- Correção de dados aprovada por Denis (tópico 6238, 08/10/2026, "sim sim"; cartão t_4f854c45):
-- sales.imovel_id ("ID do imóvel") e occurrences.codigo_imovel (cópia do imovel_id) no padrão já
-- predominante nos dados: 9 dígitos + hífen + sufixo (129 de 138 vendas e 97 de 101 ocorrências
-- já estavam assim em 08/10/2026). Somente dados; nenhum CHECK novo nesse campo.
-- Projeto: xvvymgurpchhlmbpjbgc. Escopo: SÓ as 2 vendas já corrigidas no codigo_interno
-- (docs/sql/dados/20261008_codigo_interno_hifen.sql); o valor novo é igual ao codigo_interno delas.
--
-- BACKUP (lido em produção em 08/10/2026 antes do UPDATE;
-- md5 de string_agg('S:'||sales.id||'='||imovel_id / 'O:'||occurrences.id||'='||codigo_imovel, ';' order by 1)
-- = b7363405cd8a5ad3f91ca31199767981)
--   tabela      | id                                   | valor antigo | novo
--   sales       | 62ab826c-8a26-4336-95b1-521c5df2acc0 | 63059126132  | 630591261-32
--   occurrences | 0bea55fb-d060-4f9f-854c-b6c24df904a0 | 63059126132  | 630591261-32  (sale 62ab826c)
--   sales       | 8b2f1e8a-9100-4039-899a-43d4a7fd5902 | 63166100514  | 631661005-14
--   occurrences | f7bd1063-482f-42cf-b098-50a0b5d09ea6 | 63166100514  | 631661005-14  (sale 8b2f1e8a)
-- Ambas: venda ocorrencia_concluida, ocorrência concluida.
--
-- NÃO alterados (fora do escopo aprovado de "2 vendas"; reportados a Denis):
--   * sales acfbe7cb (63059126147, ocorrência concluída com o mesmo valor), 977c12d4 (63059126146,
--     rascunho), 155bf7d5 (630601112254, 12 dígitos) e outros 4 fora do padrão (7 dígitos, vazio, 'outro').

-- APLICAR (WHERE pelo id E pelo valor antigo: rodar de novo não altera nada)
BEGIN;
WITH alvo(id, antigo, novo) AS (VALUES
  ('62ab826c-8a26-4336-95b1-521c5df2acc0'::uuid, '63059126132', '630591261-32'),
  ('8b2f1e8a-9100-4039-899a-43d4a7fd5902'::uuid, '63166100514', '631661005-14'))
UPDATE public.sales s SET imovel_id = a.novo
FROM alvo a WHERE s.id = a.id AND s.imovel_id = a.antigo;
WITH alvo(id, sale_id, antigo, novo) AS (VALUES
  ('0bea55fb-d060-4f9f-854c-b6c24df904a0'::uuid, '62ab826c-8a26-4336-95b1-521c5df2acc0'::uuid, '63059126132', '630591261-32'),
  ('f7bd1063-482f-42cf-b098-50a0b5d09ea6'::uuid, '8b2f1e8a-9100-4039-899a-43d4a7fd5902'::uuid, '63166100514', '631661005-14'))
UPDATE public.occurrences o SET codigo_imovel = a.novo
FROM alvo a WHERE o.id = a.id AND o.sale_id = a.sale_id AND o.codigo_imovel = a.antigo;
COMMIT;

-- REVERTER (volta ao valor antigo só se o valor atual ainda for o corrigido)
-- BEGIN;
-- WITH alvo(id, antigo, novo) AS (VALUES
--   ('62ab826c-8a26-4336-95b1-521c5df2acc0'::uuid, '63059126132', '630591261-32'),
--   ('8b2f1e8a-9100-4039-899a-43d4a7fd5902'::uuid, '63166100514', '631661005-14'))
-- UPDATE public.sales s SET imovel_id = a.antigo FROM alvo a WHERE s.id = a.id AND s.imovel_id = a.novo;
-- WITH alvo(id, antigo, novo) AS (VALUES
--   ('0bea55fb-d060-4f9f-854c-b6c24df904a0'::uuid, '63059126132', '630591261-32'),
--   ('f7bd1063-482f-42cf-b098-50a0b5d09ea6'::uuid, '63166100514', '631661005-14'))
-- UPDATE public.occurrences o SET codigo_imovel = a.antigo FROM alvo a WHERE o.id = a.id AND o.codigo_imovel = a.novo;
-- COMMIT;
