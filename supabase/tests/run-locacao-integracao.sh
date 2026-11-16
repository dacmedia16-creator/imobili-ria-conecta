#!/usr/bin/env bash
# Integração das migrations 20261201120000 (modelos de contrato, PR #329) + 20261201150000 (reunião 16/11, PR #330)
# numa ÚNICA transação revertida (homologação ou clone, NUNCA produção). Aplica as bases que faltarem, tira a
# impressão digital, aplica as DUAS migrations em ordem, roda as DUAS suítes com tudo aplicado, desfaz na ordem
# inversa (150000 e depois 120000) e confere que o esquema voltou EXATAMENTE ao estado anterior. Por fim ROLLBACK.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-integracao.sh   (t_6feb2df6)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a),'')||':'||coalesce(p.proconfig::text,'')||':'||md5(pg_get_functiondef(p.oid)) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(c.relacl) a),'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name||':'||coalesce(column_default,'') FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'trg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'pg_%'
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'bkt:'||id||':'||public::text||':'||coalesce(allowed_mime_types::text,'') FROM storage.buckets
  UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
  UNION ALL SELECT 'cfg:'||organization_id||':'||md5(row(c.*)::text) FROM public.locacao_config c) s),''));"
BASES=(
  "fn:public.so_locacao_ativo(uuid)|20261122120100_papel_locacao"
  "public.locacao_pre_links|20261124120000_locacao_cliente_preenche 20261124130000_locacao_pre_aprovacao"
  "public.locacao_config_sf_backup|20261129120000_locacao_seguro_fianca_sem_docs"
  "public.locacao_minutas|20261130120000_locacao_minuta_anexada"
)
{
  echo "BEGIN;"
  for b in "${BASES[@]}"; do
    rel="${b%%|*}"; migs="${b#*|}"
    case "$rel" in fn:*) q="SELECT to_regprocedure('${rel#fn:}') IS NOT NULL";; *) q="SELECT to_regclass('$rel') IS NOT NULL";; esac
    tem=$(psql "$PGCONN" -X -At -c "$q")
    if [ "$tem" != "t" ]; then for m in $migs; do strip "$ROOT/supabase/migrations/$m.sql"; echo "\\echo [base $m]"; done; fi
  done
  echo "$FP"
  strip "$ROOT/supabase/migrations/20261201120000_locacao_modelos_contrato.sql"
  echo "\\echo [migration 20261201120000 ok]"
  strip "$ROOT/supabase/migrations/20261201150000_locacao_reuniao_16_11.sql"
  echo "\\echo [migration 20261201150000 ok]"
  echo "SAVEPOINT suite;"
  echo "\\echo [suite modelos]"
  strip "$HERE/locacao-minuta-seed.sql"
  strip "$HERE/locacao-modelos.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  echo "\\echo [suite reuniao]"
  strip "$HERE/locacao-reuniao.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/20261201150000_locacao_reuniao_16_11.sql"
  echo "\\echo [rollback 20261201150000 ok]"
  strip "$ROOT/supabase/rollback/20261201120000_locacao_modelos_contrato.sql"
  echo "\\echo [rollback 20261201120000 ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(base|migration|rollback|suite)|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:|WARNING"
