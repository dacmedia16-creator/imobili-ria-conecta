#!/usr/bin/env bash
# "Ajuda MAX acompanha a Locação" (migration 20261118120000, t_8fd40b23) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção). Exige a 20261116120000 já aplicada no alvo.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-ajuda-max-segue-locacao.sh [--rollback]
# Com BASE_APLICADA=1 não reaplica a migration (alvo já migrado).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  if [ "${BASE_APLICADA:-0}" != "1" ]; then
    strip "$ROOT/supabase/migrations/20261118120000_ajuda_max_segue_locacao.sql"
    echo "\\echo [migration ok]"
  fi
  if [ "${1:-}" = "--rollback" ]; then
    strip "$ROOT/supabase/rollback/20261118120000_ajuda_max_segue_locacao.sql"
    echo "\\echo [rollback ok]"
    echo "SELECT 'ok rollback: volta a exigir a linha enabled=true' WHERE pg_get_functiondef('public.ajuda_max_locacao_enabled()'::regprocedure) LIKE '%AND EXISTS%m.enabled)%';"
  else
    strip "$HERE/ajuda_max_segue_locacao.sql"
  fi
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|INFO)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
