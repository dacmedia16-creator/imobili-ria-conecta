-- Vendas: teto absoluto de R$ 100 milhões no valor negociado. Cartão t_9f5f3ae2 (item 2 do diagnóstico
-- t_8c3aff91, aprovado por Denis em 17/11 no tópico 6238). PREPARADA: aplicar em produção só com o
-- "pode publicar" de Denis.
--
-- Por quê: o rascunho 630601205-33 foi salvo com R$ 281.600.000 (anunciado R$ 397.000) e inflou o total
-- da esteira para R$ 299 mi. A tela passa a barrar valor fora da faixa (metade a dobro do anunciado,
-- src/lib/valor-negociado-trava.ts); esta trava no banco é a rede de segurança para qualquer outro caminho.
--
-- NOT VALID: em 17/11, das 935 vendas, só a 630601205-33 passa do teto. NOT VALID não confere as linhas
-- antigas, então a migration não falha e a venda continua aparecendo. Atenção: o Postgres confere a trava
-- em TODA nova gravação da linha. Essa venda só volta a aceitar gravação quando o valor negociado for
-- corrigido para até R$ 100 mi (item 1, ainda sem valor certo). Depois da correção, rode:
--   ALTER TABLE public.sales VALIDATE CONSTRAINT sales_valor_negociado_teto;
--
-- O número 100000000 é o mesmo de VALOR_NEGOCIADO_LIMITES.tetoAbsoluto (src/lib/valor-negociado-trava.ts).
-- Não muda nenhum outro campo, regra de comissão, permissão nem dado existente.
--
-- Rollback: docs/sql/rollback/20261202120000_sales_valor_negociado_teto.rollback.sql
-- Teste:    supabase/tests/run-sales-valor-negociado-teto.sh (homologação, transação desfeita).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

ALTER TABLE public.sales
  ADD CONSTRAINT sales_valor_negociado_teto
  CHECK (valor_negociado IS NULL OR valor_negociado <= 100000000)
  NOT VALID;

COMMENT ON CONSTRAINT sales_valor_negociado_teto ON public.sales IS
  'Teto absoluto de R$ 100 mi no valor negociado (t_9f5f3ae2). Mesmo número da tela (valor-negociado-trava.ts).';

COMMIT;
