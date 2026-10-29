#!/usr/bin/env bash
# Testemunhas automáticas da captação (migration 20261029220000, t_e8078685) numa ÚNICA transação
# revertida: aplica a migration -> roda a suíte -> aplica o rollback -> reaplica. Nada fica gravado.
# Nunca usar com produção.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-clicksign-testemunhas-auto.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261029220000_captacao_testemunhas_automaticas.sql"
RB="$ROOT/supabase/rollback/20261029220000_captacao_testemunhas_automaticas.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/clicksign_testemunhas_auto.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "SELECT 'rollback: funcoes=' || count(*) FROM pg_proc WHERE proname LIKE 'exclusive_testemunha%';"
  echo "SELECT 'rollback: colunas=' || count(*) FROM information_schema.columns WHERE table_name='exclusive_captures' AND column_name IN ('testemunha_gestor_id','testemunhas_pdf');"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
