-- Rollback de 20261008190000_captacao_virou_venda.sql (rodar com psql a partir da raiz do repositório)
-- Fazer junto com o rollback do frontend (o botão "Virou venda" e a tela da venda chamam as RPCs novas).
-- Vendas já criadas pelo botão continuam existindo como vendas normais; só perdem o vínculo com a
-- captação (e o acesso aos documentos dela). O histórico da captação é mantido.
-- Passo 2 recria mapa_captacoes_v2 exatamente como em 20261008170000 (o próprio arquivo, sem edição).
-- Depois de rodar, remover a linha 20261008190000 de supabase_migrations.schema_migrations.
BEGIN;
DROP POLICY IF EXISTS exclusive_storage_read_via_venda ON storage.objects;
DROP FUNCTION IF EXISTS public.exclusive_doc_lido_pela_venda(text);
DROP FUNCTION IF EXISTS public.venda_documentos_captacao(uuid);
DROP FUNCTION IF EXISTS public.exclusive_virar_venda(uuid);
DROP FUNCTION IF EXISTS public.exclusive_venda_da_captacao(uuid);
DROP FUNCTION IF EXISTS public.exclusive_situacao_venda_lista();
DROP FUNCTION IF EXISTS public.exclusive_venda_ativa(uuid);
DROP FUNCTION IF EXISTS public.exclusive_pode_virar_venda(uuid, uuid);
DROP TRIGGER IF EXISTS trg_sales_captacao_historico ON public.sales;
DROP FUNCTION IF EXISTS public.sales_captacao_historico();
DROP TRIGGER IF EXISTS trg_sales_proteger_vinculo_captacao ON public.sales;
DROP FUNCTION IF EXISTS public.sales_proteger_vinculo_captacao();
DROP FUNCTION IF EXISTS public.mapa_captacoes_v2();
DROP FUNCTION IF EXISTS public.venda_situacao_captacao(public.sale_status);
DROP INDEX IF EXISTS public.sales_exclusive_capture_idx;
DROP INDEX IF EXISTS public.sales_captacao_ativa_key;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_exclusive_capture_org_fk;
ALTER TABLE public.sales DROP COLUMN IF EXISTS exclusive_capture_id;
COMMIT;
-- Passo 2: mapa_captacoes_v2 anterior (transação própria do arquivo original).
\ir ../migrations/20261008170000_mapa_captacoes_preco_contato.sql
