#!/usr/bin/env bash
# Boletos de condomínio e gás só quando aplicável (migration 20261211120000, t_a0736d87) numa ÚNICA transação revertida
# (homologação ou clone, NUNCA produção). Aplica as bases da Locação que faltarem, tira a impressão digital, aplica a
# migration, roda a suíte, desfaz a migration e confere que o esquema voltou EXATAMENTE ao anterior. Por fim ROLLBACK.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-boletos.sh
#      (ou PSQL="bash hq.sh -" para um psql já conectado). MIG=<arquivo> troca a migration (controle negativo).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG="${MIG:-$ROOT/supabase/migrations/20261211120000_locacao_boletos_condominio_gas.sql}"
if [ -z "${PSQL:-}" ]; then
  PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção) ou PSQL}"
  case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
  PSQL="psql $PGCONN -X -q -At -v ON_ERROR_STOP=1"
fi
case "$PSQL" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
q() { echo "$1" | $PSQL; }
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a),'')||':'||coalesce(p.proconfig::text,'')||':'||md5(pg_get_functiondef(p.oid)) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
  UNION ALL SELECT 'doc:'||id||':'||md5(row(d.*)::text) FROM public.locacao_documentos d) s),''));"
BASES=(
  "fn:public.so_locacao_ativo(uuid)|20261122120100_papel_locacao"
  "public.locacao_pre_links|20261124120000_locacao_cliente_preenche 20261124130000_locacao_pre_aprovacao"
  "public.locacao_config_sf_backup|20261129120000_locacao_seguro_fianca_sem_docs"
  "public.locacao_minutas|20261130120000_locacao_minuta_anexada"
  "public.locacao_lancamentos|20261201150000_locacao_reuniao_16_11"
)
{
  echo "BEGIN;"
  for b in "${BASES[@]}"; do
    rel="${b%%|*}"; migs="${b#*|}"
    case "$rel" in fn:*) sql="SELECT to_regprocedure('${rel#fn:}') IS NOT NULL";; *) sql="SELECT to_regclass('$rel') IS NOT NULL";; esac
    tem=$(q "$sql")
    if [ "$tem" != "t" ]; then for m in $migs; do strip "$ROOT/supabase/migrations/$m.sql"; echo "\\echo [base $m]"; done; fi
  done
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-boletos.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/20261211120000_locacao_boletos_condominio_gas.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | $PSQL -b 2>&1 | grep -E "^\[(base|migration|rollback)|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:|WARNING"
