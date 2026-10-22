#!/usr/bin/env bash
# Roda o teste da migration 20261022120000 na HOMOLOGAÇÃO (qvhyepwduhlgqwpgmpvh), em transação desfeita.
# Usa a conexão protegida em ~/.config/max/adm-max-homolog-pg (nunca imprime senha).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CONN_DIR="${ADM_HOMOLOG_PG_DIR:-$HOME/.config/max/adm-max-homolog-pg}"
CONN="$(cat "$CONN_DIR/conn")"
case "$CONN" in *qvhyepwduhlgqwpgmpvh*) ;; *) echo "Recusado: conexão não é a homologação." >&2; exit 1 ;; esac
export PGPASSFILE="$CONN_DIR/pgpass"
psql "$CONN" -v ON_ERROR_STOP=1 -X -q -P pager=off -f "$DIR/data_nascimento_cadastro.sql"
