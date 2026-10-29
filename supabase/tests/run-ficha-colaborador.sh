#!/usr/bin/env bash
# Ficha do colaborador (migration 20261029130000, t_618b64bc) numa ÚNICA transação revertida:
# aplica a migration -> roda a suíte -> aplica o rollback -> confere que sumiu -> reaplica.
# Nada fica gravado. Nunca usar com produção.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-ficha-colaborador.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261029130000_ficha_colaborador.sql"
RB="$ROOT/docs/sql/rollback/20261029130000_ficha_colaborador.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/ficha_colaborador.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "SELECT 'rollback: funcoes=' || count(*) FROM pg_proc WHERE proname LIKE 'ficha\\_%' AND proname IN ('ficha_minha_situacao','ficha_salvar_minha','ficha_colaboradores_listar','ficha_config_salvar','ficha_sessao_restrita','ficha_esta_completa','ficha_obrigatoria_desde','ficha_pode_ver_colaboradores','ficha_colaboradores_registrar_exportacao');"
  echo "SELECT 'rollback: tabelas=' || count(*) FROM pg_class WHERE relname IN ('colaborador_fichas','ficha_config') AND relnamespace = 'public'::regnamespace;"
  echo "SELECT 'rollback: nascimento preservada=' || (to_regclass('public.profile_birthdates') IS NOT NULL);"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
