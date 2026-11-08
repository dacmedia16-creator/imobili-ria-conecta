#!/usr/bin/env bash
# Link de acompanhamento (migration 20261108200000, t_54c79bdc) numa ÚNICA transação revertida (homologação ou
# clone, nunca produção): fingerprint A -> up -> suíte -> rollback -> fingerprint == A -> ROLLBACK.
# Nada fica gravado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-link-acompanhamento.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
V=20261108200000
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||coalesce(p.proconfig::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'vault:'||name FROM vault.secrets
  UNION ALL SELECT 'mod:'||organization_id||':'||module||':'||enabled FROM public.organization_modules
  UNION ALL SELECT 'org:'||id||':'||md5(row(o.*)::text) FROM public.organizations o) s),''));"
{
  echo "BEGIN;"
  echo "$FP"
  strip "$ROOT/supabase/migrations/${V}_link_acompanhamento.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/link_acompanhamento.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/${V}_link_acompanhamento.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
