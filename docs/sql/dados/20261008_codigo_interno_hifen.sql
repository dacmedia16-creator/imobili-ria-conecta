-- Correção de dados aprovada por Denis (reunião de gestores 08/10/2026, tópico 6238):
-- sales.codigo_interno ("Código interno" / nº da ocorrência) no padrão 9 dígitos + hífen + 1 a 3 dígitos.
-- Projeto: xvvymgurpchhlmbpjbgc. Só sales.codigo_interno; status, histórico e demais colunas intactos.
--
-- BACKUP (lido em produção em 08/10/2026 antes do UPDATE; md5 de string_agg(id=codigo, ';' order by id)
-- = 5922a349e21833c514eaf65a93301327). Na leitura havia 4 fora do padrão (não 5): o cartão citava
-- "4 sem hífen + 1 com ponto"; na produção restavam 3 sem hífen + 1 com ponto.
--   id                                    | codigo_interno antigo | novo
--   20ef3963-cc67-4548-ae9f-aa87f2b688e9  | 63059126143           | 630591261-43
--   62ab826c-8a26-4336-95b1-521c5df2acc0  | 63059126132           | 630591261-32
--   8b2f1e8a-9100-4039-899a-43d4a7fd5902  | 63166100514           | 631661005-14
--   bd8f3436-2301-48ca-aff8-8af342cd1610  | .630591260-24         | 630591260-24
-- Todas em status ocorrencia_concluida, modalidade padrao.

-- APLICAR (WHERE pelo id E pelo valor antigo: rodar de novo não altera nada)
BEGIN;
WITH alvo(id, antigo, novo) AS (VALUES
  ('bd8f3436-2301-48ca-aff8-8af342cd1610'::uuid, '.630591260-24', '630591260-24'),
  ('62ab826c-8a26-4336-95b1-521c5df2acc0'::uuid, '63059126132',   '630591261-32'),
  ('20ef3963-cc67-4548-ae9f-aa87f2b688e9'::uuid, '63059126143',   '630591261-43'),
  ('8b2f1e8a-9100-4039-899a-43d4a7fd5902'::uuid, '63166100514',   '631661005-14'))
UPDATE public.sales s SET codigo_interno = a.novo
FROM alvo a WHERE s.id = a.id AND s.codigo_interno = a.antigo
RETURNING s.id, s.codigo_interno;
COMMIT;

-- REVERTER (volta ao valor antigo só se o valor atual ainda for o corrigido)
-- BEGIN;
-- WITH alvo(id, antigo, novo) AS (VALUES
--   ('bd8f3436-2301-48ca-aff8-8af342cd1610'::uuid, '.630591260-24', '630591260-24'),
--   ('62ab826c-8a26-4336-95b1-521c5df2acc0'::uuid, '63059126132',   '630591261-32'),
--   ('20ef3963-cc67-4548-ae9f-aa87f2b688e9'::uuid, '63059126143',   '630591261-43'),
--   ('8b2f1e8a-9100-4039-899a-43d4a7fd5902'::uuid, '63166100514',   '631661005-14'))
-- UPDATE public.sales s SET codigo_interno = a.antigo
-- FROM alvo a WHERE s.id = a.id AND s.codigo_interno = a.novo;
-- COMMIT;
--
-- NÃO alterado (fora do escopo aprovado; reportado a Denis):
--   * sales.imovel_id ("ID do imóvel") ainda sem hífen em 62ab826c (63059126132) e 8b2f1e8a (63166100514).
--   * occurrences.codigo_imovel (cópia de imovel_id ao criar a ocorrência) nas mesmas 2 vendas; ocorrências concluídas.
--   * notifications: 41 mensagens antigas citam os códigos antigos (histórico, não se reescreve).
