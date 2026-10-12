-- Rollback de 20261012200000_conta_max_busca_email.sql
-- Antes: republicar a edge function conta-max-bridge anterior (com listUsers), senão o login pela Conta MAX
-- de quem ainda não tem vínculo passa a dar identity_lookup_failed.
drop function if exists public.conta_max_auth_user_ids_by_email(text);
