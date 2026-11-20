-- Rollback da migration 20261207120000 (painéis de metas 2027, etapa 3, t_863b7590).
-- Apaga SÓ as 7 funções novas. Elas não gravam nada, então não há dado a guardar antes.
BEGIN;
DROP FUNCTION IF EXISTS public.metas_equipe_realizado(date, date, uuid);
DROP FUNCTION IF EXISTS public.metas_equipe_planos(integer, uuid);
DROP FUNCTION IF EXISTS public.metas_equipe_escopo(uuid);
DROP FUNCTION IF EXISTS public.metas_equipe_times();
DROP FUNCTION IF EXISTS public.metas_equipe_broker();
DROP FUNCTION IF EXISTS public.metas_respostas_meta(jsonb);
DROP FUNCTION IF EXISTS public.metas_num(jsonb);
COMMIT;
