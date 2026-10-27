#!/bin/bash
# Migration 20261027130000 (t_a9f1b447) em banco descartável (só 127.0.0.1): setup -> migrations anteriores ->
# migration -> testes -> rollback -> confere volta ao original -> reaplicação.
# Uso: bash scripts/leads-ia-test/test_caracteristica.sh ta9f1
set -e
DB=${1:-ta9f1}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
M=$W/supabase/migrations/20261016200000_remax_xml_feed.sql
NEW=$W/supabase/migrations/20261027130000_leads_ia_caracteristica_conversa.sql
RB=$W/docs/sql/rollback/20261027130000_leads_ia_caracteristica_conversa.rollback.sql
ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1
{ sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_runs/,/^);/p' $M
  sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_listings/,/^);/p' $M
  sed -n '/FUNCTION public.remax_xml_last_ok/,/^\$\$;/p' $M
  sed -n '/FUNCTION public.remax_xml_ingest/,/^END \$\$;/p' $M; } | $P
for m in 20261026190000_xml_feed_imobiliaria_nicole 20261027080000_xml_link_locacao_primeira_msg 20261027090000_leads_ia_imovel_parecido 20261027110000_leads_ia_busca_nova 20261027120000_leads_ia_redige; do
  $P < "$W/supabase/migrations/$m.sql"
done
ANTES=$($P -tAc "SELECT md5(pg_get_functiondef('public.lead_ia_retorno_receber(text,jsonb)'::regprocedure))")
$P < "$NEW"
echo "migration 20261027130000 ok"
$P -tA < "$W/scripts/leads-ia-test/test_caracteristica.sql" 2>&1 | grep -E "RESULTADO|FAIL|ERROR" || true
$P < "$RB"
DEPOIS=$($P -tAc "SELECT md5(pg_get_functiondef('public.lead_ia_retorno_receber(text,jsonb)'::regprocedure))")
$P -tAc "SELECT 'rollback: carac_resto=' || (SELECT count(*) FROM pg_proc WHERE proname = 'lead_ia_imoveis_caracteristica')"
[ "$ANTES" = "$DEPOIS" ] && echo "rollback: retorno_receber igual ao original" || echo "FAIL rollback: retorno_receber diferente"
$P < "$NEW"
$P -tAc "SELECT 'reaplicada: ' || (to_regprocedure('public.lead_ia_imoveis_caracteristica(uuid,text,integer,integer,integer,numeric,text,text,numeric,numeric,text,text[],integer)') IS NOT NULL)"
[ "${MANTER:-0}" = "1" ] || docker exec pgt-3284-db psql -U postgres -qc "DROP DATABASE IF EXISTS $DB"
