#!/usr/bin/env bash
# Ensaio local da migration 20260929180000 (tela Vendas pela última assinatura) num Postgres
# DESCARTÁVEL (docker, só 127.0.0.1) que já tenha o schema da produção (ex.: clone estrutural).
# Nunca fala com banco remoto. Tudo roda em transação com ROLLBACK: o container não é alterado.
# Uso: CONTAINER=<container-local> bash supabase/tests/run-vendas-data-ultima-assinatura.sh
#  1. suíte com a regra atual (deve reprovar os casos de reassinatura)
#  2. BEGIN; up; suíte; ROLLBACK  (deve passar 100%)
#  3. BEGIN; up; rollback literal; suíte; ROLLBACK (deve voltar a reprovar igual ao passo 1)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CONTAINER="${CONTAINER:?defina CONTAINER (Postgres local descartável)}"
PSQL=(docker exec -i -e PGPASSWORD=localtest "$CONTAINER" psql -h 127.0.0.1 -X -q -At -v ON_ERROR_STOP=1 -U supabase_admin -d postgres)
UP="$ROOT/supabase/migrations/20260929180000_vendas_data_ultima_assinatura.sql"
DOWN="$ROOT/docs/sql/rollback/20260929180000_vendas_data_ultima_assinatura.rollback.sql"
SUITE="$HERE/vendas_data_ultima_assinatura.sql"
# A suíte abre e fecha a própria transação; para empilhar up/down removemos o BEGIN/ROLLBACK dela.
BODY="$(sed -e '/^BEGIN;$/d' -e '/^ROLLBACK;$/d' "$SUITE")"

echo "[antes] $("${PSQL[@]}" < "$SUITE" | grep '^TOTAL=')"
"${PSQL[@]}" < "$SUITE" | grep '^FALHA' | sed 's/^/[antes] /' || true

{ echo 'BEGIN;'; cat "$UP"; echo "$BODY"; echo 'ROLLBACK;'; } | "${PSQL[@]}" | grep -E '^(OK|FALHA|TOTAL=)' | sed 's/^/[up] /'

{ echo 'BEGIN;'; cat "$UP"; cat "$DOWN"; echo "$BODY"; echo 'ROLLBACK;'; } | "${PSQL[@]}" | grep -E '^TOTAL=' | sed 's/^/[up+down] /'

# prova de que nada ficou no container
echo "[container] vendas sintéticas restantes: $("${PSQL[@]}" -c "select count(*) from public.sales where imovel_id like 'VUA-%'")"
