#!/bin/bash
# Migration 20261027090000 (Nicole oferece imóvel parecido do XML, t_232e13cb) em banco descartável
# (só 127.0.0.1): setup do XML (test_xml.sh sem os testes dele) -> migration -> testes -> rollback -> reaplicação.
# Uso: bash scripts/leads-ia-test/test_parecido.sh t232e
set -e
DB=${1:-t232e}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
M=$W/supabase/migrations/20261016200000_remax_xml_feed.sql
NEW=$W/supabase/migrations/20261027090000_leads_ia_imovel_parecido.sql
RB=$W/docs/sql/rollback/20261027090000_leads_ia_imovel_parecido.rollback.sql
ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1
{ sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_runs/,/^);/p' $M
  sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_listings/,/^);/p' $M
  sed -n '/FUNCTION public.remax_xml_last_ok/,/^\$\$;/p' $M
  sed -n '/FUNCTION public.remax_xml_ingest/,/^END \$\$;/p' $M; } | $P
$P < "$W/supabase/migrations/20261026190000_xml_feed_imobiliaria_nicole.sql"
$P < "$W/supabase/migrations/20261027080000_xml_link_locacao_primeira_msg.sql"  # negocio/aluguel/link (t_25fe1197)
$P < "$NEW"
echo "migration 20261027090000 ok"
$P -tA < "$W/scripts/leads-ia-test/test_parecido.sql" 2>&1 | grep -E "RESULTADO|FAIL|ERROR" || true
$P < "$RB"
$P -tAc "SELECT 'rollback_resto: ' || (SELECT count(*) FROM pg_proc WHERE proname = 'lead_ia_imoveis_parecidos')
  || ' / ficha_xml_intacta: ' || (to_regprocedure('public.lead_ia_ficha_xml(uuid,text)') IS NOT NULL)
  || ' / imoveis: ' || (SELECT count(*) FROM public.remax_xml_listings)"
$P < "$NEW"
$P -tAc "SELECT 'reaplicada: ' || (to_regprocedure('public.lead_ia_imoveis_parecidos(uuid,text[],numeric,numeric,text,text,integer,boolean,text)') IS NOT NULL)"
