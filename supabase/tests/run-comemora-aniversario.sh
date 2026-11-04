#!/usr/bin/env bash
# "Comemora aniversário?" (migration 20261104150000, t_2d5f0ab6) numa ÚNICA transação revertida:
# cadeia atual (nascimento + ficha) -> esta -> suíte nova + suítes antigas da ficha/nascimento ->
# rollback -> confere hashes iguais aos de antes -> reaplica. Nada fica gravado.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-comemora-aniversario.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIGS=(20261022120000_data_nascimento_cadastro 20261029130000_ficha_colaborador
      20261029160000_cadastro_completo_ficha 20261030100000_ficha_filhos_faixas 20261103180000_ficha_listar_avatar)
MIG="$ROOT/supabase/migrations/20261104150000_comemora_aniversario.sql"
RB="$ROOT/docs/sql/rollback/20261104150000_comemora_aniversario.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || string_agg(p.oid::regprocedure::text || '=' || md5(p.prosrc), ' ' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('profile_set_birthdate','profile_birthdate_set_for_user','profile_birthdate_info_for_user','achievement_birthdays','ficha_salvar_minha','ficha_minha_situacao','ficha_colaboradores_listar');"
{
  echo "BEGIN;"
  for m in "${MIGS[@]}"; do strip "$ROOT/supabase/migrations/$m.sql"; done
  echo "\\echo [antes]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT s1;"
  strip "$HERE/comemora_aniversario.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  for s in ficha_filhos_faixas ficha_colaborador cadastro_completo; do
    echo "SAVEPOINT s_$s;"
    echo "\\echo [suite $s]"
    strip "$HERE/$s.sql"
    echo "RESET ROLE;"
    echo "ROLLBACK TO SAVEPOINT s_$s;"
  done
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  echo "SELECT 'rollback: coluna=' || count(*) FROM information_schema.columns WHERE table_name = 'profile_birthdates' AND column_name = 'comemora_aniversario';"
  echo "SELECT 'rollback: datas preservadas=' || (to_regclass('public.profile_birthdates') IS NOT NULL);"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
