#!/usr/bin/env bash
# Trava de valores do Meu Plano 2027 (migration 20261209120000, t_125c4dd3) numa ÚNICA transação revertida
# (homologação ou banco descartável, NUNCA produção): fingerprint A -> up -> suíte -> rollback ->
# fingerprint == A -> reaplica 2x (idempotência) -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-meu-plano-trava-valores.sh
#      MIG=<outro arquivo> para o controle negativo (a suíte tem de falhar).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
V=20261209120000
MIG="${MIG:-$ROOT/supabase/migrations/${V}_meu_plano_trava_valores.sql}"
RB="$ROOT/supabase/rollback/${V}_meu_plano_trava_valores.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname FROM pg_policies) s),''));"
{
  echo "BEGIN;"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/meu_plano_trava_valores.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  strip "$MIG"
  strip "$MIG"
  echo "\\echo [reaplicada 2x ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
