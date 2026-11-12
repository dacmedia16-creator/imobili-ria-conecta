-- Rollback de 20261122120000_app_role_locacao (card t_1fe07126).
-- O Postgres não remove valor de enum com segurança; o valor 'locacao' fica inerte se ninguém o usar.
-- Antes de reverter a parte B (20261122120100_papel_locacao.rollback.sql), confira quem tem o papel:
--   SELECT user_id FROM public.user_roles WHERE role = 'locacao';
-- e devolva a essas pessoas o papel anterior (ex.: corretor) pela tela Usuários, retirando o 'locacao'.
-- Nada a executar aqui.
SELECT 1;
