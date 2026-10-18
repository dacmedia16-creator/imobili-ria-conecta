#!/usr/bin/env bash
# Clicksign na VENDA (migration 20261018200000) numa ÚNICA transação revertida (homologação ou clone
# local, nunca produção). Aplica antes, só na transação, as migrations da captação que faltarem.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-clicksign-venda.sh
#  ou: PSQL_CMD="bash supabase/multiempresa/lpsql.sh" bash supabase/tests/run-clicksign-venda.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
if [ -n "${PSQL_CMD:-}" ]; then
  read -r -a RUN <<<"$PSQL_CMD"
else
  RUN=(psql "${PGCONN:?defina PGCONN (homologação ou clone, nunca produção) ou PSQL_CMD}" -X)
fi
{
  echo "BEGIN;"
  echo "SELECT to_regclass('public.clicksign_envelopes') IS NULL AS need_cap \\gset"
  echo "\\if :need_cap"
  strip "$ROOT/supabase/migrations/20261018120000_clicksign_captacao.sql"
  echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_manage_authorize(uuid)') IS NULL AS need_manage \\gset"
  echo "\\if :need_manage"
  strip "$ROOT/supabase/migrations/20261018150000_clicksign_gerenciar_envelope.sql"
  echo "\\endif"
  echo "\\echo [pre ok]"
  strip "$ROOT/supabase/migrations/20261018200000_clicksign_venda.sql"
  echo "\\echo [migration ok]"
  strip "$HERE/clicksign_venda.sql"
  echo "ROLLBACK;"
  echo "\\echo [rollback da transação ok]"
} | "${RUN[@]}" -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|DIAG)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
