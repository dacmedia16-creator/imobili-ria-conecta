#!/usr/bin/env bash
# Ficha de moradores + pacote para a administradora (migration 20261216120000, t_40cff7e4) numa ÚNICA transação revertida
# (homologação ou clone, NUNCA produção). Aplica as bases da Locação que faltarem, tira a impressão digital, aplica a
# migration, roda a suíte, desfaz a migration e confere que o esquema voltou EXATAMENTE ao estado anterior e que as 5
# funções redefinidas voltaram ao texto de produção (md5 lido em 20/11/2026). Por fim ROLLBACK: nada fica gravado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-moradores-pacote.sh
#      MIG=<outra migration> para o controle negativo (a suíte tem de falhar).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
V=20261216120000
MIG="${MIG:-$ROOT/supabase/migrations/${V}_locacao_moradores_pacote.sql}"
RB="$ROOT/supabase/rollback/${V}_locacao_moradores_pacote.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
OUT="$(mktemp)"; trap ': > "$OUT"' EXIT
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a),'')||':'||coalesce(p.proconfig::text,'')||':'||md5(pg_get_functiondef(p.oid)) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(c.relacl) a),'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name||':'||coalesce(column_default,'') FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'trg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'pg_%'
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
  UNION ALL SELECT 'loc:'||id||':'||md5(row(l.*)::text) FROM public.locacoes l
  UNION ALL SELECT 'doc:'||id||':'||md5(row(d.*)::text) FROM public.locacao_documentos d
  UNION ALL SELECT 'ct:'||locacao_id||':'||md5(row(c.*)::text) FROM public.locacao_contrato_dados c) s),''));"
# md5 (pg_get_functiondef) das 5 funções em PRODUÇÃO (com o lote 2), lidas em 20/11/2026 antes da migration (só leitura).
PROD="locacao_checklist_l=96213c8934e8c038355e67d3c4607bbd locacao_contrato_salvar=7d5bc9dabf3f84668af507e2f208460e locacao_detalhe=1fc86ce791397970277ee7815b90a99f locacao_documento_ver=a4fa42b81a431bcd09b3a4daaf906872 locacao_partes_json=e5e9cd6702b5e3c599e67d3b0598fa16"
MD5="SELECT 'MD5 ' || CASE WHEN string_agg(p.proname || '=' || md5(pg_get_functiondef(p.oid)), ' ' ORDER BY p.proname) = '$PROD'
  THEN 'igual a produção' ELSE 'DIFERENTE de produção: ' || string_agg(p.proname || '=' || md5(pg_get_functiondef(p.oid)), ' ' ORDER BY p.proname) END
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('locacao_checklist_l', 'locacao_partes_json', 'locacao_contrato_salvar', 'locacao_detalhe', 'locacao_documento_ver');"
BASES=(
  "fn:public.so_locacao_ativo(uuid)|20261122120100_papel_locacao"
  "public.locacao_pre_links|20261124120000_locacao_cliente_preenche 20261124130000_locacao_pre_aprovacao"
  "public.locacao_config_sf_backup|20261129120000_locacao_seguro_fianca_sem_docs"
  "public.locacao_minutas|20261130120000_locacao_minuta_anexada"
  "public.locacao_anexos|20261201120000_locacao_modelos_contrato"
  "public.locacao_lancamentos|20261201150000_locacao_reuniao_16_11"
  "fn:public.locacao_tem_gas(public.locacoes)|20261211120000_locacao_boletos_condominio_gas"
  "fn:public.locacao_consultar_imovel(text)|20261211130000_locacao_consultar_imovel"
  "fn:public.locacao_contas_condominio(public.locacoes)|20261211150000_locacao_agua_gas_condominio"
  "public.locacao_docs_finais|20261214130000_locacao_documentos_finais"
)
{
  echo "BEGIN;"
  for b in "${BASES[@]}"; do
    rel="${b%%|*}"; migs="${b#*|}"
    case "$rel" in fn:*) q="SELECT to_regprocedure('${rel#fn:}') IS NOT NULL";; *) q="SELECT to_regclass('$rel') IS NOT NULL";; esac
    tem=$(psql "$PGCONN" -X -At -c "$q")
    if [ "$tem" != "t" ]; then for m in $migs; do strip "$ROOT/supabase/migrations/$m.sql"; echo "\\echo [base $m]"; done; fi
  done
  echo "$MD5"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/locacao-moradores-pacote.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  # O rollback tem de funcionar COM ficha, RG e download já gravados.
  echo "SAVEPOINT rbdados;"
  cat <<'EOF'
INSERT INTO public.locacoes (id, organization_id, corretor_id, etapa, endereco, garantia, imovel_tipo, aluguel, taxa_adm)
VALUES ('7c000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001', 'ebffaded-075c-493f-89e2-1d3d62901dc4',
  'documentacao', 'Rua Fictícia RB, 1', 'caucao', 'condominio', 2000, 10);
INSERT INTO public.locacao_moradores (locacao_id, organization_id, pessoas)
VALUES ('7c000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001',
  '[{"id":"6f1b7c1e-0000-4000-8000-0000000000d1","nome":"RB Fictício","cpf":"529.982.247-25","nascimento":"1990-01-01","email":"rb@exemplo.com","telefone":"15999990000"}]');
INSERT INTO public.locacao_pacote_downloads (locacao_id, organization_id, baixado_por)
VALUES ('7c000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001', 'ebffaded-075c-493f-89e2-1d3d62901dc4');
EOF
  strip "$RB"
  echo "SELECT CASE WHEN to_regclass('public.locacao_moradores') IS NULL AND EXISTS (SELECT 1 FROM public.locacoes WHERE id = '7c000000-0000-4000-8000-0000000000d1')
    THEN 'ok   rollback com ficha e download gravados (locação continua)' ELSE 'FALHA rollback com dados' END;"
  echo "ROLLBACK TO SAVEPOINT rbdados;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "$MD5"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 \
  | grep -E "^\[(base|migration|rollback)|^(ok|FALHA|TOTAL=|FP=|MD5)|ERROR|LINE|DETAIL|CONTEXT|psql:|WARNING" > "$OUT" || true
cat "$OUT"
# Sai com erro se houver FALHA, erro de SQL ou se o esquema não voltou ao estado anterior.
! grep -q -E "^FALHA|ERROR|psql:|DIFERENTE" "$OUT" && [ "$(grep -c '^FP=' "$OUT")" = 2 ] \
  && [ "$(grep '^FP=' "$OUT" | sort -u | wc -l)" = 1 ]
