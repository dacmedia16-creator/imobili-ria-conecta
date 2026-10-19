#!/usr/bin/env bash
# Ensaio da migration 20261019140000_rls_leve_painel_vendas_financeiro (t_f8b87dd1) numa ÚNICA transação REVERTIDA,
# em cópia LOCAL (container Supabase/Postgres descartável). Nunca produção.
#   1) pré-requisitos de schema que a cópia local não tem (colunas/tabela já existentes em produção)
#   2) carrega as definições de PRODUÇÃO (funções do fecho + policies de leitura; estado_producao.sql)
#   3) massa SINTÉTICA (perf_itens_1_2/fixture_seed.sql + extra_seed.sql) e resultado gravado da distribuição
#   4) ANTES: saída completa de cada função por perfil + tempos
#   5) aplica a migration (2x: idempotência) -> DEPOIS: saída + tempos
#   6) aplica o rollback -> DESFEITO: saída + texto das 5 funções igual ao de produção
#   7) compara (resultado.sql) -> ROLLBACK (o banco local fica como estava)
# Uso: CONTAINER=adm-hom-ensaio bash supabase/tests/rls_leve/ensaio.sh > ensaio.log
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
CONTAINER="${CONTAINER:-adm-hom-ensaio}"
case "$CONTAINER" in *xvvymgurpchhlmbpjbgc*) echo "RECUSADO: produção" >&2; exit 2;; esac
V=20261019140000_rls_leve_painel_vendas_financeiro
UP="$ROOT/supabase/migrations/$V.sql"
DOWN="$ROOT/supabase/rollback/$V.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK|begin|commit|rollback);\s*$' "$1"; }
python3 "$HERE/gen_ensaio.py" >/dev/null
PSQL=(docker exec -i -e PGPASSWORD=localtest "$CONTAINER" psql -h 127.0.0.1 -X -q -At -v ON_ERROR_STOP=1 -U supabase_admin -d postgres)
PROD_POL_MD5=480305b9925b8f9565897807cf72c42e
# Pré-passo (transação revertida): ao recriar as policies de produção localmente o Postgres reimprime o texto
# sem os parênteses redundantes do OR (mesmo significado), então a impressão digital local é outra. Só NESTE
# ensaio a conferência da migration usa a impressão digital local; o arquivo da migration não muda.
POL_EXPR=$(grep -o "(select md5(string_agg(tablename.*cmd in ('SELECT','ALL'))" "$UP" | head -1)
LOCAL_POL_MD5=$({
  echo "BEGIN;"
  echo "create table if not exists public.venda_distribuicao (sale_id uuid primary key, organization_id uuid not null, resultado jsonb not null, atualizado_em timestamptz not null default now());"
  echo "alter table public.venda_distribuicao enable row level security;"
  cat "$HERE/estado_producao.sql"
  echo "set local search_path = public;"
  echo "select 'POLMD5|' || $POL_EXPR;"
  echo "ROLLBACK;"
} | "${PSQL[@]}" 2>&1 | grep '^POLMD5|' | cut -d'|' -f2)
[ -n "$LOCAL_POL_MD5" ] || { echo "ERRO_PREPASSO: impressão digital local das policies"; exit 1; }
echo "POLICIES|producao=$PROD_POL_MD5|local_recriada=$LOCAL_POL_MD5"
up() { strip "$UP" | sed "s/'$PROD_POL_MD5'/'$LOCAL_POL_MD5'/"; }
fase() { echo "select set_config('rl.fase', '$1', true);"; }
SRC="select 'SRC|' || :'rot' || '|' || p.proname || '|' || md5(p.prosrc) || '|' || p.prosecdef || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proacl::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('dashboard_stats','vendas_comerciais_canonicas','list_vendas_comerciais_paginadas','financeiro_distribuicao_vendas','comparativo_comissao_6pct_inconsistencias') order by p.proname;"
NOVAS="select 'NOVAS|' || :'rot' || '|' || count(*) from pg_proc where pronamespace = 'public'::regnamespace and (proname like '%\\_leve' or proname like '%\\_por\\_rls' or proname = 'rls_leve_contexto');"
{
  echo "BEGIN;"
  echo "set local statement_timeout = 0;"
  cat <<'SQL'
-- 1) colunas/tabela que produção já tem e a cópia local não (conferido em produção, só leitura)
alter table public.sales add column if not exists exclusive_capture_id uuid, add column if not exists tipo_imovel text,
  add column if not exists quartos smallint, add column if not exists suites smallint, add column if not exists banheiros smallint,
  add column if not exists vagas smallint, add column if not exists ano_construcao smallint, add column if not exists area_util_m2 numeric,
  add column if not exists area_construida_m2 numeric, add column if not exists area_terreno_m2 numeric, add column if not exists area_origem text,
  add column if not exists area_confirmada_em timestamptz, add column if not exists area_confirmada_por uuid,
  add column if not exists parceria_email text, add column if not exists parceria_observacoes text;
alter table public.occurrence_partners add column if not exists email text;
-- produção só tem a lista/fila com 9 argumentos (_midia); a cópia local ainda tem a de 8 -> chamada ambígua (42725)
drop function if exists public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[]);
drop function if exists public.list_vendas_comerciais_paginadas_fila(integer,integer,text,text[],date,date,text,uuid[]);
-- em produção mt_1b_definer é membro de authenticated (lê o schema auth); a cópia local não tinha
grant authenticated to mt_1b_definer;
alter table public.organization_members add column if not exists participa_sessenta boolean not null default true;
alter table public.organizations add column if not exists mapa_site_enabled boolean not null default false;
create table if not exists public.venda_distribuicao (
  sale_id uuid primary key references public.sales(id) on delete cascade,
  organization_id uuid not null, resultado jsonb not null, atualizado_em timestamptz not null default now());
alter table public.venda_distribuicao enable row level security;
revoke all on public.venda_distribuicao from public, anon, authenticated, service_role;
grant select on public.venda_distribuicao to authenticated, service_role;
SQL
  cat "$HERE/estado_producao.sql"
  echo "\\set n_a 130"; echo "\\set n_orgs 0"; echo "\\set n_per 0"
  cat "$ROOT/supabase/tests/perf_itens_1_2/fixture_seed.sql"
  cat "$HERE/extra_seed.sql"
  cat <<'SQL'
insert into public.venda_distribuicao (sale_id, organization_id, resultado)
select s.id, s.organization_id, public.calcular_distribuicao_venda(s.*) from public.sales s
on conflict (sale_id) do update set resultado = excluded.resultado;
analyze public.venda_distribuicao;
select 'MASSA|vendas=' || (select count(*) from public.sales) || '|orgs=' || (select count(distinct organization_id) from public.sales)
  || '|ocorrencias=' || (select count(*) from public.occurrences) || '|historico=' || (select count(*) from public.sale_status_history)
  || '|occ_comissoes=' || (select count(*) from public.occurrence_commissions) || '|extras=' || (select count(*) from public.sale_commission_extras)
  || '|distribuicao=' || (select count(*) from public.venda_distribuicao);
create temp table saida (fase text, perfil text, uid text, chamada text, n bigint, texto text, ids uuid[]) on commit drop;
create temp table tempos (fase text, perfil text, consulta text, ms numeric) on commit drop;
grant all on saida, tempos to authenticated, anon;
SQL
  echo "\\set rot 'antes'"; echo "$SRC"
  fase antes; cat "$HERE/captura.sql"; fase antes; cat "$HERE/medir.sql"

  echo "select clock_timestamp() as t0 \\gset"
  up
  echo "select 'APLICADA|1a vez|' || round(extract(epoch from clock_timestamp() - :'t0'::timestamptz) * 1000) || ' ms';"
  up
  echo "select 'APLICADA|2a vez (idempotente)|ok';"
  echo "\\set rot 'depois'"; echo "$SRC"; echo "$NOVAS"
  fase depois; cat "$HERE/captura.sql"; fase depois; cat "$HERE/medir.sql"
  # diagnóstico opcional (ex.: EXPLAIN) com a migration aplicada; saída marcada com prefixo EXTRA
  if [ -n "${EXTRA_SQL:-}" ]; then cat "$EXTRA_SQL"; fi

  strip "$DOWN"
  echo "select 'DESFEITO|ok';"
  echo "\\set rot 'desfeito'"; echo "$SRC"; echo "$NOVAS"
  fase desfeito; cat "$HERE/captura.sql"; fase desfeito; cat "$HERE/medir.sql"

  cat "$HERE/resultado.sql"
  echo "ROLLBACK;"
} | "${PSQL[@]}" 2>&1 \
  | grep -E '(MASSA|SRC|NOVAS|APLICADA|DESFEITO|IGUAL|DIFERENCA|VAZAMENTO|ERRO_CHAMADA|RESUMO|TEMPO|EXTRA)|ERROR|LINE|DETAIL|CONTEXT|psql:'
