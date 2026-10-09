-- Rollback de 20261009040000_remax_site_sugestao_anuncio.sql.
-- Apaga só os dados copiados do site público da RE/MAX (refeitos na próxima coleta) e a configuração dos
-- escritórios. Não toca em captações, ligações captação <-> anúncio (PR #56), Feedback, Vendas nem relatórios.
-- Antes: tirar "remax-site-collect" do nitro.config.ts e publicar (senão a coleta passa a falhar sem efeito).
-- Depois de rodar, remover a linha 20261009040000 de supabase_migrations.schema_migrations.
BEGIN;
DROP FUNCTION IF EXISTS public.remax_site_mark_failed(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.remax_site_ingest(uuid, jsonb, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.remax_site_collect_targets();
DROP FUNCTION IF EXISTS public.remax_site_offices_set(integer[]);
DROP FUNCTION IF EXISTS public.remax_site_offices_get();
DROP FUNCTION IF EXISTS public.remax_site_agent_names();
DROP FUNCTION IF EXISTS public.exclusive_site_provaveis();
DROP FUNCTION IF EXISTS public.exclusive_site_suggestions(uuid);
DROP FUNCTION IF EXISTS public.remax_site_rank(uuid, integer);
DROP FUNCTION IF EXISTS public.remax_site_last_ok(uuid);
DROP FUNCTION IF EXISTS public.remax_match(public.exclusive_captures, public.remax_site_listings);
DROP FUNCTION IF EXISTS public.remax_dist_m(double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.remax_valor(text);
DROP FUNCTION IF EXISTS public.remax_tipo_grupo(text);
DROP FUNCTION IF EXISTS public.remax_endereco_rua(text);
DROP FUNCTION IF EXISTS public.remax_endereco_numero(text);
DROP FUNCTION IF EXISTS public.remax_norm_rua(text);
DROP TABLE IF EXISTS public.remax_site_runs;
DROP TABLE IF EXISTS public.remax_site_agents;
DROP TABLE IF EXISTS public.remax_site_listings;
DROP TABLE IF EXISTS public.remax_site_offices;
COMMIT;
