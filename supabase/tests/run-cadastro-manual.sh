#!/usr/bin/env bash
# Ensaio da migration 20261008160000 (cadastro manual de exclusividade já assinada) numa ÚNICA transação
# revertida (homologação ou clone, nunca produção): pré-requisitos -> up -> checagens -> rollback ->
# checagens -> ROLLBACK. Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-cadastro-manual.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
UP="$ROOT/supabase/migrations/20261008160000_exclusividade_cadastro_manual.sql"
DOWN="$ROOT/supabase/rollback/20261008160000_exclusividade_cadastro_manual.sql"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
{
  echo "BEGIN;"
  # Colunas de 02-03/10 já em produção e ausentes na homologação: só dentro da transação.
  echo "ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS archived_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS archived_by uuid, ADD COLUMN IF NOT EXISTS discarded_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS discarded_by uuid, ADD COLUMN IF NOT EXISTS signed_on date,"
  echo "  ADD COLUMN IF NOT EXISTS geo_lat double precision, ADD COLUMN IF NOT EXISTS geo_lon double precision,"
  echo "  ADD COLUMN IF NOT EXISTS geo_key text;"
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$UP"
  echo "\\echo [up ok]"
  echo "SELECT 'ok coluna manual: ' || count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='exclusive_captures' AND column_name='manual';"
  echo "SELECT 'ok dono ' || proowner::regrole::text || ', anon executa=' || has_function_privilege('anon', p.oid, 'EXECUTE') FROM pg_proc p WHERE proname='exclusive_create_manual';"
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$DOWN"
  echo "\\echo [rollback ok]"
  echo "SELECT 'ok apos rollback: coluna=' || count(*) || ' rpc=' || coalesce(to_regprocedure('public.exclusive_create_manual(uuid)')::text, 'removida') FROM information_schema.columns WHERE table_schema='public' AND table_name='exclusive_captures' AND column_name='manual';"
  echo "ROLLBACK;"
} > "$TMP"
psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 -f "$TMP" 2>&1 | grep -E '^\[|^ok|ERROR|LINE' || true
