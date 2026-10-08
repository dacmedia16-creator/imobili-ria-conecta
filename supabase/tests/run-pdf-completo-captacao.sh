#!/usr/bin/env bash
# Permissões dos PDFs da captação normal (sem migration nova) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção). Aplica antes, só na transação, as migrations do contrato pelo
# gestor (já em produção), do mapa (PR #41) e do cadastro manual (PR #44) se faltarem. Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-pdf-completo-captacao.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
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
  echo "SELECT to_regprocedure('public.mapa_captacoes()') IS NULL AS need_mapa \\gset"
  echo "\\if :need_mapa"
  strip "$ROOT/supabase/migrations/20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql"
  echo "\\endif"
  echo "SELECT to_regprocedure('public.exclusive_create_manual(uuid)') IS NULL AS need_manual \\gset"
  echo "\\if :need_manual"
  strip "$ROOT/supabase/migrations/20261008160000_exclusividade_cadastro_manual.sql"
  echo "\\endif"
  echo "\\echo [pre ok]"
  strip "$HERE/pdf_completo_captacao.sql"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
