#!/usr/bin/env bash
# Locação "Sem administração" (migration 20261217120000, t_ec2962bd) numa ÚNICA transação revertida (homologação ou
# clone, NUNCA produção). Aplica as bases da Locação que faltarem, tira a impressão digital, aplica a migration, roda a
# suíte nova e, como regressão, a suíte da reunião 16/11 (lançamento) com a migration aplicada; desfaz a migration e
# confere que o esquema voltou EXATAMENTE ao estado anterior e que as 5 funções voltaram ao texto de produção (md5).
# Por fim ROLLBACK: nada fica gravado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-sem-administracao.sh
#      MIG=<outra migration> para o controle negativo (a suíte nova tem de falhar).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
V=20261217120000
MIG="${MIG:-$ROOT/supabase/migrations/${V}_locacao_sem_administracao.sql}"
RB="$ROOT/supabase/rollback/${V}_locacao_sem_administracao.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a),'')||':'||coalesce(p.proconfig::text,'')||':'||md5(pg_get_functiondef(p.oid)) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(c.relacl) a),'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name||':'||coalesce(column_default,'') FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'trg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'pg_%'
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
  UNION ALL SELECT 'lan:'||locacao_id||':'||md5(row(x.*)::text) FROM public.locacao_lancamentos x
  UNION ALL SELECT 'ct:'||id||':'||md5(row(t.*)::text) FROM public.locacao_contratos t) s),''));"
# md5 das 5 funções em produção (pg_get_functiondef), lidas em 21/11/2026, já com o PR #371 (20261214140000) no ar (só leitura).
PROD="locacao_fin_criar_contrato=8356476d3d208d05fee433c3e74d37fa locacao_lancamento_ler=23698fe754be4bc32fdc840fa610349b locacao_lancamento_salvar=5ec2cc386e1cbd1e7e15131fc286f4c4 locacao_lista=c22b4fc15e5e086c6398a7ec5039d8f2 locacao_salvar_pre=984f90ae3655e9598141fabd63424352"
MD5="SELECT 'MD5 ' || CASE WHEN string_agg(p.proname || '=' || md5(pg_get_functiondef(p.oid)), ' ' ORDER BY p.proname) = '$PROD'
  THEN 'igual a produção' ELSE 'DIFERENTE de produção: ' || string_agg(p.proname || '=' || md5(pg_get_functiondef(p.oid)), ' ' ORDER BY p.proname) END
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('locacao_salvar_pre', 'locacao_lancamento_salvar',
  'locacao_lancamento_ler', 'locacao_lista', 'locacao_fin_criar_contrato');"
BASES=(
  "fn:public.so_locacao_ativo(uuid)|20261122120100_papel_locacao"
  "public.locacao_pre_links|20261124120000_locacao_cliente_preenche 20261124130000_locacao_pre_aprovacao"
  "public.locacao_config_sf_backup|20261129120000_locacao_seguro_fianca_sem_docs"
  "public.locacao_minutas|20261130120000_locacao_minuta_anexada"
  "public.locacao_lancamentos|20261201150000_locacao_reuniao_16_11"
  # PR #371 (no ar desde 20/11): lado/CRECI do parceiro; o #370 parte do texto dele em locacao_lancamento_ler/salvar.
  "public.locacao_parceiro_pagamento|20261214140000_locacao_parceiro_pagamento"
)
{
  echo "BEGIN;"
  for b in "${BASES[@]}"; do
    rel="${b%%|*}"; migs="${b#*|}"
    case "$rel" in fn:*) q="SELECT to_regprocedure('${rel#fn:}') IS NOT NULL";; *) q="SELECT to_regclass('$rel') IS NOT NULL";; esac
    tem=$(psql "$PGCONN" -X -At -c "$q")
    if [ "$tem" != "t" ]; then for m in $migs; do strip "$ROOT/supabase/migrations/$m.sql"; echo "\\echo [base $m]"; done; fi
  done
  # As bases da homologação vêm do repositório; as 5 funções passam a ter o texto de produção (o mesmo do rollback),
  # para o rollback provar que volta exatamente ao que está no ar.
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$RB" | sed -n '/^CREATE OR REPLACE FUNCTION/,/\$function\$;$/p'
  echo "$MD5"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-sem-administracao.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  if [ "${SEM_REGRESSAO:-}" != "1" ]; then
    echo "SAVEPOINT regr;"
    strip "$HERE/locacao-reuniao.sql" | sed -e "s/^SELECT 'TOTAL=' || /SELECT 'TOTAL=' || 'REGRESSAO-REUNIAO ' || /"
    echo "RESET ROLE;"
    echo "ROLLBACK TO SAVEPOINT regr;"
  fi
  # O rollback tem de funcionar COM locação/lançamento "sem administração" já gravados (voltam com 10%).
  echo "SAVEPOINT rbsem;"
  cat <<'EOF'
INSERT INTO public.locacoes (id, organization_id, corretor_id, etapa, candidato, endereco, garantia, aluguel, condominio, iptu,
  taxa_adm, sem_administracao)
VALUES ('7c000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'ebffaded-075c-493f-89e2-1d3d62901dc4',
  'pos_assinatura', '{"nome":"Sem Adm Fictícia"}', 'Rua Fictícia, 1', 'caucao', 2000, 0, 0, 0, true);
INSERT INTO public.locacao_lancamentos (locacao_id, organization_id, aluguel, taxa_adm, sem_administracao)
VALUES ('7c000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 2000, 0, true);
EOF
  strip "$RB"
  echo "SELECT CASE WHEN (SELECT taxa_adm FROM public.locacoes WHERE id = '7c000000-0000-4000-8000-000000000001') = 10
    AND (SELECT taxa_adm FROM public.locacao_lancamentos WHERE locacao_id = '7c000000-0000-4000-8000-000000000001') = 10
    THEN 'ok   rollback com linhas sem administração (voltam com 10%)' ELSE 'FALHA rollback com linhas sem administração' END;"
  echo "ROLLBACK TO SAVEPOINT rbsem;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "$MD5"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(base|migration|rollback)|^(ok|FALHA|TOTAL=|FP=|MD5)|ERROR|LINE|DETAIL|CONTEXT|psql:|WARNING"
