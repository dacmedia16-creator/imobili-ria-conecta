#!/usr/bin/env bash
# Ensaio completo dos itens 1 e 2 (migrations 20261008100000/100100/100200) numa ÚNICA transação revertida:
#   massa sintética (137 vendas na imobiliária A + 34 na B) -> ANTES (matriz 16 perfis + tempos)
#   -> aplica 00,01,02 -> aplica de novo (idempotência) -> DEPOIS (equivalência, matriz, tempos, reconciliação)
#   -> DESFAZ (rollback gerado de produção) -> estado == ANTES e matriz == ANTES
#   -> REAPLICA -> matriz + reconciliação -> ROLLBACK (o banco de teste fica como estava).
# Uso: PSQL="psql <conexão da HOMOLOGAÇÃO>" bash supabase/tests/perf_itens_1_2/ensaio.sh > ensaio.log 2>&1
# NUNCA apontar para produção: o script se recusa a rodar se a ref de produção aparecer na conexão.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação, nunca produção)}"
case "$PSQL" in *xvvymgurpchhlmbpjbgc*) echo "RECUSADO: conexão de produção" >&2; exit 2;; esac
M="$ROOT/supabase/migrations"
UP0="$M/20261008100000_perf_00_backup_definicoes.sql"
UP1="$M/20261008100100_perf_01_permissoes_lista_vendas.sql"
UP2="$M/20261008100200_perf_02_venda_distribuicao.sql"
DOWN="$ROOT/supabase/rollback/20261008100000_perf_itens_1_2.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
python3 "$HERE/gen_matriz.py" >/dev/null

# impressão digital do schema public (tabelas, ACL, funções, policies com texto, gatilhos)
STATE="SELECT 'STATE|' || :'rot' || '|' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'rel:'||c.relname||':'||coalesce(c.relacl::text,'') x FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'fn:'||p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) FROM pg_policies WHERE schemaname='public'
  UNION ALL SELECT 'trg:'||tgrelid::regclass::text||':'||tgname||':'||tgenabled::text FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)) s),''));"
fase() { echo "select set_config('perf.fase', '$1', true);"; }
etapa() { # mede o tempo de aplicação de um arquivo
  echo "select clock_timestamp() as t0 \\gset"
  strip "$2"
  echo "select 'TEMPO_APLICACAO|$1|' || round(extract(epoch from clock_timestamp() - :'t0'::timestamptz) * 1000) || ' ms';"
}
medir() {
  for p in "admin|10000000-0000-4000-8000-000000000001|1" "financeiro|b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed|1" \
           "gestor|cab7391a-463f-4d97-b99b-ced6e4696796|0" "corretor|ebffaded-075c-493f-89e2-1d3d62901dc4|0"; do
    IFS='|' read -r nome uid priv <<<"$p"
    echo "\\set perfil '$nome'"; echo "\\set uid '$uid'"; echo "\\set priv $priv"
    cat "$HERE/medir.sql"
  done
}
foto() { fase "$1"; cat "$HERE/snapshot.sql"; }

{
  echo "BEGIN;"
  echo "\\set n_a 130"; echo "\\set n_orgs 0"; echo "\\set n_per 0"
  cat "$HERE/fixture_defs_producao.sql"   # funções de permissão iguais às de produção
  cat "$HERE/fixture_seed.sql"
  echo "create temp table matriz (fase text, papel text, objeto text, n bigint, h text) on commit drop;"
  echo "create temp table equiv (fase text, papel text, so_antigo int, so_novo int, total int) on commit drop;"
  echo "create temp table tempos (fase text, perfil text, consulta text, ms numeric) on commit drop;"
  echo "grant all on tempos to authenticated;"
  echo "\\set rot 'A-antes'"; echo "$STATE"
  foto antes; fase antes; medir

  etapa "00-backup" "$UP0"; etapa "01-permissoes" "$UP1"; etapa "02-calculo-gravado" "$UP2"
  echo "\\set rot 'B-aplicado'"; echo "$STATE"
  etapa "00-backup(2a vez)" "$UP0"; etapa "01-permissoes(2a vez)" "$UP1"; etapa "02-calculo-gravado(2a vez)" "$UP2"
  echo "\\set rot 'B-aplicado-2x'"; echo "$STATE"

  fase depois; cat "$HERE/equivalencia.sql"
  foto depois; fase depois; medir
  cat "$HERE/reconciliacao.sql"

  etapa "desfazer" "$DOWN"
  echo "\\set rot 'A-desfeito'"; echo "$STATE"
  foto desfeito

  etapa "00-backup(reaplica)" "$UP0"; etapa "01-permissoes(reaplica)" "$UP1"; etapa "02-calculo-gravado(reaplica)" "$UP2"
  echo "\\set rot 'B-reaplicado'"; echo "$STATE"
  fase reaplicado; cat "$HERE/equivalencia.sql"
  foto reaplicado
  cat "$HERE/reconciliacao.sql"

  cat "$HERE/resultado.sql"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -F'|' -v ON_ERROR_STOP=1 2>&1 | grep -E 'STATE\||TEMPO|RES\||MATRIZ|EQUIV|ERRO_|^FIM|RECON\||etapa [012]|ERROR|FALHOU' || true
