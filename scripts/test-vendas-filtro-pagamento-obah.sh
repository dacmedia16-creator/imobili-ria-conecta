#!/bin/bash
# Migration 20261028233000 (t_1e3dda48) em banco DESCARTÁVEL local (container pgt-3284-db, nada remoto):
# setup -> oba_credito -> definição implantada hoje (= rollback) -> migration -> testes -> rollback -> confere volta -> reaplica.
# Uso: bash scripts/test-vendas-filtro-pagamento-obah.sh [nome_db]
set -e
DB=${1:-t1e3obah}
W=$(cd "$(dirname "$0")/.." && pwd)
C=pgt-3284-db
docker exec $C psql -U postgres -qc "DROP DATABASE IF EXISTS $DB" -qc "CREATE DATABASE $DB" >/dev/null
P="docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
NEW=$W/supabase/migrations/20261028233000_vendas_filtro_pagamento_obah.sql
RB=$W/docs/sql/rollback/20261028233000_vendas_filtro_pagamento_obah.rollback.sql
$P < "$W/scripts/test-vendas-filtro-pagamento-setup.sql"
# Coluna como em produção + dados sintéticos de Obah.
$P -c "ALTER TABLE public.sale_payment ADD COLUMN oba_credito boolean NOT NULL DEFAULT false;
UPDATE public.sale_payment SET oba_credito = true WHERE sale_id IN (
  '00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000021');" >/dev/null
# Estado "antes" = definição implantada em produção hoje (o rollback a recria).
$P < "$RB" 2>&1 | grep -v NOTIFY || true
H() { $P -tAc "SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || md5(pg_get_functiondef(p.oid)) || ' acl=' || coalesce(array_to_string(p.proacl, ','), ''), ' | ' ORDER BY p.proname) FROM pg_proc p WHERE p.proname LIKE 'list_vendas_comerciais_paginadas%'"; }
ANTES=$(H)
# Antes da migration, a opção nova não traz nada (frontend novo com banco antigo não quebra).
$P -tAc "SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false); SET ROLE authenticated; SELECT 'banco antigo + opcao Obah -> ' || (public.list_vendas_comerciais_paginadas(0,50,NULL,NULL,'2026-10-01','2026-10-31',NULL,NULL,NULL,'financiamento_obah')->>'total_count') || ' linhas (sem erro)';" | tail -1
$P < "$NEW"
echo "migration 20261028233000 aplicada (banco descartável)"
$P -tA < "$W/scripts/test-vendas-filtro-pagamento-obah.sql"
# A suíte anterior (t_7538ddac) continua passando com a migration nova.
$P -tA < "$W/scripts/test-vendas-filtro-pagamento.sql" | tail -1 | sed 's/^/suite anterior (t_7538ddac): /'
$P < "$RB"
DEPOIS=$(H)
[ "$ANTES" = "$DEPOIS" ] && echo "rollback: as 2 RPCs voltaram idênticas (definição + permissões)" || { echo "FAIL rollback diferente"; echo "$ANTES"; echo "$DEPOIS"; }
$P < "$NEW"
$P -tAc "SELECT 'reaplicada: ' || (SELECT count(*) FROM pg_proc WHERE proname LIKE 'list_vendas_comerciais_paginadas%' AND pg_get_functiondef(oid) LIKE '%financiamento_obah%')"
[ "${MANTER:-0}" = "1" ] || docker exec $C psql -U postgres -qc "DROP DATABASE IF EXISTS $DB"
