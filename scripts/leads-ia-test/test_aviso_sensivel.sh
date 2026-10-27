#!/bin/bash
# Aviso de assunto sensível para o Administrador principal (t_a7be646a): antes (migration atual),
# depois (20261027100000), rollback e reaplicação, em banco descartável (só 127.0.0.1). Nada remoto.
# Uso: bash scripts/leads-ia-test/test_aviso_sensivel.sh ta7be
set -e
DB=${1:-ta7be}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
MIG=$W/supabase/migrations/20261027100000_aviso_sensivel_admin_principal.sql
RB=$W/docs/sql/rollback/20261027100000_aviso_sensivel_admin_principal.rollback.sql
roda() { ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1; for f in "$@"; do $P < "$f" >/dev/null; done
         $P < "$(dirname "$0")/test_aviso_sensivel.sql" 2>&1 | grep -E "RESULTADO|FAIL|PASS S1 |PASS S6 " ; }
echo "== ANTES (sem a migration nova): S1 deve falhar"; roda || true
echo "== DEPOIS (com 20261027100000)"; roda "$MIG"
echo "== ROLLBACK (aplica e desfaz): S1 volta a falhar"; roda "$MIG" "$RB" || true
echo "== REAPLICADA"; roda "$MIG" "$RB" "$MIG"
