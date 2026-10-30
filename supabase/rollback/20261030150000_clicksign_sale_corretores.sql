-- Rollback de 20261030150000_clicksign_sale_corretores.sql (t_bc726348).
-- Antes de rodar: voltar a edge clicksign-sale para a versão anterior (que chamava sale_corretores).
-- Atenção: com a versão anterior, o envio de venda volta a falhar com "sem corretor com cadastro".
DROP FUNCTION IF EXISTS public.clicksign_sale_corretores(uuid, uuid);
