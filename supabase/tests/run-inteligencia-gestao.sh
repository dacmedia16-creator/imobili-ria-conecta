#!/usr/bin/env bash
# Inteligência de gestão (migration 20261108180000, t_1d3c07b3) numa ÚNICA transação revertida (homologação ou
# clone, nunca produção): [base] -> fingerprint A -> pendências de antes -> up -> suíte -> rollback ->
# fingerprint == A -> ROLLBACK. Nada fica gravado.
# Se a base ainda não tiver a 20261108160000 (Meta x atividades, já em produção), ela é aplicada antes, dentro
# da mesma transação.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-inteligencia-gestao.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
V=20261108180000
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||coalesce(p.proconfig::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'mod:'||organization_id||':'||module||':'||enabled FROM public.organization_modules) s),''));"
TEM_160=$(psql "$PGCONN" -X -q -At -c "SELECT count(*) FROM pg_proc WHERE proname='carreira_diario_equipe_semana'")
{
  echo "BEGIN;"
  if [ "$TEM_160" = "0" ]; then
    strip "$ROOT/supabase/migrations/20261108160000_meta_atividades_diario.sql"
    echo "\\echo [base: 20261108160000 aplicada na transação]"
  fi
  echo "$FP"
  # Pendências de C2 (QA A Corretor Dois) antes da migration.
  echo "CREATE TEMP TABLE pendencias_antes (kind text, capture_id uuid, imovel text, detalhe text, prazo date, dias integer);"
  echo "GRANT ALL ON pendencias_antes TO authenticated;"
  echo "SELECT set_config('request.jwt.claims', json_build_object('sub','ebffaded-075c-493f-89e2-1d3d62901dc4','role','authenticated')::text, true), set_config('request.jwt.claim.sub','ebffaded-075c-493f-89e2-1d3d62901dc4', true), set_config('mt.ctx','', true);"
  echo "SET LOCAL ROLE authenticated;"
  echo "INSERT INTO pendencias_antes SELECT * FROM public.minhas_pendencias();"
  echo "RESET ROLE;"
  echo "SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);"
  strip "$ROOT/supabase/migrations/${V}_inteligencia_gestao.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/inteligencia_gestao.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/${V}_inteligencia_gestao.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
