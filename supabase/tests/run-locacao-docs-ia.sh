#!/usr/bin/env bash
# Locação — Documentação com leitura por IA (migration 20261112120000, t_127811ca) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção). Aplica Fase 1 e Fase 2 se ainda não existirem, tira a impressão digital,
# aplica a migration, roda a suíte nova + a suíte inteira da Fase 1 (regressão), desfaz a migration e confere que o
# esquema voltou EXATAMENTE ao estado anterior. Por fim ROLLBACK: nada fica gravado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-docs-ia.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||coalesce(p.proconfig::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'mod:'||organization_id||':'||module||':'||enabled FROM public.organization_modules
  UNION ALL SELECT 'org:'||id||':'||md5(row(o.*)::text) FROM public.organizations o) s),''));"
F1=$(psql "$PGCONN" -X -At -c "SELECT to_regclass('public.locacoes') IS NOT NULL")
F2=$(psql "$PGCONN" -X -At -c "SELECT to_regclass('public.locacao_contratos') IS NOT NULL")
{
  echo "BEGIN;"
  if [ "$F1" != "t" ]; then strip "$ROOT/supabase/migrations/20261110120000_locacao_fase1.sql"; echo "\\echo [fase1 aplicada na transação]"; fi
  if [ "$F2" != "t" ]; then strip "$ROOT/supabase/migrations/20261111120000_locacao_fase2_financeiro.sql"; echo "\\echo [fase2 aplicada na transação]"; fi
  echo "$FP"
  strip "$ROOT/supabase/migrations/20261112120000_locacao_documentos_ia.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-docs-ia.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  # Regressão: a suíte inteira da Fase 1, com a migration nova aplicada.
  echo "SAVEPOINT fase1;"
  # Antes do 1º envio à Conferência, completa os dados do contrato (fictícios): a trava nova vale p/ residencial+fiador.
  strip "$HERE/locacao.sql" | sed -e "s/^SELECT 'TOTAL=' || /SELECT 'TOTAL=' || 'FASE1 ' || /" | awk -v f="$HERE/locacao-docs-ia-fase1-dados.sql" '
    !feito && $0 == "SELECT public.locacao_enviar_documentacao(pg_temp.id('"'"'L'"'"'));" { while ((getline l < f) > 0) print l; feito = 1 }
    { print }'
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT fase1;"
  strip "$ROOT/supabase/rollback/20261112120000_locacao_documentos_ia.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(fase1|fase2|migration|rollback)|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
