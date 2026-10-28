#!/usr/bin/env bash
# Transferência de captação (migration 20261028140000, t_997545e5) numa ÚNICA transação revertida:
# confere as definições atuais -> aplica a migration -> roda a suíte -> aplica o rollback -> confere que
# voltou igual -> reaplica a migration. Nada fica gravado. Nunca usar com produção.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-captacao-transferir-corretor.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261028140000_captacao_transferir_corretor.sql"
RB="$ROOT/supabase/rollback/20261028140000_captacao_transferir_corretor.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash ' || md5(string_agg(pg_get_functiondef(p.oid), '' ORDER BY p.proname)) FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('painel_equipe_dados','meu_realizado');"
{
  echo "BEGIN;"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration ok]"
  # A suíte cria dados fictícios; desfaz só ela antes de testar o rollback da migration.
  echo "SAVEPOINT suite;"
  strip "$HERE/captacao_transferir_corretor.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  echo "SELECT 'rollback: funcoes=' || count(*) FROM pg_proc WHERE proname IN ('exclusive_transferir','exclusive_transferencia_previa','exclusive_transferencia_destinos','exclusive_pode_transferir','exclusive_transferencia_destino_ok');"
  echo "SELECT 'rollback: coluna=' || count(*) FROM information_schema.columns WHERE table_name = 'exclusive_captures' AND column_name = 'captador_original_id';"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
