#!/usr/bin/env bash
# Ensaio da migration 20261005090000 (mapa de Vendas por região) numa ÚNICA transação revertida:
# pré-requisitos ausentes -> estado A -> up -> suíte -> rollback -> estado == A -> up -> suíte -> ROLLBACK.
# Uso: PSQL="psql <conexão da homologação ou clone>" bash supabase/tests/run-vendas-regiao-mapa.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
M="$ROOT/supabase/migrations"
UP="$M/20261005090000_vendas_regiao_mapa.sql"
DOWN="$ROOT/supabase/rollback/20261005090000_vendas_regiao_mapa.sql"
SUITE="$HERE/vendas_regiao_mapa.sql"
STATE="SELECT 'STATE=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'rel:'||c.relname||':'||coalesce(c.relacl::text,'') x FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'fn:'||p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||polrelid::regclass::text||':'||polname FROM pg_policy) s),''));"
suite() { echo "SAVEPOINT s;"; strip "$SUITE"; echo "ROLLBACK TO SAVEPOINT s;"; }
# Pré-requisitos (já em produção): só aplica se faltarem no alvo.
pre() {
  echo "SELECT (count(*)=0) AS need_end FROM information_schema.columns WHERE table_schema='public' AND table_name='sales' AND column_name='imovel_bairro' \\gset"
  echo "\\if :need_end"
  strip "$M/20261004180000_sales_endereco_estruturado.sql"
  strip "$M/20261004190000_trava_endereco_antes_gestor.sql"
  echo "\\echo [pre 20261004180000/190000 aplicadas na transacao]"; echo "\\endif"
  echo "SELECT (count(*)=0) AS need_vpr FROM pg_proc WHERE proname='vendas_por_regiao' \\gset"
  echo "\\if :need_vpr"; strip "$M/20261004200000_vendas_por_endereco.sql"; echo "\\echo [pre 20261004200000 aplicada na transacao]"; echo "\\endif"
  # vendas fictícias efetivadas nas agências A e B (idempotente; revertida junto com o resto)
  strip "$HERE/fixture_vendas_regiao_mapa.sql"
}
{
  echo "BEGIN;"
  pre
  echo "$STATE"
  strip "$UP"; echo "\\echo [up 1]"; suite
  strip "$DOWN"; echo "$STATE"
  strip "$UP"; echo "\\echo [up 2]"; suite
  echo "ROLLBACK;"
} | $PSQL -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E '^\[|^(ok|FALHA|TOTAL=|STATE=)|ERROR' || true
