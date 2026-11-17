#!/usr/bin/env bash
# Teto de R$ 100 mi no valor negociado (migration 20261202120000, t_9f5f3ae2) numa ÚNICA transação revertida
# (homologação ou clone, NUNCA produção). Aplica a migration, testa, aplica o rollback, confere que voltou e
# termina em ROLLBACK: nada fica gravado.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-sales-valor-negociado-teto.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  echo "SET LOCAL session_replication_role = replica;"  # só para montar a venda de teste sem gatilhos
  echo "CREATE TEMP TABLE _alvo ON COMMIT DROP AS SELECT id FROM public.sales ORDER BY created_at LIMIT 1;"
  echo "UPDATE public.sales SET valor_negociado = 150000000 WHERE id = (SELECT id FROM _alvo);"
  echo "SET LOCAL session_replication_role = origin;"
  strip "$ROOT/supabase/migrations/20261202120000_sales_valor_negociado_teto.sql"
  cat <<'SQL'
DO $$
DECLARE _id uuid := (SELECT id FROM _alvo); _ok boolean;
BEGIN
  -- 1) NOT VALID: a migration entrou mesmo com uma venda antiga acima do teto, e a venda continua lá.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_valor_negociado_teto' AND NOT convalidated) THEN
    RAISE EXCEPTION 'FAIL 1: trava ausente ou já validada';
  END IF;
  IF (SELECT valor_negociado FROM public.sales WHERE id = _id) <> 150000000 THEN
    RAISE EXCEPTION 'FAIL 1b: venda antiga alterada';
  END IF;
  RAISE NOTICE 'PASS 1: migration entra com venda antiga acima do teto (NOT VALID) e não mexe nela';
  -- 2) Gravar acima do teto é recusado (281.600.000).
  BEGIN
    SET LOCAL session_replication_role = replica;  -- isola a trava dos gatilhos de negócio
    UPDATE public.sales SET valor_negociado = 281600000 WHERE id = _id;
    RAISE EXCEPTION 'FAIL 2: aceitou 281.600.000';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 2: recusa 281.600.000 (check_violation sales_valor_negociado_teto)';
  END;
  -- 3) Exatamente no teto e valor normal passam; NULL passa.
  SET LOCAL session_replication_role = replica;
  UPDATE public.sales SET valor_negociado = 100000000 WHERE id = _id;
  UPDATE public.sales SET valor_negociado = 380000 WHERE id = _id;
  UPDATE public.sales SET valor_negociado = NULL WHERE id = _id;
  SET LOCAL session_replication_role = origin;
  RAISE NOTICE 'PASS 3: aceita 100.000.000, 380.000 e vazio';
  -- 4) Depois de corrigida, a trava pode ser validada.
  EXECUTE 'ALTER TABLE public.sales VALIDATE CONSTRAINT sales_valor_negociado_teto';
  RAISE NOTICE 'PASS 4: VALIDATE CONSTRAINT funciona depois da correção';
END $$;
SQL
  strip "$ROOT/docs/sql/rollback/20261202120000_sales_valor_negociado_teto.rollback.sql"
  echo "DO \$\$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_valor_negociado_teto') THEN RAISE EXCEPTION 'FAIL 5: rollback não tirou a trava'; END IF; RAISE NOTICE 'PASS 5: rollback tira a trava'; END \$\$;"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -v ON_ERROR_STOP=1 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /NOTICE: /'
