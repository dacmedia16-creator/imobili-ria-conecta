#!/bin/bash
# Migration 20261027200000 (t_82c89141) em banco descartável (só 127.0.0.1): setup -> migrations anteriores ->
# migration -> testes -> rollback -> confere volta ao original -> reaplicação.
# Uso: bash scripts/leads-ia-test/test_6_correcoes.sh t82c8
set -e
DB=${1:-t82c8}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
M=$W/supabase/migrations/20261016200000_remax_xml_feed.sql
NEW=$W/supabase/migrations/20261027200000_leads_ia_6_correcoes.sql
RB=$W/docs/sql/rollback/20261027200000_leads_ia_6_correcoes.rollback.sql
ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1
{ sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_runs/,/^);/p' $M
  sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_listings/,/^);/p' $M
  sed -n '/FUNCTION public.remax_xml_last_ok/,/^\$\$;/p' $M
  sed -n '/FUNCTION public.remax_xml_ingest/,/^END \$\$;/p' $M; } | $P
for m in 20261026190000_xml_feed_imobiliaria_nicole 20261027080000_xml_link_locacao_primeira_msg 20261027090000_leads_ia_imovel_parecido 20261027100000_aviso_sensivel_admin_principal 20261027110000_leads_ia_busca_nova 20261027120000_leads_ia_redige 20261027130000_leads_ia_validador_modo 20261027140000_leads_ia_caracteristica_conversa; do
  $P < "$W/supabase/migrations/$m.sql"
done
$P -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY)"
FN="lead_ia_imoveis_parecidos(uuid,text[],numeric,numeric,text,text,integer,boolean,text) lead_ia_registrar_cliente(uuid,text,text) lead_grupo_olx_receber(text,jsonb) lead_ia_retorno_receber(text,jsonb)"
hashes() { for f in $FN; do $P -tAc "SELECT md5(pg_get_functiondef('public.$f'::regprocedure))"; done | tr '\n' ' '; }
ANTES=$(hashes)
$P < "$NEW"
echo "migration 20261027200000 ok"
$P -tA < "$W/scripts/leads-ia-test/test_6_correcoes.sql" 2>&1 | grep -E "RESULTADO|FAIL|ERROR" || true
$P < "$RB"
DEPOIS=$(hashes)
[ "$ANTES" = "$DEPOIS" ] && echo "rollback: 4 funções iguais ao original" || echo "FAIL rollback: funções diferentes"
$P -tAc "SELECT 'rollback: espera=' || (SELECT count(*) FROM pg_proc WHERE proname = 'lead_ia_espera_preparar')
  || ' avisos=' || (to_regclass('public.lead_portal_avisos') IS NOT NULL)
  || ' colunas=' || (SELECT count(*) FROM information_schema.columns WHERE column_name IN ('ia_espera_min','leads_juntar_horas','espera_em','equipe_em'))"
$P < "$NEW"
$P -tAc "SELECT 'reaplicada: ' || (to_regprocedure('public.lead_ia_espera_preparar()') IS NOT NULL)"
[ "${MANTER:-0}" = "1" ] || docker exec pgt-3284-db psql -U postgres -qc "DROP DATABASE IF EXISTS $DB"
