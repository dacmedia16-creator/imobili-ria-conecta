#!/usr/bin/env bash
# Acesso do MAX ao "Ajuda e sugestões" (migration 20261009030000) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção). Aplica antes, só na transação, a 20261008220000 se faltar.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-ajuda-acesso-max.sh [--rollback]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
M="$ROOT/supabase/migrations"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  echo "SELECT to_regclass('public.support_tickets') IS NULL AS falta_ajuda \\gset"
  echo "\\if :falta_ajuda"
  strip "$M/20261008220000_ajuda_sugestoes.sql"
  echo "\\endif"
  strip "$M/20261009030000_ajuda_acesso_max.sql"
  echo "\\echo [migration ok]"
  if [ "${1:-}" = "--rollback" ]; then
    strip "$ROOT/supabase/rollback/20261009030000_ajuda_acesso_max.sql"
    echo "\\echo [rollback ok]"
    echo "SELECT 'ok rollback: papel, schema e funções do MAX removidos' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='max_suporte_bot')"
    echo "  AND to_regnamespace('max_suporte') IS NULL;"
    echo "SELECT 'ok rollback: EXECUTE de PUBLIC devolvido às 9 funções antigas' WHERE (SELECT count(*) FROM pg_proc p"
    echo "  JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.prosecdef"
    echo "  AND p.proname IN ('archive_sale_document','change_sale_status','cliente_historico','criar_ocorrencia_lancamento',"
    echo "   'insert_sale_document','list_active_corretores','list_active_gestores','list_active_team_leaders','list_active_users')"
    echo "  AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)) = 9;"
    echo "SELECT 'ok rollback: canal Ajuda intacto' WHERE to_regclass('public.support_tickets') IS NOT NULL"
    echo "  AND has_function_privilege('authenticated', 'public.support_ticket_reply(uuid,text,boolean)', 'EXECUTE');"
  else
    strip "$HERE/ajuda_acesso_max.sql"
  fi
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|INFO)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
