#!/usr/bin/env bash
# Papel geral "Locação" (migrations 20261122120000 + 20261122120100, card t_1fe07126).
# A parte A (ALTER TYPE ADD VALUE) precisa estar COMMITADA antes de usar o valor: roda sozinha (idempotente,
# IF NOT EXISTS; o valor sobra inerte). A parte B roda numa ÚNICA transação revertida:
# hash antes -> migration B -> suíte -> rollback B -> confere hash igual -> reaplica B -> ROLLBACK.
# Nada da parte B nem dos dados de teste fica gravado.
# Uso: PSQL="psql <conninfo da homologação> -X" bash supabase/tests/run-papel-locacao.sh   (nunca produção)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
MIGA="$ROOT/supabase/migrations/20261122120000_app_role_locacao.sql"
MIG="$ROOT/supabase/migrations/20261122120100_papel_locacao.sql"
RB="$ROOT/docs/sql/rollback/20261122120100_papel_locacao.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || md5(p.prosrc) || '/' || coalesce(array_to_string(p.proacl, ','), ''), ' ' ORDER BY p.oid::regprocedure::text), '')) || ' politicas_locacao=' || (SELECT count(*) FROM pg_policies WHERE policyname = 'zz_locacao_fora') || ' politicas_total=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') || ' fn_novas=' || (SELECT count(*) FROM pg_proc WHERE proname IN ('eh_so_locacao', 'so_locacao_ativo')) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('is_active_user', 'locacao_ctx', 'locacao_criar', 'list_room_occupancy', 'support_ticket_create', 'push_inscrever', 'exclusive_capture_enabled', 'leads_enabled', 'opportunities_enabled', 'owner_feedback_enabled', 'academia_enabled', 'proposta_compra_enabled', 'vouchers_fotos_enabled', 'sistemas_ligados', 'meu_realizado', 'photo_meu_resumo', 'photo_agendar', 'academia_has_active_adm_access') OR (p.pronamespace = 'academia'::regnamespace AND p.proname = 'user_org');"
echo "[parte A]"
$PSQL -q -At -v ON_ERROR_STOP=1 -f "$MIGA" 2>&1 | grep -E "ERROR|psql:" || echo "[parte A ok]"
{
  echo "BEGIN;"
  echo "\\echo [antes]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration B ok]"
  echo "SAVEPOINT s1;"
  echo "\\echo [suite papel_locacao]"
  strip "$HERE/papel_locacao.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
