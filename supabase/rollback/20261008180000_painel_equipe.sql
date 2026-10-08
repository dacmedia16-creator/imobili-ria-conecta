-- Rollback de 20261008180000_painel_equipe.sql
-- Remove só as quatro funções novas do Painel da Equipe. Vendas, equipes, metas e a Produção por
-- pessoa não são tocadas. Fazer junto com o rollback do frontend (a tela nova chama estas funções).
-- Depois de rodar, remover a linha 20261008180000 de supabase_migrations.schema_migrations.
BEGIN;
DROP FUNCTION IF EXISTS public.painel_equipe_dados(uuid, date);
DROP FUNCTION IF EXISTS public.painel_equipe_equipes();
DROP FUNCTION IF EXISTS public.painel_equipe_pertence(uuid, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.painel_equipe_permitido(uuid);
COMMIT;
