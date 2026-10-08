-- Rollback de 20261009010000_feedback_captacao_plano.sql.
-- ATENÇÃO: apaga as ligações captação <-> anúncio e as marcações do Plano feitas desde a publicação.
-- Antes de rodar em produção, exporte as duas tabelas (as provas no storage continuam guardadas).
-- O histórico da captação (exclusive_history) é mantido.
-- Depois de rodar, remover a linha 20261009010000 de supabase_migrations.schema_migrations.
BEGIN;
DROP TRIGGER IF EXISTS trg_zz_exclusive_plan_change ON public.exclusive_captures;
DROP POLICY IF EXISTS exclusive_plan_proof_insert ON storage.objects;
DROP POLICY IF EXISTS exclusive_plan_proof_read ON storage.objects;
DROP FUNCTION IF EXISTS public.owner_feedback_captacao(text);
DROP FUNCTION IF EXISTS public.exclusive_feedback_pendencias(integer);
DROP FUNCTION IF EXISTS public.exclusive_plan_change_log();
DROP FUNCTION IF EXISTS public.exclusive_plan_unmark(uuid, uuid);
DROP FUNCTION IF EXISTS public.exclusive_plan_mark(uuid, uuid, date, text, text);
DROP FUNCTION IF EXISTS public.exclusive_plan_view(uuid);
DROP FUNCTION IF EXISTS public.exclusive_listing_unlink(uuid, text);
DROP FUNCTION IF EXISTS public.exclusive_listing_decide(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.exclusive_listing_link(uuid, text);
DROP FUNCTION IF EXISTS public.exclusive_listing_check(uuid, text);
DROP FUNCTION IF EXISTS public.exclusive_listing_context(uuid);
DROP FUNCTION IF EXISTS public.exclusive_proxima_segunda();
DROP FUNCTION IF EXISTS public.exclusive_listing_seen(uuid, text);
DROP TABLE IF EXISTS public.exclusive_plan_done;
DROP TABLE IF EXISTS public.exclusive_listing_links;
DROP FUNCTION IF EXISTS public.exclusive_aprovada_em(uuid);
DROP FUNCTION IF EXISTS public.exclusive_plan_prazo_dias(text);
DROP FUNCTION IF EXISTS public.portal_code_key(text);
COMMIT;
