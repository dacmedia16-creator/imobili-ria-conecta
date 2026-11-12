-- Rollback de 20261121120000_home_banners (cartão t_75786f5c).
-- Remove as RPCs e a tabela dos banners do Início. Os cadastros de banner são apagados junto com a tabela.
-- O bucket privado 'home-banners' NÃO é removido aqui: o Supabase bloqueia apagar storage por SQL
-- (storage.protect_delete). Ele fica sem política nenhuma para o navegador (inofensivo). Para tirá-lo,
-- use a API do Storage com service_role: esvaziar (DELETE /storage/v1/object/home-banners {prefixes})
-- e depois DELETE /storage/v1/bucket/home-banners. Nenhum outro dado é tocado.

DROP FUNCTION IF EXISTS public.home_banner_excluir(uuid);
DROP FUNCTION IF EXISTS public.home_banner_ativar(uuid, boolean);
DROP FUNCTION IF EXISTS public.home_banner_salvar(uuid, text, text, text, date, date, text[], integer, boolean);
DROP FUNCTION IF EXISTS public.home_banner_preparar_envio(text);
DROP FUNCTION IF EXISTS public.home_banners_lista();
DROP FUNCTION IF EXISTS public.home_banners_ativos();
DROP FUNCTION IF EXISTS public.home_banner_pode_gerir();
DROP TABLE IF EXISTS public.home_banners;
