#!/usr/bin/env bash
# Mapa: só escritórios da própria imobiliária (migration 20261013230000, t_d017e87f) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção): pré-requisitos que faltarem no alvo (só na transação) ->
# fingerprint A -> up -> suíte -> rollback -> fingerprint == A -> ROLLBACK.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-mapa-site-so-escritorios.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
M="$ROOT/supabase/migrations"
V=20261013230000
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
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
  # A homologação pode registrar a versão sem ter o objeto: decide pela existência real.
  pre() { # $1 = versão, $2 = condição SQL de "falta"
    echo "SELECT ($2) AS falta \\gset"
    echo "\\if :falta"
    echo "\\echo [pre $1]"
    strip "$M/$1_"*.sql
    echo "\\endif"
  }
  pre 20261006100000 "NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='remax_id')"
  pre 20261006120000 "to_regclass('public.portal_listing_snapshots') IS NULL"
  pre 20261006150000 "to_regprocedure('public.portal_relink_broker()') IS NULL"
  pre 20261006170000 "to_regprocedure('public.owner_feedback_enabled()') IS NULL"
  # owner_feedback_actions foi arquivada fora de supabase/migrations, mas é pré-requisito do #56
  echo "SELECT to_regclass('public.owner_feedback_actions') IS NULL AS falta_ofa \\gset"
  echo "\\if :falta_ofa"
  echo "\\echo [pre 20261006190000 (arquivo)]"
  strip "$ROOT/supabase/migrations_arquivo/20261006190000_owner_feedback_actions.sql"
  echo "\\endif"
  echo "SELECT to_regclass('public.exclusive_listing_links') IS NULL AS falta_56 \\gset"
  echo "\\if :falta_56"
  echo "\\echo [pre 20261009010000]"
  strip "$M/20261009010000_feedback_captacao_plano.sql"
  echo "\\endif"
  echo "SELECT to_regclass('public.remax_site_listings') IS NULL AS falta_site \\gset"
  echo "\\if :falta_site"
  echo "\\echo [pre 20261009040000]"
  strip "$M/20261009040000_remax_site_sugestao_anuncio.sql"
  echo "\\endif"
  pre 20261013200000 "to_regprocedure('public.mapa_anuncios_site()') IS NULL"
  pre 20261013210000 "NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' AND column_name='mapa_site_enabled')"
  # Cenário de produção ANTES da correção: 4 escritórios na Única (inclui 63164 = Volute) e anúncios de todos
  echo "\\i $HERE/mapa_site_so_escritorios_setup.sql"
  echo "\\echo [pre ok]"
  echo "$FP"
  strip "$M/${V}_mapa_site_so_escritorios_org.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/mapa_site_so_escritorios.sql"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/${V}_mapa_site_so_escritorios_org.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=|INFO)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
