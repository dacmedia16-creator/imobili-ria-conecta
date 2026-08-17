-- CATCH-UP: dashboard_stats() é referenciada (REVOKE/GRANT EXECUTE) a partir de 20260727040000/
-- 20260727050000, mas só é DEFINIDA de verdade em 20260809020000 — puro problema de ORDEM no
-- histórico deste repositório (a função existia em produção nessa época, a migration que a criava
-- originalmente é que nunca foi commitada/foi perdida). Quebra um replay do zero com "function
-- public.dashboard_stats() does not exist" no REVOKE.
--
-- RISCO CRÍTICO CORRIGIDO (revisão pós-commit e5a2000): a versão anterior usava
-- `CREATE OR REPLACE FUNCTION`, que é idempotente pra CRIAR mas NÃO é seguro quando o objeto já
-- existe com um corpo diferente — `CREATE OR REPLACE` SEMPRE substitui, incondicionalmente. Se
-- esta migration fosse aplicada num banco onde 20260809020000 já rodou antes (produção, qualquer
-- staging real, ou uma reaplicação fora de ordem), o CREATE OR REPLACE apagaria a função completa
-- de produção (funil, minhas_vendas, comissão por corretor, etc. — usada por vários painéis do
-- dashboard) e a substituiria por este stub vazio (`select '{}'::jsonb`) — quebrando o dashboard
-- pra todo mundo. As outras 3 migrations deste catch-up usam ADD COLUMN IF NOT EXISTS, que o
-- Postgres já pula sozinho quando a coluna existe (idempotência de verdade, garantida pelo
-- próprio comando) — CREATE OR REPLACE FUNCTION não tem esse mesmo comportamento, então precisa
-- da checagem condicional explícita abaixo.
--
-- Correção: bloco DO com to_regprocedure('public.dashboard_stats()') — só executa o CREATE FUNCTION
-- (sem OR REPLACE) quando a função ainda não existe. Se já existir (produção, ou qualquer banco
-- que já passou por 20260809020000), este catch-up não faz absolutamente nada — nem lê nem toca
-- no corpo existente. CREATE FUNCTION (sem OR REPLACE) só roda dentro do EXECUTE, então nunca é
-- avaliado quando a condição é falsa.
--
-- Stub mínimo só pra existir o objeto no caminho vazio — ninguém CHAMA dashboard_stats() entre
-- este ponto e 20260809020000 (confirmado por busca no repo), que já faz CREATE OR REPLACE com a
-- lógica real por cima deste stub num banco vazio (ali sim é seguro: nesse ponto do histórico é
-- sempre ESTE stub que está sendo substituído, nunca uma versão de produção). Mesma assinatura
-- (sem argumentos, retorna jsonb) da definição real, pra REVOKE/GRANT EXECUTE encontrarem a
-- função certa em qualquer um dos dois caminhos.
DO $catchup$
BEGIN
  IF to_regprocedure('public.dashboard_stats()') IS NULL THEN
    EXECUTE $create$
      CREATE FUNCTION public.dashboard_stats()
       RETURNS jsonb
       LANGUAGE sql
       STABLE
       SET search_path TO 'public'
      AS $function$
        SELECT '{}'::jsonb;
      $function$
    $create$;
  END IF;
END;
$catchup$;
