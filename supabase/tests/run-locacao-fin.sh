#!/usr/bin/env bash
# Locação Fase 2 — Financeiro (migration 20261111120000, t_be750361) numa ÚNICA transação revertida (homologação ou
# clone, nunca produção). Aplica a Fase 1 se ainda não existir, cria uma locação fictícia já com chave entregue (para
# provar o contrato criado na migration), aplica a Fase 2, roda a suíte, desfaz a Fase 2 e confere que o esquema voltou
# EXATAMENTE ao estado da Fase 1 (impressão digital igual). Por fim ROLLBACK: nada fica gravado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-fin.sh
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
  UNION ALL SELECT 'pap:'||organization_id||':'||user_id||':'||papel FROM public.locacao_papeis
  UNION ALL SELECT 'org:'||id||':'||md5(row(o.*)::text) FROM public.organizations o) s),''));"
F1_EXISTE=$(psql "$PGCONN" -X -At -c "SELECT to_regclass('public.locacoes') IS NOT NULL")
{
  echo "BEGIN;"
  if [ "$F1_EXISTE" != "t" ]; then
    strip "$ROOT/supabase/migrations/20261110120000_locacao_fase1.sql"
    echo "\\echo [fase1 aplicada na transação]"
  fi
  # Locação fictícia já com chave entregue ANTES da Fase 2 (como as que já existem em produção).
  cat <<'EOF'
INSERT INTO public.locacoes (id, organization_id, corretor_id, etapa, candidato, endereco, garantia, aluguel, condominio, iptu,
  taxa_adm, chave_em)
VALUES ('7b000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'ebffaded-075c-493f-89e2-1d3d62901dc4',
  'comissao', '{"nome":"Pré-existente Fictícia"}', 'Rua Fictícia Antiga, 1 — Sorocaba/SP', 'caucao', 1500, 0, 0, 8,
  (now() AT TIME ZONE 'America/Sao_Paulo')::date - 20);
EOF
  echo "$FP"
  strip "$ROOT/supabase/migrations/20261111120000_locacao_fase2_financeiro.sql"
  echo "\\echo [migration ok]"
  # Regressão: a suíte da Fase 1 inteira, agora com a Fase 2 aplicada (sem a locação pré-existente fictícia).
  echo "SAVEPOINT fase1;"
  echo "DELETE FROM public.locacao_contratos WHERE locacao_id = '7b000000-0000-4000-8000-000000000001';"
  echo "DELETE FROM public.locacoes WHERE id = '7b000000-0000-4000-8000-000000000001';"
  strip "$HERE/locacao.sql" | sed -e "s/^SELECT 'TOTAL=' || /SELECT 'TOTAL=' || 'FASE1 ' || /"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT fase1;"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-fin.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/20261111120000_locacao_fase2_financeiro.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(fase1|migration|rollback)|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:|^(SELECT|UPDATE|INSERT)" || true
