#!/usr/bin/env bash
# Papel "Fotógrafo" (migrations 20261105130000 + 20261105130100, card t_0666d3f0, PR #269).
# A parte A (ALTER TYPE ADD VALUE) precisa estar COMMITADA antes de usar o valor: roda sozinha (idempotente,
# IF NOT EXISTS) no banco local descartável. A parte B roda numa ÚNICA transação revertida:
# hash antes -> migration B -> suíte -> rollback B -> confere hash igual -> reaplica B. Nada da parte B fica gravado.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d <banco_local>" bash supabase/tests/run-papel-fotografo.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIGA="$ROOT/supabase/migrations/20261105130000_app_role_fotografo.sql"
MIG="$ROOT/supabase/migrations/20261105130100_papel_fotografo.sql"
RB="$ROOT/docs/sql/rollback/20261105130100_papel_fotografo.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || md5(p.prosrc) || '/' || coalesce(array_to_string(p.proacl, ','), ''), ' ' ORDER BY p.oid::regprocedure::text), '')) || ' politicas_fotografo=' || (SELECT count(*) FROM pg_policies WHERE policyname = 'zz_fotografo_fora') || ' politicas_total=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('is_active_user', 'photo_eh_fotografo', 'photo_staff_listar', 'photo_configurar', 'achievements_enabled', 'exclusive_capture_enabled', 'leads_enabled', 'opportunities_enabled', 'owner_feedback_enabled', 'room_reservation_enabled', 'academia_enabled', 'crm_enabled', 'list_room_reservation_users', 'eh_so_fotografo');"
echo "[parte A]"
$PSQL -X -q -At -v ON_ERROR_STOP=1 < "$MIGA" 2>&1 | grep -E "ERROR|psql:" || echo "[parte A ok]"
{
  echo "BEGIN;"
  echo "\\echo [antes]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration B ok]"
  echo "SAVEPOINT s1;"
  echo "\\echo [suite papel_fotografo]"
  strip "$HERE/papel_fotografo.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
