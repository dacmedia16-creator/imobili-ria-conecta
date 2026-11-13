#!/usr/bin/env bash
# Pré-aprovação da Locação (migration 20261124130000, t_b2ce1207) numa ÚNICA transação revertida (homologação ou clone,
# NUNCA produção): fingerprint A -> 20261124120000 (base, PR #316) -> fingerprint B -> 20261124130000 -> suíte
# -> rollback 20261124130000 -> fingerprint == B -> ROLLBACK. Nada fica gravado.
# Se a base (#316) já estiver aplicada no banco, use BASE_APLICADA=1.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-pre-aprovacao.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||coalesce(p.proconfig::text,'')||':'||md5(pg_get_functiondef(p.oid)) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
  UNION ALL SELECT 'ct:'||id||':'||md5(row(c.*)::text) FROM public.locacao_contratos c) s),''));"
{
  echo "BEGIN;"
  echo "$FP"
  if [ "${BASE_APLICADA:-0}" != "1" ]; then
    strip "$ROOT/supabase/migrations/20261124120000_locacao_cliente_preenche.sql"
    echo "\\echo [base ok]"
  fi
  echo "$FP"
  strip "$ROOT/supabase/migrations/20261124130000_locacao_pre_aprovacao.sql"
  echo "\\echo [migration ok]"
  if [ "${SO_ESTRUTURA:-0}" != "1" ]; then
    echo "SAVEPOINT suite;"
    strip "$HERE/locacao-pre-aprovacao.sql"
    echo "RESET ROLE;"
    echo "ROLLBACK TO SAVEPOINT suite;"
  fi
  strip "$ROOT/supabase/rollback/20261124130000_locacao_pre_aprovacao.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(base|migration|rollback) ok\]|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
