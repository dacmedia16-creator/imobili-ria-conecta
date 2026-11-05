-- Rollback da 20261105160000_hub_sistemas_ligados (t_311cc909).
-- Ordem: primeiro voltar o front (deploy:safe da versão anterior, que usa academia_enabled), depois rodar isto.
-- Se o front novo ainda estiver no ar sem a função, o Hub cai no padrão seguro (cartões como antes da etapa 1).
DROP FUNCTION IF EXISTS public.sistemas_ligados();
