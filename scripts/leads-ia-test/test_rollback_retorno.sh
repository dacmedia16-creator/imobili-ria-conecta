#!/bin/bash
# Rollback da 20261025200000 e reaplicação, em banco descartável (só 127.0.0.1). Uso: bash test_rollback_retorno.sh t6f68rb
set -e
DB=${1:-t6f68rb}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null
$P < "$W/docs/sql/rollback/20261025200000_leads_ia_retorno_ziontalk.rollback.sql"
$P -tAc "SELECT 'resto: ' || (SELECT count(*) FROM information_schema.columns WHERE table_name='lead_config' AND column_name ~ '^ia_(retorno|modelo|canal_numero|resp_)')
  + (SELECT count(*) FROM pg_proc WHERE proname IN ('lead_ia_retorno_receber','lead_ia_retorno_token','lead_ia_modelo_salvar','lead_ia_canal_numero_definir'))
  + (SELECT count(*) FROM pg_class WHERE relname IN ('lead_ia_uso','lead_ia_retorno_eventos'))"
$P -tAc "SELECT 'ia_anterior_ok: ' || (to_regclass('public.lead_conversas') IS NOT NULL AND to_regproc('public.lead_ia_aplicar') IS NOT NULL)"
$P < "$W/supabase/migrations/20261025200000_leads_ia_retorno_ziontalk.sql"
echo "reaplicada ok"
