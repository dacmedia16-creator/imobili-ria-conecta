#!/usr/bin/env bash
# Teste somente em homologação: migration, matriz de acesso, envio idempotente e reversão na mesma transação.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?Use a conexão da homologação; produção é proibida.}"
case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo 'PRODUÇÃO RECUSADA'; exit 1;; esac
MIG="$ROOT/supabase/migrations/20261214130000_locacao_documentos_finais.sql"
RB="$ROOT/supabase/rollback/20261214130000_locacao_documentos_finais.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);[[:space:]]*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
 SELECT 'fn:'||p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid)) x FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
 UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity FROM pg_class c WHERE c.relnamespace='public'::regnamespace
 UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
 UNION ALL SELECT 'mod:'||organization_id||':'||module||':'||enabled FROM public.organization_modules) s),''));"
{
 echo 'BEGIN;'
 # A homologação pode estar atrás da Locação: aplica somente bases faltantes, sempre na transação desfeita.
 for base in 'public.locacao_minutas|20261130120000_locacao_minuta_anexada' 'public.locacao_anexos|20261201120000_locacao_modelos_contrato'; do
   rel="${base%%|*}"; vers="${base#*|}"
   if [ "$(psql "$PGCONN" -X -At -c "select to_regclass('$rel') is not null")" != t ]; then
     strip "$ROOT/supabase/migrations/$vers.sql"
     echo "\\echo [base $vers]"
   fi
 done
 echo "$FP"
 strip "$MIG"
 echo '\echo [migration ok]'
 echo 'SAVEPOINT suite;'
 cat "$HERE/locacao-docs-finais.sql"
 echo 'RESET ROLE;'
 echo 'ROLLBACK TO SAVEPOINT suite;'
 strip "$RB"
 echo '\echo [rollback ok]'
 echo "$FP"
 echo 'ROLLBACK;'
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | tee /dev/stderr | {
 OUT="$(cat)"
 FPS="$(grep '^FP=' <<<"$OUT" | sort -u | wc -l)"
 if grep -qE '^FALHA|ERROR|psql:' <<<"$OUT" || ! grep -q 'FAIL=0' <<<"$OUT" || [ "$FPS" != 1 ]; then echo 'RESULTADO: FALHOU'; exit 1; fi
 echo 'RESULTADO: OK'
}
