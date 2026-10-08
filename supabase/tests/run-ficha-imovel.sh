#!/usr/bin/env bash
# Ficha do imóvel (migration 20261008230000) numa ÚNICA transação revertida (homologação ou clone, nunca
# produção): pré-requisitos que faltarem no alvo (Virou venda e valor no pino, só na transação) ->
# fingerprint A -> up -> suíte -> rollback -> fingerprint == A -> ROLLBACK.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-ficha-imovel.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
M="$ROOT/supabase/migrations"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.proowner::regrole::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||attname||':'||format_type(atttypid, atttypmod) FROM pg_attribute
    WHERE attrelid='public.sales'::regclass AND attnum>0 AND NOT attisdropped
  UNION ALL SELECT 'con:'||conname FROM pg_constraint WHERE conrelid='public.sales'::regclass
  UNION ALL SELECT 'tg:'||tgname FROM pg_trigger WHERE tgrelid='public.sales'::regclass) s),''));"
{
  echo "BEGIN;"
  echo "ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS archived_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS archived_by uuid, ADD COLUMN IF NOT EXISTS discarded_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS discarded_by uuid, ADD COLUMN IF NOT EXISTS signed_on date,"
  echo "  ADD COLUMN IF NOT EXISTS geo_lat double precision, ADD COLUMN IF NOT EXISTS geo_lon double precision,"
  echo "  ADD COLUMN IF NOT EXISTS geo_key text;"
  echo "SELECT NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'exclusive_manager_pending_read') AS need_gestor \\gset"
  echo "\\if :need_gestor"; strip "$M/20261006210000_exclusividade_contrato_pelo_gestor.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.mapa_captacoes()') IS NULL AS need_mapa \\gset"
  echo "\\if :need_mapa"; strip "$M/20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.exclusive_create_manual(uuid)') IS NULL AS need_manual \\gset"
  echo "\\if :need_manual"; strip "$M/20261008160000_exclusividade_cadastro_manual.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.mapa_captacoes_v2()') IS NULL AS need_v2 \\gset"
  echo "\\if :need_v2"; strip "$M/20261008170000_mapa_captacoes_preco_contato.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.exclusive_virar_venda(uuid)') IS NULL AS need_virar \\gset"
  echo "\\if :need_virar"; strip "$M/20261008190000_captacao_virou_venda.sql"; echo "\\endif"
  # valor no pino (idempotente: CREATE OR REPLACE)
  strip "$M/20261008200000_vendas_regiao_valor_no_pino.sql"
  echo "\\echo [pre ok]"
  echo "$FP"
  strip "$M/20261008230000_ficha_imovel.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/ficha_imovel.sql"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/20261008230000_ficha_imovel.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
