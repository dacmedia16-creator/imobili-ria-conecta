#!/usr/bin/env bash
# Sugestão do anúncio do site RE/MAX (migration 20261009040000) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção): pré-requisitos que faltarem no alvo (só na transação) ->
# fingerprint A -> up -> suíte -> rollback -> fingerprint == A -> ROLLBACK.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-remax-site-sugestao.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
M="$ROOT/supabase/migrations"
V=20261009040000
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
LAST="$(psql "$PGCONN" -X -At -c "select max(version) from supabase_migrations.schema_migrations")"
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relkind::text||':'||coalesce(c.relacl::text,'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal) s),''));"
{
  echo "BEGIN;"
  echo "ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS archived_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS archived_by uuid, ADD COLUMN IF NOT EXISTS discarded_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS discarded_by uuid, ADD COLUMN IF NOT EXISTS signed_on date,"
  echo "  ADD COLUMN IF NOT EXISTS geo_lat double precision, ADD COLUMN IF NOT EXISTS geo_lon double precision;"
  for v in 20261006100000 20261006120000 20261006150000 20261006170000 20261006190000; do
    if [[ "$v" > "$LAST" ]]; then echo "\\echo [pre $v]"; strip "$M/${v}_"*.sql; fi
  done
  echo "SELECT to_regclass('public.exclusive_listing_links') IS NULL AS falta_56 \\gset"
  echo "\\if :falta_56"
  echo "\\echo [pre 20261009010000]"
  strip "$M/20261009010000_feedback_captacao_plano.sql"
  echo "\\endif"
  echo "\\echo [pre ok]"
  echo "$FP"
  strip "$M/${V}_remax_site_sugestao_anuncio.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/remax_site_sugestao.sql"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/${V}_remax_site_sugestao_anuncio.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=|INFO)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
