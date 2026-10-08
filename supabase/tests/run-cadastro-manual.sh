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
  # Mapa do PR #41 (20261008150000, já em produção): aplicado só na transação se faltar.
  echo "SELECT to_regprocedure('public.mapa_captacoes()') IS NULL AS need_mapa \\gset"
  echo "\\if :need_mapa"
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$ROOT/supabase/migrations/20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql"
  echo "\\endif"
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$UP"
  echo "\\echo [up ok]"
  echo "SELECT 'ok coluna manual: ' || count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='exclusive_captures' AND column_name='manual';"
  echo "SELECT 'ok dono ' || proowner::regrole::text || ', anon executa=' || has_function_privilege('anon', p.oid, 'EXECUTE') FROM pg_proc p WHERE proname='exclusive_create_manual';"
  # Suíte funcional (perfis, isolamento A×B, mapa, regressão da captação normal) em savepoint.
  echo "SAVEPOINT suite;"
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$HERE/cadastro_manual.sql"
  echo "ROLLBACK TO SAVEPOINT suite;"
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$DOWN"
  echo "\\echo [rollback ok]"
  echo "SELECT 'ok apos rollback: coluna=' || count(*) || ' rpc=' || coalesce(to_regprocedure('public.exclusive_create_manual(uuid)')::text, 'removida') FROM information_schema.columns WHERE table_schema='public' AND table_name='exclusive_captures' AND column_name='manual';"
  echo "ROLLBACK;"
} > "$TMP"
psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 -f "$TMP" 2>&1 | sed "s#^psql:[^ ]* ##" | grep -E "^\[|^(ok|FALHA|TOTAL=)|ERROR|[Ee]rror:|LINE|DETAIL" || true
