-- CATCH-UP: dashboard_stats() é referenciada (REVOKE/GRANT EXECUTE) a partir de 20260727040000/
-- 20260727050000, mas só é DEFINIDA de verdade em 20260809020000 — puro problema de ORDEM no
-- histórico deste repositório (a função existia em produção nessa época, a migration que a criava
-- originalmente é que nunca foi commitada/foi perdida). Quebra um replay do zero com "function
-- public.dashboard_stats() does not exist" no REVOKE.
--
-- Stub mínimo só pra existir o objeto — ninguém CHAMA dashboard_stats() entre este ponto e
-- 20260809020000 (confirmado por busca no repo), que já faz CREATE OR REPLACE com a lógica real
-- (funil, minhas_vendas, etc.) por cima deste stub. Mesma assinatura (sem argumentos, retorna
-- jsonb) da definição real, pra REVOKE/GRANT EXECUTE encontrarem a função certa.
create or replace function public.dashboard_stats()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select '{}'::jsonb;
$function$;
