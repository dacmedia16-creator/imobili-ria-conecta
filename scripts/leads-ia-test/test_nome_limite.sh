#!/bin/bash
# Migration 20261028100000 (t_228659f0) em banco descartável (só 127.0.0.1): setup -> migrations anteriores ->
# migration -> testes -> rollback -> confere volta ao original -> reaplicação. Nada remoto.
# Uso: bash scripts/leads-ia-test/test_nome_limite.sh t2286
set -e
DB=${1:-t2286}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
M=$W/supabase/migrations/20261016200000_remax_xml_feed.sql
NEW=$W/supabase/migrations/20261028100000_leads_ia_nome_limite.sql
RB=$W/docs/sql/rollback/20261028100000_leads_ia_nome_limite.rollback.sql
ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1
{ sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_runs/,/^);/p' $M
  sed -n '/CREATE TABLE IF NOT EXISTS public.remax_xml_listings/,/^);/p' $M
  sed -n '/FUNCTION public.remax_xml_last_ok/,/^\$\$;/p' $M
  sed -n '/FUNCTION public.remax_xml_ingest/,/^END \$\$;/p' $M; } | $P
for m in 20261026190000_xml_feed_imobiliaria_nicole 20261027080000_xml_link_locacao_primeira_msg 20261027090000_leads_ia_imovel_parecido 20261027100000_aviso_sensivel_admin_principal 20261027110000_leads_ia_busca_nova 20261027120000_leads_ia_redige 20261027130000_leads_ia_validador_modo 20261027140000_leads_ia_caracteristica_conversa 20261027200000_leads_ia_6_correcoes 20261028000000_leads_ia_parecidos_quartos; do
  $P < "$W/supabase/migrations/$m.sql"
done
FN="remax_xml_ingest(uuid,jsonb,integer,timestamptz,text) lead_ia_retorno_receber(text,jsonb)"
hashes() { for f in $FN; do $P -tAc "SELECT md5(pg_get_functiondef('public.$f'::regprocedure))"; done | tr '\n' ' '; }
# O rollback volta às versões de PRODUÇÃO (lidas em 28/10): aplica-as antes para comparar igual com igual.
sed -n '/^CREATE OR REPLACE FUNCTION public.remax_xml_ingest/,/^END \$function\$;/p' $RB | $P
sed -n '/^CREATE OR REPLACE FUNCTION public.lead_ia_retorno_receber/,/^END \$function\$;/p' $RB | $P
ANTES=$(hashes)
echo "producao (md5): $ANTES"
$P < "$NEW"
echo "migration 20261028100000 ok"
$P -tA < "$W/scripts/leads-ia-test/test_nome_limite.sql" 2>&1 | grep -E "OK|FAIL|ERROR|RESULTADO" || true
$P < "$RB"
DEPOIS=$(hashes)
[ "$ANTES" = "$DEPOIS" ] && echo "rollback: 2 funções iguais à produção" || echo "FAIL rollback: funções diferentes"
$P -tAc "SELECT 'rollback: nome=' || (to_regprocedure('public.lead_ia_imoveis_nome(uuid,text,text,text[],integer)') IS NOT NULL)
  || ' coluna=' || (SELECT count(*) FROM information_schema.columns WHERE table_name = 'remax_xml_listings' AND column_name = 'busca_texto')"
$P < "$NEW"
$P -tAc "SELECT 'reaplicada: ' || (to_regprocedure('public.lead_ia_imoveis_nome(uuid,text,text,text[],integer)') IS NOT NULL)"
[ "${MANTER:-0}" = "1" ] || docker exec pgt-3284-db psql -U postgres -qc "DROP DATABASE IF EXISTS $DB"
