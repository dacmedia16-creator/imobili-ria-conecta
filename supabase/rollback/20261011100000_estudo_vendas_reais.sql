-- Rollback de 20261011100000_estudo_vendas_reais.sql. Antes: desligar a função estudo-vendas-reais
-- (ou remover o secret) para o Estudo parar de chamar. Nada fora destes objetos é tocado.
BEGIN;
DROP FUNCTION IF EXISTS public.estudo_vendas_reais(text);
DROP FUNCTION IF EXISTS public.estudo_rua_sem_numero(text, text, text);
DROP TABLE IF EXISTS public.estudo_vendas_api_keys;
COMMIT;
