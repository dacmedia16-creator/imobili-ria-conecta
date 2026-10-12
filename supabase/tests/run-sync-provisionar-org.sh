#!/usr/bin/env bash
# Roda migration 20261012150000 + teste na HOMOLOGAÇÃO (qvhyepwduhlgqwpgmpvh), tudo numa transação desfeita.
# Usa a conexão protegida em ~/.config/max/adm-max-homolog-pg (nunca imprime senha). Sucesso = "RESULTADO OK".
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CONN_DIR="${ADM_HOMOLOG_PG_DIR:-$HOME/.config/max/adm-max-homolog-pg}"
CONN="$(cat "$CONN_DIR/conn")"
case "$CONN" in *qvhyepwduhlgqwpgmpvh*) ;; *) echo "Recusado: conexão não é a homologação." >&2; exit 1 ;; esac
export PGPASSFILE="$CONN_DIR/pgpass"
OUT="$( { echo 'begin;'; cat "$DIR/../migrations/20261012150000_sync_provisionar_org.sql" "$DIR/sync_provisionar_org.sql"; echo 'rollback;'; } \
  | psql "$CONN" -v ON_ERROR_STOP=1 -X -q -P pager=off 2>&1)"
echo "$OUT" | grep -E "RESULTADO OK|FALHA|ERROR" | head -5
echo "$OUT" | grep -q "RESULTADO OK"
