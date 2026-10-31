#!/usr/bin/env bash
# Nomes dos proprietários no Feedback (migration 20261030160000, t_28136145) numa ÚNICA transação revertida:
# migration -> suíte -> rollback (confere função removida) -> reaplica. Nada fica gravado.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-feedback-nomes-proprietarios.sh
# PREP (opcional): arquivos SQL (caminho absoluto) que alinham o banco local com a main, só nesta transação.
# Nunca usar com produção.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261030160000_feedback_nomes_proprietarios.sql"
RB="$ROOT/supabase/rollback/20261030160000_feedback_nomes_proprietarios.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  for f in ${PREP:-}; do strip "$f"; done
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/feedback_nomes_proprietarios.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "SELECT 'rollback: funcao=' || count(*) FROM pg_proc WHERE proname = 'owner_feedback_proprietarios';"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
