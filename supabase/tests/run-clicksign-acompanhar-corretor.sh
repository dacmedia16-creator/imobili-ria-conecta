#!/usr/bin/env bash
# Corretor acompanha a Clicksign (migration 20261028180000, t_82e51349) numa ÚNICA transação revertida:
# confere as autorizações de escrita -> aplica a migration -> roda a suíte -> aplica o rollback ->
# confere que as de escrita não mudaram -> reaplica. Nada fica gravado. Nunca usar com produção.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-clicksign-acompanhar-corretor.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261028180000_clicksign_acompanhar_corretor.sql"
RB="$ROOT/supabase/rollback/20261028180000_clicksign_acompanhar_corretor.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash escrita ' || md5(string_agg(pg_get_functiondef(p.oid), '' ORDER BY p.proname)) FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('clicksign_manage_authorize',
  'clicksign_sale_manage_authorize','clicksign_reconcile_authorize','clicksign_capture_sender_ok',
  'clicksign_sender_ok','clicksign_capture_config','clicksign_sale_config');"
{
  echo "BEGIN;"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "$HASH"
  echo "SAVEPOINT suite;"
  strip "$HERE/clicksign_acompanhar_corretor.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "SELECT 'rollback: funcoes=' || count(*) FROM pg_proc WHERE proname IN ('clicksign_capture_view_authorize','clicksign_sale_view_authorize');"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
