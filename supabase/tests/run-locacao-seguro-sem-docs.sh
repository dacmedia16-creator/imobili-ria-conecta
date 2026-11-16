#!/usr/bin/env bash
# Seguro-fiança sem documentos no checklist (migration 20261129120000, t_d3e1c29f) numa ÚNICA transação revertida
# (homologação ou clone, NUNCA produção): aplica 20261124120000/20261124130000 se faltarem -> seed fictício ->
# fingerprint B -> migration -> suíte -> rollback -> fingerprint == B -> ROLLBACK. Nada fica gravado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-seguro-sem-docs.sh
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
  UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
  UNION ALL SELECT 'cfg:'||organization_id||':'||md5(documentos::text) FROM public.locacao_config
  UNION ALL SELECT 'doc:'||id||':'||md5(row(d.*)::text) FROM public.locacao_documentos d) s),''));"
TEM=$(psql "$PGCONN" -X -At -c "SELECT to_regclass('public.locacao_pre_links') IS NOT NULL")
{
  echo "BEGIN;"
  if [ "$TEM" != "t" ]; then
    strip "$ROOT/supabase/migrations/20261124120000_locacao_cliente_preenche.sql"
    strip "$ROOT/supabase/migrations/20261124130000_locacao_pre_aprovacao.sql"
    echo "\\echo [base ok]"
  fi
  strip "$HERE/locacao-seguro-sem-docs-seed.sql"
  echo "$FP"
  strip "$ROOT/supabase/migrations/20261129120000_locacao_seguro_fianca_sem_docs.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-seguro-sem-docs.sql"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/20261129120000_locacao_seguro_fianca_sem_docs.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(base|migration|rollback) ok\]|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
