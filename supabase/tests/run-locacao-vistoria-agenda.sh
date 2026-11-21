#!/usr/bin/env bash
# Agendamento da vistoria + avisos (migration 20261214120000, t_c3ea1b18) numa ÚNICA transação revertida (homologação
# ou clone, NUNCA produção): aplica as bases da Locação que faltarem, impressão digital A -> migration -> suíte ->
# rollback -> impressão digital == A -> ROLLBACK. Nada fica gravado e nada é enviado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-vistoria-agenda.sh
# Controle negativo: MIG=<outro arquivo> roda a suíte contra outra versão da migration.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
MIG="${MIG:-$ROOT/supabase/migrations/20261214120000_locacao_vistoria_agenda.sql}"
RB="$ROOT/supabase/rollback/20261214120000_locacao_vistoria_agenda.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a),'')||':'||coalesce(p.proconfig::text,'')||':'||md5(pg_get_functiondef(p.oid)) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(c.relacl) a),'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'trg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'pg_%'
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
  UNION ALL SELECT 'av:'||id||':'||md5(row(a.*)::text) FROM public.locacao_avisos a) s),''));"
BASES=(
  "fn:public.so_locacao_ativo(uuid)|20261122120100_papel_locacao"
  "public.locacao_pre_links|20261124120000_locacao_cliente_preenche 20261124130000_locacao_pre_aprovacao"
  "public.locacao_config_sf_backup|20261129120000_locacao_seguro_fianca_sem_docs"
  "public.locacao_minutas|20261130120000_locacao_minuta_anexada"
  "public.locacao_modelos|20261201120000_locacao_modelos_contrato"
  "public.locacao_avisos|20261201150000_locacao_reuniao_16_11"
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
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-vistoria-agenda.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(base|migration|rollback)|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:|WARNING" | tee /dev/stderr \
  | { OUT="$(cat)"; FPS="$(grep '^FP=' <<<"$OUT" | sort -u | wc -l)"
      if grep -qE '^FALHA|ERROR|psql:' <<<"$OUT" || ! grep -q 'falhas=0' <<<"$OUT" || [ "$FPS" != 1 ]; then
        echo "RESULTADO: FALHOU"; exit 1; fi; echo "RESULTADO: OK"; }
