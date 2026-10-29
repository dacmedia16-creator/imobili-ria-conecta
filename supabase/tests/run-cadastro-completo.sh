#!/usr/bin/env bash
# Cadastro completo no aviso da ficha (migration 20261029160000, t_b98f3e4b) numa ÚNICA transação
# revertida: aplica a ficha (130000) + esta migration -> roda a suíte -> rollback -> confere -> reaplica.
# Nada fica gravado. Nunca usar com produção.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-cadastro-completo.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
FICHA="$ROOT/supabase/migrations/20261029130000_ficha_colaborador.sql"
MIG="$ROOT/supabase/migrations/20261029160000_cadastro_completo_ficha.sql"
RB="$ROOT/docs/sql/rollback/20261029160000_cadastro_completo_ficha.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  echo "SELECT 1 FROM pg_proc WHERE proname = 'ficha_minha_situacao' HAVING count(*) = 0;"
  strip "$FICHA"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/cadastro_completo.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  echo "SAVEPOINT ficha;"
  echo "\\echo [suite da ficha com o cadastro]"
  strip "$HERE/ficha_colaborador.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT ficha;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "SELECT 'rollback: novas=' || count(*) FROM pg_proc WHERE proname IN ('cadastro_salvar_meu','cadastro_pendencias','cadastro_exige_registro','profiles_remax_id_padrao');"
  echo "SELECT 'rollback: situacao_sem_cadastro=' || (position('cadastro' in prosrc) = 0) FROM pg_proc WHERE proname = 'ficha_minha_situacao';"
  echo "SELECT 'rollback: indice_global=' || count(*) FROM pg_indexes WHERE indexname = 'profiles_remax_id_uniq';"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
