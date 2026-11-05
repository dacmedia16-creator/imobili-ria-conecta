-- Rollback de 20261105130000_app_role_fotografo (card t_0666d3f0, PR #269).
-- O PostgreSQL não remove valor de enum sem recriar o tipo (app_role é usado em dezenas de funções e
-- policies). Mesmo critério do papel staff: o valor 'fotografo' fica no tipo, inerte.
-- Antes, rode o rollback de 20261105130100 e retire o papel de quem o tiver (só com autorização; confira
-- antes com SELECT):
--   DELETE FROM public.user_roles WHERE role = 'fotografo';
SELECT 1;
