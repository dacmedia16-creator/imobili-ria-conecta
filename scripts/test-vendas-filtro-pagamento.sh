#!/bin/bash
# Migration 20261028200000 (t_7538ddac) em banco DESCARTÁVEL local (container pgt-3284-db, nada remoto):
# setup -> definição implantada hoje (= rollback) -> migration -> testes -> rollback -> confere volta -> reaplica.
# Uso: bash scripts/test-vendas-filtro-pagamento.sh [nome_db]
set -e
DB=${1:-t7538pag}
W=$(cd "$(dirname "$0")/.." && pwd)
C=pgt-3284-db
docker exec $C psql -U postgres -qc "DROP DATABASE IF EXISTS $DB" -qc "CREATE DATABASE $DB" >/dev/null
P="docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
NEW=$W/supabase/migrations/20261028200000_vendas_filtro_pagamento.sql
RB=$W/docs/sql/rollback/20261028200000_vendas_filtro_pagamento.rollback.sql
$P < "$W/scripts/test-vendas-filtro-pagamento-setup.sql"
# O rollback recria exatamente a definição implantada em 28/10 (estado "antes").
$P < "$RB" 2>&1 | grep -v NOTIFY || true
H() { $P -tAc "SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || md5(pg_get_functiondef(p.oid)) || ' acl=' || coalesce(array_to_string(p.proacl, ','), ''), ' | ' ORDER BY p.proname) FROM pg_proc p WHERE p.proname LIKE 'list_vendas_comerciais_paginadas%'"; }
ANTES=$(H)
$P < "$NEW"
echo "migration 20261028200000 aplicada (banco descartável)"
$P -tA < "$W/scripts/test-vendas-filtro-pagamento.sql"
$P < "$RB"
DEPOIS=$(H)
[ "$ANTES" = "$DEPOIS" ] && echo "rollback: as 2 RPCs voltaram idênticas (definição + permissões)" || { echo "FAIL rollback diferente"; echo "$ANTES"; echo "$DEPOIS"; }
$P < "$NEW"
$P -tAc "SELECT 'reaplicada: ' || (to_regprocedure('public.list_vendas_comerciais_paginadas(integer, integer, text, text[], date, date, text, uuid[], text, text)') IS NOT NULL)"
[ "${MANTER:-0}" = "1" ] || docker exec $C psql -U postgres -qc "DROP DATABASE IF EXISTS $DB"
