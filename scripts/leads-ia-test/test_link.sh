#!/bin/bash
# Migration 20261027080000 (link do anúncio + locação + 1ª mensagem com o imóvel, t_25fe1197) em banco
# descartável (só 127.0.0.1): setup do XML -> 20261027080000 -> testes -> 20261027090000 (parecido) ->
# testes do parecido -> rollback das duas (ordem inversa) -> conferência -> reaplicação.
# Uso: bash scripts/leads-ia-test/test_link.sh t25fe
set -e
DB=${1:-t25fe}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
M=$W/supabase/migrations/20261016200000_remax_xml_feed.sql
NEW=$W/supabase/migrations/20261027080000_xml_link_locacao_primeira_msg.sql
PAR=$W/supabase/migrations/20261027090000_leads_ia_imovel_parecido.sql
RB=$W/docs/sql/rollback/20261027080000_xml_link_locacao_primeira_msg.rollback.sql
RBP=$W/docs/sql/rollback/20261027090000_leads_ia_imovel_parecido.rollback.sql
ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1
{ sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_runs/,/^);/p' $M
  sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_listings/,/^);/p' $M
  sed -n '/FUNCTION public.remax_xml_last_ok/,/^\$\$;/p' $M
  sed -n '/FUNCTION public.remax_xml_ingest/,/^END \$\$;/p' $M; } | $P
$P < "$W/supabase/migrations/20261026190000_xml_feed_imobiliaria_nicole.sql"
# Rollback precisa das funções do mapa/Feedback como em produção (20261016200000): só para o teste.
$P -c "CREATE OR REPLACE FUNCTION public.remax_xml_can_read() RETURNS boolean LANGUAGE sql AS 'SELECT true'" \
   -c "CREATE OR REPLACE FUNCTION public.owner_feedback_enabled() RETURNS boolean LANGUAGE sql AS 'SELECT true'" \
   -c "CREATE OR REPLACE FUNCTION public.mt_1b_gate() RETURNS boolean LANGUAGE sql AS 'SELECT true'" \
   -c "CREATE OR REPLACE FUNCTION public.exclusive_actor_active(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true'" \
   -c "CREATE OR REPLACE FUNCTION public.exclusive_capture_enabled() RETURNS boolean LANGUAGE sql AS 'SELECT true'" \
   -c "CREATE OR REPLACE FUNCTION public.exclusive_can_view(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true'" \
   -c "CREATE OR REPLACE FUNCTION public.remax_xml_broker_match(uuid) RETURNS TABLE(agent_id text, profile_id uuid) LANGUAGE sql AS 'SELECT NULL::text, NULL::uuid WHERE false'" \
   -c "CREATE OR REPLACE FUNCTION public.is_lead_of(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false'" \
   -c "ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS mapa_site_enabled boolean DEFAULT true" \
   -c "CREATE TABLE IF NOT EXISTS public.remax_site_listings (organization_id uuid, code_key text, exclusivo boolean)" \
   -c "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS remax_id text" >/dev/null 2>&1 || true
$P < "$NEW"
echo "migration 20261027080000 ok"
$P -tA < "$W/scripts/leads-ia-test/test_link.sql" 2>&1 | grep -E "RESULTADO|FAIL|ERROR|PREVIA" || true
$P < "$PAR"
echo "migration 20261027090000 ok (depois da 080000; os testes dela ficam em test_parecido.sh)"
# Rollback na ordem inversa, com dados dentro.
$P < "$RBP"
$P < "$RB"
$P -tAc "SELECT 'rollback_resto: ' || ((SELECT count(*) FROM pg_proc WHERE proname IN ('xml_url_anuncio_ok','xml_url_host','lead_ia_reais_curto','lead_ia_xml_frase_msg','lead_ia_primeira_atualizar','lead_ia_imoveis_parecidos'))
  + (SELECT count(*) FROM information_schema.columns WHERE table_name = 'remax_xml_listings' AND column_name IN ('negocio','preco_aluguel'))
  + (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_lead_ia_primeira_atualizar'))
  || ' / links_nao_remax: ' || (SELECT count(*) FROM public.remax_xml_listings WHERE url !~ 'remax\.com\.br')
  || ' / default_ia_nome: ' || (SELECT column_default FROM information_schema.columns WHERE table_name = 'lead_config' AND column_name = 'ia_nome')
  || ' / msg_padrao_antiga: ' || (pg_get_functiondef('public.lead_ia_primeira_msg(public.leads,public.lead_config,text)'::regprocedure) ~ 'assistente virtual da')"
$P < "$NEW"
$P < "$PAR"
$P -tAc "SELECT 'reaplicada: ' || (to_regprocedure('public.xml_url_anuncio_ok(text)') IS NOT NULL AND to_regprocedure('public.lead_ia_imoveis_parecidos(uuid,text[],numeric,numeric,text,text,integer,boolean,text)') IS NOT NULL)"
