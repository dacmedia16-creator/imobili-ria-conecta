#!/bin/bash
# Migration 20261028190000 (t_b3f753a5) em banco descartável (só 127.0.0.1): setup -> migrations anteriores ->
# migration -> testes -> rollback -> confere volta -> reaplicação. Nada remoto.
# Uso: bash scripts/leads-ia-test/test_toque15.sh tb3f7
set -e
DB=${1:-tb3f7}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
M=$W/supabase/migrations/20261016200000_remax_xml_feed.sql
NEW=$W/supabase/migrations/20261028190000_leads_ia_toque15.sql
RB=$W/docs/sql/rollback/20261028190000_leads_ia_toque15.rollback.sql
ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1
{ sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_runs/,/^);/p' $M
  sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_listings/,/^);/p' $M
  sed -n '/FUNCTION public.remax_xml_last_ok/,/^\$\$;/p' $M
  sed -n '/FUNCTION public.remax_xml_ingest/,/^END \$\$;/p' $M; } | $P
for m in 20261026190000_xml_feed_imobiliaria_nicole 20261027080000_xml_link_locacao_primeira_msg 20261027090000_leads_ia_imovel_parecido 20261027100000_aviso_sensivel_admin_principal 20261027110000_leads_ia_busca_nova 20261027120000_leads_ia_redige 20261027130000_leads_ia_validador_modo 20261027140000_leads_ia_caracteristica_conversa 20261027200000_leads_ia_6_correcoes 20261028000000_leads_ia_parecidos_quartos 20261028100000_leads_ia_nome_limite; do
  $P < "$W/supabase/migrations/$m.sql"
done
H() { $P -tAc "SELECT md5(pg_get_functiondef('public.lead_ia_reengajar_reservar()'::regprocedure)) || ' ' || (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('lead_config','lead_conversas'))"; }
ANTES=$(H)
$P < "$NEW"
echo "migration 20261028190000 ok"
$P -tA < "$W/scripts/leads-ia-test/test_toque15.sql" 2>&1 | grep -E "RESULTADO|FAIL|ERROR" || true
$P < "$RB"
DEPOIS=$(H)
[ "$ANTES" = "$DEPOIS" ] && echo "rollback: reengajamento e colunas iguais ao original" || echo "FAIL rollback: diferente ($ANTES / $DEPOIS)"
$P -tAc "SELECT 'rollback: funcoes toque15=' || (SELECT count(*) FROM pg_proc WHERE proname LIKE 'lead_ia_toque15%')"
$P < "$NEW"
$P -tAc "SELECT 'reaplicada: ' || (to_regprocedure('public.lead_ia_toque15_gravar(uuid,uuid,text)') IS NOT NULL)"
[ "${MANTER:-0}" = "1" ] || docker exec pgt-3284-db psql -U postgres -qc "DROP DATABASE IF EXISTS $DB"
