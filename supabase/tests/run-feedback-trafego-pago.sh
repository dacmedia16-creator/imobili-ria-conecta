#!/usr/bin/env bash
# Tráfego pago manual no Feedback (migration 20261224120000, t_f3f64be0) numa ÚNICA transação revertida:
# impressão digital -> migration -> suíte -> rollback -> confere impressão igual -> reaplica. Nada fica gravado.
# Uso: PSQL="psql <conexão da homologação>" bash supabase/tests/run-feedback-trafego-pago.sh
# Sai com código 1 se houver FALHA. Nunca usar com produção.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="${MIG:-$ROOT/supabase/migrations/20261224120000_feedback_trafego_pago.sql}"
RB="$ROOT/supabase/rollback/20261224120000_feedback_trafego_pago.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'fp ' || md5(coalesce(string_agg(d, '' ORDER BY d), '')) FROM (
  SELECT p.proname || pg_get_function_identity_arguments(p.oid) || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '') AS d
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT c.relname || coalesce(c.relacl::text, '') FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m')
  UNION ALL SELECT polrelid::regclass::text || polname || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '') FROM pg_policy) x;"
OUT="$({
  echo "BEGIN;"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/feedback_trafego_pago.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "SELECT 'rollback: tabela=' || coalesce(to_regclass('public.listing_paid_traffic_entries')::text, 'removida');"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|fp|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true)"
echo "$OUT"
FPS="$(echo "$OUT" | grep '^fp ' | sort -u | wc -l)"
[ "$FPS" = "1" ] && echo "rollback volta a impressão digital: SIM" || { echo "rollback volta a impressão digital: NAO"; exit 1; }
echo "$OUT" | grep -q -E '^FALHA|ERROR' && exit 1
echo "$OUT" | grep -q '^\[reaplicada ok\]' || exit 1
