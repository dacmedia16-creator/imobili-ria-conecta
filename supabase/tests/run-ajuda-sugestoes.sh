#!/usr/bin/env bash
# "Ajuda e sugestões" (migration 20261008220000) numa ÚNICA transação revertida (homologação ou clone,
# nunca produção). Aplica antes, só na transação, a migration da captação de 08/10 se faltar no alvo
# (ela troca a policy notif_insert e cria notifications.exclusive_capture_id).
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-ajuda-sugestoes.sh [--rollback]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
M="$ROOT/supabase/migrations"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  strip "$M/20261008220000_ajuda_sugestoes.sql"
  echo "\\echo [migration ok]"
  if [ "${1:-}" = "--rollback" ]; then
    strip "$ROOT/supabase/rollback/20261008220000_ajuda_sugestoes.sql"
    echo "\\echo [rollback ok]"
    echo "SELECT 'ok rollback: tabelas, coluna do sino e RPCs removidas' WHERE to_regclass('public.support_tickets') IS NULL"
    echo "  AND to_regclass('public.support_ticket_messages') IS NULL"
    echo "  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='support_ticket_id')"
    echo "  AND to_regprocedure('public.support_ticket_list(text)') IS NULL"
    echo "  AND to_regprocedure('public.support_ticket_print_path(uuid)') IS NULL;"
    echo "SELECT 'ok rollback: bucket fica privado (remover pelo painel)' WHERE (SELECT public FROM storage.buckets WHERE id='support-attachments') IS FALSE;"
  else
    strip "$HERE/ajuda_sugestoes.sql"
  fi
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|INFO)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
