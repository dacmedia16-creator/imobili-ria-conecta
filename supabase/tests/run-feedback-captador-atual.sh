#!/usr/bin/env bash
# Feedback segue o captador atual (migration 20261028160000, t_a2436e9f) numa ÚNICA transação revertida:
# hash das definições atuais -> migration -> suíte -> rollback -> confere hash igual -> reaplica. Nada fica gravado.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-feedback-captador-atual.sh
# Nunca usar com produção.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261028160000_feedback_captador_atual.sql"
RB="$ROOT/supabase/rollback/20261028160000_feedback_captador_atual.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash ' || md5(string_agg(d, '' ORDER BY d)) FROM (
  SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('owner_feedback_can_edit','feedback_xml_base','owner_feedback_captacao')
  UNION ALL SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname = 'portal_snap_read') x;"
{
  echo "BEGIN;"
  # PREP (opcional): arquivos SQL (caminho absoluto) que alinham o banco local com a main, só nesta transação.
  for f in ${PREP:-}; do strip "$f"; done
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/feedback_captador_atual.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  echo "SELECT 'rollback: funcoes_novas=' || count(*) FROM pg_proc WHERE proname IN ('owner_feedback_captador','owner_feedback_responsavel_ok');"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
