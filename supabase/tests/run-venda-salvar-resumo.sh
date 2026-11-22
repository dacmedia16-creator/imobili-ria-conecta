#!/usr/bin/env bash
# RPC venda_salvar_resumo (migration 20261222120000, t_8ab6c348) numa ÚNICA transação revertida:
# fp antes -> migration -> suíte -> rollback -> fp igual -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="bash <hq.sh> -" bash supabase/tests/run-venda-salvar-resumo.sh   (homologação ou banco descartável; nunca produção)
# Controle negativo (teste do erro): MODO=antigo repete o salvamento antigo do navegador (cada passo é uma
# requisição separada) e TEM de dar FALHA nas checagens "nada gravado". Sai com código 1 se houver FALHA.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261222120000_venda_salvar_resumo.sql"
RB="$ROOT/supabase/rollback/20261222120000_venda_salvar_resumo.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'fp: ' || md5(coalesce((SELECT string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text,''), ',' ORDER BY 1)
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'venda_salvar_resumo'), 'nenhuma'));"

# Jeito ANTIGO (o que o navegador fazia): UPDATE sales; DELETE de cada removido; INSERT/UPDATE de cada extra.
# Cada passo em bloco próprio = requisição separada: o que deu certo antes da falha FICA gravado.
ANTIGO=$(cat <<'SQL'
CREATE FUNCTION pg_temp.salvar(_s uuid, _p jsonb, _e jsonb, _rm uuid[]) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE _cols text; _x jsonb; _id uuid; _r public.sale_commission_extras;
BEGIN
  IF _p <> '{}'::jsonb THEN
    SELECT string_agg(format('%I = r.%I', k, k), ', ') INTO _cols FROM jsonb_object_keys(_p) k;
    BEGIN
      EXECUTE format('UPDATE public.sales s SET %s FROM jsonb_populate_record(NULL::public.sales, $1) r WHERE s.id = $2', _cols) USING _p, _s;
    EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END;
  END IF;
  FOR _id IN SELECT unnest(_rm) LOOP
    BEGIN DELETE FROM public.sale_commission_extras WHERE id = _id;
    EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END;
  END LOOP;
  FOR _x IN SELECT v FROM jsonb_array_elements(_e) WITH ORDINALITY t(v, i) ORDER BY i LOOP
    _r := jsonb_populate_record(NULL::public.sale_commission_extras, _x);
    BEGIN
      IF _x ? 'id' THEN
        UPDATE public.sale_commission_extras SET nome = _r.nome, papel = _r.papel, valor = _r.valor WHERE id = _r.id;
      ELSE
        INSERT INTO public.sale_commission_extras (sale_id, nome, papel, valor, origem)
          VALUES (_s, _r.nome, _r.papel, _r.valor, coalesce(_r.origem, 'imobiliaria'));
      END IF;
    EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END;
  END LOOP;
  RETURN 'OK';
END $f$;
SQL
)
NOVO=$(cat <<'SQL'
CREATE FUNCTION pg_temp.salvar(_s uuid, _p jsonb, _e jsonb, _rm uuid[]) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN PERFORM public.venda_salvar_resumo(_s, _p, _e, _rm); RETURN 'OK';
EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $f$;
SQL
)
OUT="$(
{
  echo "BEGIN;"
  echo "SELECT (to_regprocedure('public.eh_so_locacao(uuid)') IS NULL) AS need_loc \\gset"
  echo "\\if :need_loc"
  echo "CREATE FUNCTION public.eh_so_locacao(uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';"
  echo "GRANT EXECUTE ON FUNCTION public.eh_so_locacao(uuid) TO authenticated;"
  echo "\\endif"
  echo "$FP"
  if [[ "${MODO:-}" == "antigo" ]]; then
    echo "\\echo [CONTROLE NEGATIVO: salvamento antigo, passo a passo]"
    echo "\\set modo_normal false"
    echo "$ANTIGO"
  else
    strip "$MIG"
    echo "\\echo [migration ok]"
    echo "\\set modo_normal true"
    echo "$NOVO"
  fi
  echo "SAVEPOINT s1;"
  echo "\\echo [suite venda_salvar_resumo]"
  strip "$HERE/venda_salvar_resumo.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  if [[ "${MODO:-}" != "antigo" ]]; then
    strip "$RB"
    echo "\\echo [rollback ok: fp abaixo tem de ser igual ao primeiro]"
    echo "$FP"
  fi
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|fp)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
)"
echo "$OUT"
if echo "$OUT" | grep -qE "^FALHA|ERROR|psql:"; then exit 1; fi
echo "$OUT" | grep -q "^TOTAL=" || exit 1
