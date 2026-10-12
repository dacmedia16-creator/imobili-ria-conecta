-- Rollback de 20261012170000_login_so_google.sql (t_bcc382de).
-- 1) PRIMEIRO desligar o hook (senão o Auth chama uma função inexistente e TODO login falha):
--    Management API PATCH /v1/projects/<ref>/config/auth {"hook_custom_access_token_enabled": false}
-- 2) Depois rodar este SQL. A senha volta a funcionar para todos na hora.
drop function if exists public.login_so_google_hook(jsonb);
drop table if exists public.login_senha_emergencia;
