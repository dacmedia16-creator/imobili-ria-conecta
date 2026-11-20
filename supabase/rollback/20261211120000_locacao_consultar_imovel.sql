-- Desfaz 20261211120000_locacao_consultar_imovel.sql (t_241e03a9): só remove a função de consulta. Nenhum dado muda.
BEGIN;
DROP FUNCTION IF EXISTS public.locacao_consultar_imovel(text);
COMMIT;
