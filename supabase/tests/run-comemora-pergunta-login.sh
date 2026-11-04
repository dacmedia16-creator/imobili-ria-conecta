#!/usr/bin/env bash
# Pergunta "Comemora aniversário?" no login (migration 20261104170000, t_05a37081) numa ÚNICA transação
# revertida: cadeia atual (nascimento + ficha + 150000) -> dados antigos -> esta -> suíte nova + suítes
# da 150000 e da ficha -> rollback -> confere hashes iguais aos de antes -> reaplica. Nada fica gravado.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-comemora-pergunta-login.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIGS=(20261022120000_data_nascimento_cadastro 20261029130000_ficha_colaborador
      20261029160000_cadastro_completo_ficha 20261030100000_ficha_filhos_faixas 20261103180000_ficha_listar_avatar
      20261104150000_comemora_aniversario)
MIG="$ROOT/supabase/migrations/20261104170000_comemora_aniversario_pergunta_login.sql"
RB="$ROOT/docs/sql/rollback/20261104170000_comemora_aniversario_pergunta_login.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || coalesce(string_agg(p.oid::regprocedure::text || '=' || md5(p.prosrc) || '/' || coalesce(array_to_string(p.proacl, ','), ''), ' ' ORDER BY p.oid::regprocedure::text), '') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('profile_set_birthdate','ficha_salvar_minha','comemora_pergunta_pendente','comemora_responder');"
COLS="SELECT 'colunas: ' || string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_birthdates';"
DADOS="SELECT 'dados: ' || md5(string_agg(user_id::text || ':' || data_nascimento || ':' || comemora_aniversario, ',' ORDER BY user_id)) FROM public.profile_birthdates;"
{
  echo "BEGIN;"
  for m in "${MIGS[@]}"; do strip "$ROOT/supabase/migrations/$m.sql"; done
  strip "$HERE/comemora_pergunta_login_seed.sql"
  echo "\\echo [antes]"
  echo "$HASH"; echo "$COLS"; echo "$DADOS"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "$DADOS"
  echo "SAVEPOINT s1;"
  echo "\\echo [suite comemora_pergunta_login]"
  strip "$HERE/comemora_pergunta_login.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  for s in comemora_aniversario ficha_filhos_faixas ficha_colaborador cadastro_completo; do
    echo "SAVEPOINT s_$s;"
    echo "\\echo [suite $s]"
    strip "$HERE/$s.sql"
    echo "RESET ROLE;"
    echo "ROLLBACK TO SAVEPOINT s_$s;"
  done
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"; echo "$COLS"; echo "$DADOS"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash|colunas|dados)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
