#!/usr/bin/env bash
# Locação — ficha de abertura + checklist por parte + trava do "Montar contrato" (migration 20261113120000, t_28e583e2)
# numa ÚNICA transação revertida (homologação ou clone, nunca produção). Aplica Fase 1, Fase 2 e Documentação por IA
# se ainda não existirem, tira a impressão digital, aplica a migration, roda a suíte nova e, como regressão, as
# suítes inteiras da Fase 1, da Documentação por IA e da Fase 2; desfaz a migration e confere que o esquema voltou
# EXATAMENTE ao estado anterior. Por fim ROLLBACK: nada fica gravado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-ficha.sh
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
F3=$(psql "$PGCONN" -X -At -c "SELECT to_regclass('public.locacao_contrato_dados') IS NOT NULL")
# Regressão: com a migration nova, a pré-análise só vai à gestora com a ficha cadastral completa. Este trecho preenche
# a ficha (fictícia; captador = o próprio corretor) logo antes de cada envio das suítes antigas.
FICHA='{"ficha":{"imovel_id":"IM-TESTE","mobilia":"sem","metragem":50,"locatario_endereco":"Rua Atual Fictícia, 5 — Sorocaba/SP","proprietario":{"nome":"Proprietário Fictício","email":"prop@teste.invalid"}},"captador_id":"ebffaded-075c-493f-89e2-1d3d62901dc4"}'
com_ficha() { sed -E "s|^SELECT public\.locacao_enviar_pre\(pg_temp\.id\('([A-Za-z0-9]+)'\)\);$|SELECT public.locacao_salvar_pre(pg_temp.id('\1'), '$FICHA');\n&|"; }
{
  echo "BEGIN;"
  if [ "$F1" != "t" ]; then strip "$ROOT/supabase/migrations/20261110120000_locacao_fase1.sql"; echo "\\echo [fase1 aplicada na transação]"; fi
  if [ "$F2" != "t" ]; then strip "$ROOT/supabase/migrations/20261111120000_locacao_fase2_financeiro.sql"; echo "\\echo [fase2 aplicada na transação]"; fi
  if [ "$F3" != "t" ]; then strip "$ROOT/supabase/migrations/20261112120000_locacao_documentos_ia.sql"; echo "\\echo [docs-ia aplicada na transação]"; fi
  echo "$FP"
  strip "$ROOT/supabase/migrations/20261113120000_locacao_ficha_checklist.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-ficha.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  # Regressão 1: Fase 1 inteira (dados do contrato antes do 1º envio à Conferência, como no run-locacao-docs-ia.sh;
  # a 2ª locação, criada direto na minuta, recebe os documentos para a trava nova do "Montar contrato").
  echo "SAVEPOINT fase1;"
  strip "$HERE/locacao.sql" | sed -e "s/^SELECT 'TOTAL=' || /SELECT 'TOTAL=' || 'FASE1 ' || /" | com_ficha | awk -v f="$HERE/locacao-docs-ia-fase1-dados.sql" '
    !feito && $0 == "SELECT public.locacao_enviar_documentacao(pg_temp.id('"'"'L'"'"'));" { while ((getline l < f) > 0) print l; feito = 1 }
    { print }
    /RETURNING pg_temp.setid\('"'"'L2'"'"', id\);$/ {
      print "INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo) SELECT pg_temp.id('"'"'orgA'"'"'), pg_temp.id('"'"'L2'"'"'), x, '"'"'regressao/'"'"' || x, '"'"'x.pdf'"'"' FROM unnest(public.locacao_checklist_l((SELECT l FROM public.locacoes l WHERE l.id = pg_temp.id('"'"'L2'"'"')))) x;"
    }'
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT fase1;"
  # Regressão 2: Documentação com leitura por IA inteira.
  echo "SAVEPOINT docsia;"
  strip "$HERE/locacao-docs-ia.sql" | sed -e "s/^SELECT 'TOTAL=' || /SELECT 'TOTAL=' || 'DOCS-IA ' || /" | com_ficha
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT docsia;"
  # Regressão 3: Fase 2 (financeiro) inteira.
  echo "SAVEPOINT fin;"
  strip "$HERE/locacao-fin.sql" | sed -e "s/^SELECT 'TOTAL=' || /SELECT 'TOTAL=' || 'FASE2 ' || /"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT fin;"
  strip "$ROOT/supabase/rollback/20261113120000_locacao_ficha_checklist.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(fase1|fase2|docs-ia|migration|rollback)|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
