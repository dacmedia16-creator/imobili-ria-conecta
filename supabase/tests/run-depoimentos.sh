#!/usr/bin/env bash
# Depoimentos (migration 20261102120000, t_c7cfaf00) numa ÚNICA transação revertida:
# aplica a migration -> roda a suíte -> aplica o rollback -> confere que sumiu -> reaplica.
# Nada fica gravado. Nunca usar com produção.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-depoimentos.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261102120000_depoimentos.sql"
RB="$ROOT/supabase/rollback/20261102120000_depoimentos.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
# Pré-requisito (já em produção desde 29/10): ficha_sessao_restrita() vem da ficha do colaborador.
# O clone local pode não ter; só é aplicada aqui se faltar (dentro da mesma transação desfeita).
PRE="$ROOT/supabase/migrations/20261029130000_ficha_colaborador.sql"
TEM_FICHA="$($PSQL -X -At -c "select to_regprocedure('public.ficha_sessao_restrita()') is not null" | tr -d '[:space:]')"
{
  echo "BEGIN;"
  if [ "$TEM_FICHA" != "t" ]; then strip "$PRE"; echo "\\echo [pre-requisito ficha aplicado]"; fi
  strip "$MIG"
  echo "\\echo [migration ok]"
  strip "$MIG"
  echo "\\echo [idempotente ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/depoimentos.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "SELECT 'rollback: funcoes=' || count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'depoimento\\_%' OR proname = 'depoimentos_publicos');"
  echo "SELECT 'rollback: tabelas=' || count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'depoimento%' AND relkind = 'r';"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
