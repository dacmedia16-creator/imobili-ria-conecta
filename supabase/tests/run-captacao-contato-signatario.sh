#!/usr/bin/env bash
# Contato do proprietário em captação já enviada (migration 20261109200000, t_867f464c) numa ÚNICA
# transação revertida (homologação ou clone, nunca produção): fingerprint A -> up -> suíte -> rollback ->
# fingerprint == A -> reaplica -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-captacao-contato-signatario.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261109200000_captacao_contato_signatario.sql"
RB="$ROOT/supabase/rollback/20261109200000_captacao_contato_signatario.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname FROM pg_policies WHERE schemaname='public') s),''));"
{
  echo "BEGIN;"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/captacao_contato_signatario.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
