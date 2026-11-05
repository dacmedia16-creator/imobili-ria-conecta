#!/usr/bin/env bash
# Módulo "Agendar fotos + Vouchers de Fotos" (migration 20261105120000, t_d86ab990) numa ÚNICA transação
# revertida: esquema atual -> hash antes -> migration -> suíte -> rollback -> confere hash igual -> reaplica.
# Nada fica gravado. Concorrência: supabase/tests/run-vouchers-fotos-concorrencia.sh (banco descartável).
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d <banco_local>" bash supabase/tests/run-vouchers-fotos.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261105120000_vouchers_fotos.sql"
RB="$ROOT/docs/sql/rollback/20261105120000_vouchers_fotos.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || md5(p.prosrc) || '/' || coalesce(array_to_string(p.proacl, ','), ''), ' ' ORDER BY p.oid::regprocedure::text), '')) || ' funcoes_photo=' || (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'photo%' OR proname = 'vouchers_fotos_enabled')) || ' tabelas_photo=' || (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'photo%' AND relkind = 'r') || ' check=' || md5((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'organization_modules_module_check')) || ' gatilhos_captacao=' || (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.exclusive_captures'::regclass AND NOT tgisinternal) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('platform_set_organization_module');"
{
  echo "BEGIN;"
  echo "\\echo [antes]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT s1;"
  echo "\\echo [suite vouchers_fotos]"
  strip "$HERE/vouchers_fotos.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
