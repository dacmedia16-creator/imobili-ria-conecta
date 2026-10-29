#!/bin/bash
# Testes de "especialistas por imobiliária" (t_6d8de1d7) num Postgres LOCAL descartável. Nada remoto.
# Uso: bash scripts/especialistas-test/test.sh <container> <banco_clone_estrutural>
# 1) cria <banco>_t a partir do clone; 2) semeia o cenário "antes"; 3) aplica a migration;
# 4) roda os testes (terminam em ROLLBACK); 5) aplica o rollback e confere a volta; 6) apaga <banco>_t.
set -euo pipefail
C=${1:?container}
BASE=${2:?banco}
DB="${BASE}_t"
D="$(cd "$(dirname "$0")" && pwd)"
R="$D/../.."
psql_() { docker exec "$C" psql -U "$1" -d "$DB" -X -q -v ON_ERROR_STOP=1 "${@:2}"; }
docker exec "$C" dropdb -U supabase_admin --if-exists "$DB"
docker exec "$C" createdb -U supabase_admin -T "$BASE" "$DB"
# Em produção o postgres é membro de mt_1b_definer e cria no schema public; o clone replica isso.
docker exec "$C" psql -U supabase_admin -d "$DB" -X -q -c "GRANT CREATE ON SCHEMA public TO postgres WITH GRANT OPTION" -c "GRANT mt_1b_definer TO postgres"
for f in "$D/seed_pre.sql" "$D/test_especialistas.sql" "$R/supabase/migrations/20261029150000_especialistas_por_imobiliaria.sql" \
         "$R/docs/sql/rollback/20261029150000_especialistas_por_imobiliaria.rollback.sql" "$D/check_rollback.sql"; do
  docker cp "$f" "$C:/tmp/$(basename "$f")" >/dev/null
done
psql_ supabase_admin -f /tmp/seed_pre.sql
psql_ postgres -f /tmp/20261029150000_especialistas_por_imobiliaria.sql
echo "== migration aplicada"
psql_ supabase_admin -t -A -F ' | ' -f /tmp/test_especialistas.sql
psql_ postgres -f /tmp/20261029150000_especialistas_por_imobiliaria.rollback.sql
echo "== rollback aplicado"
psql_ supabase_admin -t -A -F ' | ' -f /tmp/check_rollback.sql
docker exec "$C" dropdb -U supabase_admin "$DB"
