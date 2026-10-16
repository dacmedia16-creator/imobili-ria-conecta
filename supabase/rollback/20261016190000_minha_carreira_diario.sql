-- Rollback da migration 20261016190000_minha_carreira_diario.sql (Minha carreira, PR 5: diário).
-- Remove as RPCs e a tabela do diário (os registros do diário são perdidos). Ranking e demais
-- etapas não são tocados.
BEGIN;
DROP FUNCTION IF EXISTS public.carreira_diario_equipe(date, date);
DROP FUNCTION IF EXISTS public.meu_diario_contagens();
DROP TABLE IF EXISTS public.carreira_diario;
DROP FUNCTION IF EXISTS public.carreira_diario_validar();
COMMIT;
