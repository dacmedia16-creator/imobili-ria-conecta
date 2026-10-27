#!/bin/bash
# Migration 20261027110000 (Nicole: busca nova no meio da conversa, t_5b493bc9) em banco descartável
# (só 127.0.0.1): setup do XML -> migrations anteriores -> migration -> testes -> rollback -> reaplicação.
# Uso: bash scripts/leads-ia-test/test_busca_nova.sh t5b49
set -e
DB=${1:-t5b49}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
M=$W/supabase/migrations/20261016200000_remax_xml_feed.sql
NEW=$W/supabase/migrations/20261027110000_leads_ia_busca_nova.sql
RB=$W/docs/sql/rollback/20261027110000_leads_ia_busca_nova.rollback.sql
ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1
{ sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_runs/,/^);/p' $M
  sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_listings/,/^);/p' $M
  sed -n '/FUNCTION public.remax_xml_last_ok/,/^\$\$;/p' $M
  sed -n '/FUNCTION public.remax_xml_ingest/,/^END \$\$;/p' $M; } | $P
$P < "$W/supabase/migrations/20261026190000_xml_feed_imobiliaria_nicole.sql"
$P < "$W/supabase/migrations/20261027080000_xml_link_locacao_primeira_msg.sql"
$P < "$W/supabase/migrations/20261027090000_leads_ia_imovel_parecido.sql"
$P < "$NEW"
echo "migration 20261027110000 ok"
$P -tA < "$W/scripts/leads-ia-test/test_busca_nova.sql" 2>&1 | grep -E "RESULTADO|FAIL|ERROR" || true
$P < "$RB"
$P -tAc "SELECT 'rollback_resto: ' || (SELECT count(*) FROM pg_proc WHERE proname = 'lead_ia_imoveis_busca')
  || ' / parecidos_intacta: ' || (to_regprocedure('public.lead_ia_imoveis_parecidos(uuid,text[],numeric,numeric,text,text,integer,boolean,text)') IS NOT NULL)
  || ' / imoveis: ' || (SELECT count(*) FROM public.remax_xml_listings)"
$P < "$NEW"
$P -tAc "SELECT 'reaplicada: ' || (to_regprocedure('public.lead_ia_imoveis_busca(uuid,text,text,numeric,numeric,text,text,text[],integer)') IS NOT NULL)"
[ "${MANTER:-0}" = "1" ] || docker exec pgt-3284-db psql -U postgres -qc "DROP DATABASE IF EXISTS $DB"
