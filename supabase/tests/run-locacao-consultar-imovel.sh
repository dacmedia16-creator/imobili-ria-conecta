#!/usr/bin/env bash
# "Consultar imóvel" da Locação (migration 20261211130000, t_241e03a9) numa ÚNICA transação revertida (homologação ou
# clone, NUNCA produção): impressão digital A -> migration -> suíte -> rollback -> impressão digital == A -> ROLLBACK.
# Nada fica gravado. Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-consultar-imovel.sh
# Controle negativo: MIG=<outro arquivo> roda a suíte contra outra versão da função.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
MIG="${MIG:-$ROOT/supabase/migrations/20261211130000_locacao_consultar_imovel.sql}"
RB="$ROOT/supabase/rollback/20261211130000_locacao_consultar_imovel.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a),'')||':'||coalesce(p.proconfig::text,'')||':'||md5(pg_get_functiondef(p.oid)) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(c.relacl) a),'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
  UNION ALL SELECT 'mod:'||organization_id||':'||module||':'||enabled FROM public.organization_modules) s),''));"
{
  echo "BEGIN;"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-consultar-imovel.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(migration|rollback)|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:|WARNING" | tee /dev/stderr \
  | { OUT="$(cat)"; FPS="$(grep '^FP=' <<<"$OUT" | sort -u | wc -l)"
      if grep -qE '^FALHA|ERROR|psql:' <<<"$OUT" || ! grep -q 'falhas=0' <<<"$OUT" || [ "$FPS" != 1 ]; then
        echo "RESULTADO: FALHOU"; exit 1; fi; echo "RESULTADO: OK"; }
