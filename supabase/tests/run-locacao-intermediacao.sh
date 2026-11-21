#!/usr/bin/env bash
# Parte 2/3 do "Sem administração" (migration 20261215130000: modelos "só intermediação" + recebível de intermediação)
# numa ÚNICA transação revertida (homologação ou clone, NUNCA produção). Aplica as bases que faltarem e a 20261215120000,
# tira a impressão digital, aplica a 20261215130000, confere modelos e recebível, desfaz e confere que voltou igual.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-locacao-intermediacao.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
case "$PGCONN" in *xvvymgurpchhlmbpjbgc*) echo "PRODUCAO RECUSADA"; exit 1;; esac
V=20261215130000
MIG="$ROOT/supabase/migrations/${V}_locacao_intermediacao_financeiro.sql"
RB="$ROOT/supabase/rollback/${V}_locacao_intermediacao_financeiro.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid)) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relrowsecurity::text FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'mod:'||chave||':'||md5(paragrafos::text) FROM public.locacao_modelos) s),''));"
BASES=(
  "fn:public.so_locacao_ativo(uuid)|20261122120100_papel_locacao"
  "public.locacao_pre_links|20261124120000_locacao_cliente_preenche 20261124130000_locacao_pre_aprovacao"
  "public.locacao_config_sf_backup|20261129120000_locacao_seguro_fianca_sem_docs"
  "public.locacao_minutas|20261130120000_locacao_minuta_anexada"
  "public.locacao_modelos|20261201120000_locacao_modelos_contrato"
  "public.locacao_lancamentos|20261201150000_locacao_reuniao_16_11"
  "public.locacao_parceiro_pagamento|20261214140000_locacao_parceiro_pagamento"
)
{
  echo "BEGIN;"
  for b in "${BASES[@]}"; do
    rel="${b%%|*}"; migs="${b#*|}"
    case "$rel" in fn:*) q="SELECT to_regprocedure('${rel#fn:}') IS NOT NULL";; *) q="SELECT to_regclass('$rel') IS NOT NULL";; esac
    tem=$(psql "$PGCONN" -X -At -c "$q")
    if [ "$tem" != "t" ]; then for m in $migs; do strip "$ROOT/supabase/migrations/$m.sql"; echo "\\echo [base $m]"; done; fi
  done
  strip "$ROOT/supabase/migrations/20261215120000_locacao_sem_administracao.sql"
  echo "\\echo [base 20261215120000]"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  cat <<'EOF'
SELECT CASE WHEN count(*) = 8 THEN 'ok   8 modelos só intermediação' ELSE 'FALHA modelos=' || count(*) END
  FROM public.locacao_modelos WHERE organization_id IS NULL AND chave LIKE '%\_intermediacao';
SELECT CASE WHEN count(*) = 8 THEN 'ok   cláusula nova de pagamento direto ao LOCADOR nos 8' ELSE 'FALHA pag_locador=' || count(*) END
  FROM public.locacao_modelos m, jsonb_array_elements(m.paragrafos) p
 WHERE m.organization_id IS NULL AND m.chave LIKE '%\_intermediacao' AND p->>'id' = 'pag_locador'
   AND p->>'t' LIKE '%diretamente ao LOCADOR, na forma e na conta indicadas por escrito pelo LOCADOR.';
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.locacao_modelos m, jsonb_array_elements(m.paragrafos) p
   WHERE m.organization_id IS NULL AND m.chave LIKE '%\_intermediacao' AND NOT coalesce((p->>'trava')::boolean, false)
     AND p->>'t' ~* 'ADMINISTRADORA|boleto|repasse|imobili')
  THEN 'ok   nenhum parágrafo editável cita administradora/boleto/repasse/imobiliária' ELSE 'FALHA menção sobrou' END;
SELECT CASE WHEN (SELECT p->>'t' FROM public.locacao_modelos m, jsonb_array_elements(m.paragrafos) p
   WHERE m.chave = 'fiador_intermediacao' AND m.organization_id IS NULL AND p->>'id' = 'p008') LIKE '%devolução das chaves ao LOCADOR, observados%'
  AND (SELECT p->>'t' FROM public.locacao_modelos m, jsonb_array_elements(m.paragrafos) p
   WHERE m.chave = 'fiador_intermediacao' AND m.organization_id IS NULL AND p->>'id' = 'p010') LIKE '%[FIADOR_MATRICULA]%comunicar por escrito ao LOCADOR%'
  THEN 'ok   fiador p008 e p010 de volta (LOCADOR no lugar da ADMINISTRADORA)' ELSE 'FALHA fiador p008/p010' END;
SAVEPOINT rec;
INSERT INTO public.locacoes (id, organization_id, corretor_id, etapa, candidato, endereco, garantia, aluguel, condominio, iptu,
  taxa_adm, sem_administracao)
VALUES ('7c000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'ebffaded-075c-493f-89e2-1d3d62901dc4',
  'pos_assinatura', '{"nome":"Sem Adm Fictícia"}', 'Rua Fictícia, 2', 'caucao', 2000, 0, 0, 0, true);
UPDATE public.locacoes SET etapa = 'chaves', chave_em = DATE '2027-01-05' WHERE id = '7c000000-0000-4000-8000-000000000002';
SELECT public.locacao_fin_criar_contrato(l) FROM public.locacoes l WHERE id = '7c000000-0000-4000-8000-000000000002';
SELECT CASE WHEN (SELECT count(*) FROM public.locacao_intermediacoes WHERE locacao_id = '7c000000-0000-4000-8000-000000000002') = 1
  AND (SELECT valor FROM public.locacao_intermediacoes WHERE locacao_id = '7c000000-0000-4000-8000-000000000002') = 2000
  AND NOT EXISTS (SELECT 1 FROM public.locacao_contratos WHERE locacao_id = '7c000000-0000-4000-8000-000000000002')
  THEN 'ok   chave: 1 recebível de intermediação de 1 aluguel, sem contrato, chamada repetida não duplica'
  ELSE 'FALHA recebível de intermediação' END;
ROLLBACK TO SAVEPOINT rec;
EOF
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[(base|migration|rollback)|^(ok|FALHA|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:|WARNING"
