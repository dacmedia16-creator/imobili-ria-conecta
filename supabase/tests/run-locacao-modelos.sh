#!/usr/bin/env bash
# Modelos de contrato por garantia + apólice que trava a entrega das chaves (migration 20261201120000, t_d08cfeee)
# numa ÚNICA transação revertida (homologação ou clone, NUNCA produção). Aplica as migrations de base da Locação que
# faltarem, tira a impressão digital, aplica a migration, roda a suíte, desfaz a migration e confere que o esquema
# voltou EXATAMENTE ao estado anterior. Por fim ROLLBACK: nada fica gravado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-modelos.sh
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
  UNION ALL SELECT 'col:'||table_name||'.'||column_name||':'||coalesce(column_default,'') FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'bkt:'||id||':'||public::text||':'||coalesce(allowed_mime_types::text,'') FROM storage.buckets
  UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
  UNION ALL SELECT 'cfg:'||organization_id||':'||md5(row(c.*)::text) FROM public.locacao_config c) s),''));"
# Base da Locação (homologação pode estar atrás da produção): aplica na transação só o que faltar.
BASES=(
  "public.locacao_pre_links|20261124120000_locacao_cliente_preenche 20261124130000_locacao_pre_aprovacao"
  "public.locacao_config_sf_backup|20261129120000_locacao_seguro_fianca_sem_docs"
  "public.locacao_minutas|20261130120000_locacao_minuta_anexada"
)
{
  echo "BEGIN;"
  for b in "${BASES[@]}"; do
    rel="${b%%|*}"; migs="${b#*|}"
    tem=$(psql "$PGCONN" -X -At -c "SELECT to_regclass('$rel') IS NOT NULL")
    if [ "$tem" != "t" ]; then for m in $migs; do strip "$ROOT/supabase/migrations/$m.sql"; echo "\\echo [base $m]"; done; fi
  done
  echo "$FP"
  strip "$ROOT/supabase/migrations/20261201120000_locacao_modelos_contrato.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-minuta-seed.sql"
  strip "$HERE/locacao-modelos.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/20261201120000_locacao_modelos_contrato.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(base|migration|rollback)|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
