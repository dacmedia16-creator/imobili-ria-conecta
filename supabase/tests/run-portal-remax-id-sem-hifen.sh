#!/usr/bin/env bash
# Código do anúncio sem hífen (migration 20261008230000) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção). Aplica antes, só na transação, as migrations de portal/Feedback
# que faltarem no alvo.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-portal-remax-id-sem-hifen.sh [--rollback]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
M="$ROOT/supabase/migrations"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
cond() { # cond <variavel> <sql booleano> <migration>
  echo "SELECT ($2) AS $1 \\gset"
  echo "\\if :$1"
  strip "$M/$3"
  echo "\\endif"
}
{
  echo "BEGIN;"
  cond need_remax "NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'remax_id')" 20261006100000_profiles_remax_id.sql
  cond need_portal "to_regclass('public.portal_listing_snapshots') IS NULL" 20261006120000_portal_metrics.sql
  cond need_relink "to_regprocedure('public.portal_relink_broker()') IS NULL" 20261006150000_portal_relink_on_remax_id.sql
  cond need_fbmod "NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_modules_module_check' AND pg_get_constraintdef(oid) LIKE '%feedback_proprietario%')" 20261006170000_module_feedback_proprietario.sql
  echo "\\echo [pre ok]"
  strip "$HERE/portal_remax_id_sem_hifen_setup.sql"
  strip "$M/20261008230000_portal_remax_id_sem_hifen.sql"
  echo "\\echo [migration ok]"
  if [ "${1:-}" = "--rollback" ]; then
    strip "$ROOT/supabase/rollback/20261008230000_portal_remax_id_sem_hifen.sql"
    echo "\\echo [rollback ok]"
    echo "SELECT 'ok rollback: x16 volta sem remax_id e sem corretor' WHERE EXISTS (SELECT 1 FROM public.portal_listing_snapshots"
    echo "  WHERE listing_code = '630601901x16' AND collected_on = '2026-01-05' AND remax_id IS NULL AND broker_id IS NULL);"
    echo "SELECT 'ok rollback: com hífen continua ligado' WHERE EXISTS (SELECT 1 FROM public.portal_listing_snapshots"
    echo "  WHERE listing_code = '630601901-5' AND collected_on = '2026-01-05' AND broker_id IS NOT NULL);"
  else
    strip "$HERE/portal_remax_id_sem_hifen.sql"
  fi
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|INFO)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
