#!/bin/bash
# Migration 20261026190000 (Link do XML + Nicole lendo o XML, t_76243950) em banco descartável (só 127.0.0.1):
# setup (roteiro) -> pré-requisitos do XML -> migration -> testes -> rollback -> reaplicação.
# Uso: bash scripts/leads-ia-test/test_xml.sh t7624
set -e
DB=${1:-t7624}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
M=$W/supabase/migrations/20261016200000_remax_xml_feed.sql
NEW=$W/supabase/migrations/20261026190000_xml_feed_imobiliaria_nicole.sql
ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1
# Pré-requisitos (produção: 20261016200000): só as tabelas, remax_xml_last_ok e a ingestão RE/MAX original.
{ sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_runs/,/^);/p' $M
  sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_listings/,/^);/p' $M
  sed -n '/FUNCTION public.remax_xml_last_ok/,/^\$\$;/p' $M
  sed -n '/FUNCTION public.remax_xml_ingest/,/^END \$\$;/p' $M; } | $P
$P < "$NEW"
echo "migration 20261026190000 ok"
$P -tA < "$W/scripts/leads-ia-test/test_xml.sql" 2>&1 | grep -E "RESULTADO|FAIL|ERROR" || true
# Rollback e reaplicação (com dados de teste dentro).
$P < "$W/docs/sql/rollback/20261026190000_xml_feed_imobiliaria_nicole.rollback.sql"
$P -tAc "SELECT 'rollback_resto: ' || ((to_regclass('public.organization_xml_feeds') IS NOT NULL)::int
  + (SELECT count(*) FROM pg_proc WHERE proname IN ('lead_ia_ficha_xml','lead_ia_frase','lead_ia_num','lead_ia_reais','platform_xml_feed_salvar'))
  + (SELECT count(*) FROM information_schema.columns WHERE table_name = 'remax_xml_listings' AND column_name IN ('titulo','condominio','iptu','suites','fotos_qtd')))"
$P -tAc "SELECT 'ingest_4_args: ' || (SELECT count(*) FROM pg_proc WHERE proname = 'remax_xml_ingest' AND pronargs = 4)
  || ' / 5_args: ' || (SELECT count(*) FROM pg_proc WHERE proname = 'remax_xml_ingest' AND pronargs = 5)"
$P -tAc "SELECT 'nicole_apos_rollback: ' || (public.lead_ia_registrar_cliente(cv.id, 'oi de novo', 'recebida') ? 'tem_captacao')
  FROM public.lead_conversas cv JOIN public.leads l ON l.id = cv.lead_id WHERE l.externo_id = 'x3'"
$P < "$NEW"
$P -tAc "SELECT 'reaplicada: ' || (to_regprocedure('public.lead_ia_ficha_xml(uuid,text)') IS NOT NULL)"
