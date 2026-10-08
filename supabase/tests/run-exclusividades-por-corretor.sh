#!/usr/bin/env bash
# Aba "Por corretor": teste por perfil numa ÚNICA transação revertida (homologação ou clone, nunca
# produção). Aplica antes, só na transação, as migrations de captação/Painel da Equipe que faltarem.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-exclusividades-por-corretor.sh
#  ou: bash supabase/tests/run-exclusividades-por-corretor.sh --print > /tmp/x.sql  (só gera o SQL)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
gen() {
  echo "BEGIN;"
  echo "ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS archived_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS archived_by uuid, ADD COLUMN IF NOT EXISTS discarded_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS discarded_by uuid, ADD COLUMN IF NOT EXISTS signed_on date,"
  echo "  ADD COLUMN IF NOT EXISTS geo_lat double precision, ADD COLUMN IF NOT EXISTS geo_lon double precision,"
  echo "  ADD COLUMN IF NOT EXISTS geo_key text;"
  echo "SELECT NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'exclusive_manager_pending_read') AS need_gestor \\gset"
  echo "\\if :need_gestor"
  strip "$ROOT/supabase/migrations/20261006210000_exclusividade_contrato_pelo_gestor.sql"
  echo "\\endif"
  echo "SELECT to_regprocedure('public.painel_equipe_equipes()') IS NULL AS need_painel \\gset"
  echo "\\if :need_painel"
  strip "$ROOT/supabase/migrations/20261008180000_painel_equipe.sql"
  echo "\\endif"
  echo "\\echo [pre ok]"
  strip "$HERE/exclusividades_por_corretor.sql"
  echo "ROLLBACK;"
}
if [ "${1:-}" = "--print" ]; then gen; exit 0; fi
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
gen | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
