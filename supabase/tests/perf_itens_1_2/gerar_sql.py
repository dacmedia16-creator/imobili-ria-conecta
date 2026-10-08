#!/usr/bin/env python3
"""Gera, a partir das definições ATUAIS de produção (lidas em modo somente leitura), os trechos
explícitos das migrations 20261008100100/100200 e o script de desfazer.

Uso:
  python3 gerar_sql.py <prod_policies.json> <prod_functions.json>

Os JSONs vêm da Management API read-only (consultas em leitura_producao.sql). Nada é escrito no banco.
Saídas (sobrescritas): os blocos marcados entre "-- >>> GERADO" e "-- <<< GERADO" nas migrations 01/02
e o arquivo supabase/rollback/20261008100000_perf_itens_1_2.sql.
Rodar de novo no dia da publicação: se o diff do git não for vazio, produção mudou -> PARAR.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MIG = ROOT / 'supabase' / 'migrations'
M01 = MIG / '20261008100100_perf_01_permissoes_lista_vendas.sql'
M02 = MIG / '20261008100200_perf_02_venda_distribuicao.sql'
RB = ROOT / 'supabase' / 'rollback' / '20261008100000_perf_itens_1_2.sql'

OLD_FNS = ('can_view_sale', 'can_read_principal_sale_as_co_leader', 'can_manage_sale_as_co_leader',
           'can_read_sale_juridico_certidao', 'can_edit_sale_as_co_leader')
LISTA = {
    'can_read_principal_sale_as_co_leader': 'vendas_coleader_leitura_ids',
    'can_manage_sale_as_co_leader': 'vendas_coleader_gestao_ids',
    'can_edit_sale_as_co_leader': 'vendas_coleader_edicao_ids',
    'can_read_sale_juridico_certidao': 'vendas_juridico_certidao_ids',
}
ARGS = ('sale_id', 'o.sale_id', 'id')


def novo_using(tabela, politica, qual):
    if tabela == 'sales' and politica == 'sales_select':
        # a policy repete por extenso a regra de can_view_sale (por linha); vira a lista
        return '(id IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))'
    q = qual
    for a in ARGS:
        q = q.replace(f'can_view_sale(( SELECT auth.uid() AS uid), {a})',
                      f'({a} IN ( SELECT public.vendas_visiveis_ids() AS vendas_visiveis_ids))')
        for velho, lista in LISTA.items():
            q = q.replace(f'{velho}({a})', f'({a} IN ( SELECT public.{lista}() AS {lista}))')
    sobra = [f for f in OLD_FNS if re.search(rf'\b{f}\(', q)]
    if sobra:
        raise SystemExit(f'padrão não coberto em {tabela}.{politica}: {sobra}\n{qual}')
    return q


def dq(txt, tag='q'):
    t = f'${tag}$'
    assert t not in txt
    return f'{t}{txt}{t}'


def main(pol_path, fn_path):
    pols = json.load(open(pol_path))
    fns = {f['sig']: f for f in json.load(open(fn_path))}
    alvo = []
    for p in pols:
        if p['cmd'] not in ('SELECT', 'ALL'):
            continue  # INSERT/UPDATE/DELETE (gravação) ficam fora do escopo
        qual = p['qual']
        if not qual:
            continue
        if not (re.search(r'\b(' + '|'.join(OLD_FNS) + r')\(', qual) or
                (p['tablename'] == 'sales' and p['policyname'] == 'sales_select')):
            continue
        if p['cmd'] == 'ALL' and not p['with_check']:
            # sem WITH CHECK o Postgres usa o USING também para gravar: mudar o USING mudaria a gravação
            raise SystemExit(f"policy ALL sem WITH CHECK: {p['tablename']}.{p['policyname']} — fora do escopo")
        alvo.append((p['tablename'], p['policyname'], p['cmd'], qual, novo_using(p['tablename'], p['policyname'], qual)))
    alvo.sort()
    n_sel = sum(1 for a in alvo if a[2] == 'SELECT')
    n_all = sum(1 for a in alvo if a[2] == 'ALL')

    # ---------- migration 01: lista explícita (tabela, policy, USING original, USING novo)
    linhas = []
    for t, pn, cmd, old, new in alvo:
        linhas.append(f"    ({dq(t)}, {dq(pn)}, {dq(cmd)},\n     {dq(old)},\n     {dq(new)})")
    bloco01 = (f"-- {len(alvo)} policies ({n_sel} SELECT + {n_all} ALL, só o USING). Gerado por "
               f"supabase/tests/perf_itens_1_2/gerar_sql.py\n"
               "insert into pg_temp.perf_alvo (tabela, politica, cmd, using_original, using_novo) values\n"
               + ',\n'.join(linhas) + ';\n')

    # ---------- migration 02: dashboard_stats / financeiro lendo o resultado gravado
    ds = fns['dashboard_stats()']['def']
    ds_new = ds.replace(
        'public.calcular_distribuicao_venda(s.*) as resultado\n    from occurrences o\n    join sales s on s.id = o.sale_id',
        'vd.resultado as resultado\n    from occurrences o\n    join sales s on s.id = o.sale_id\n    join venda_distribuicao vd on vd.sale_id = s.id')
    ds_new = ds_new.replace(
        'cross join lateral (select public.calcular_distribuicao_venda(s.*) as r) d',
        'join lateral (select vd.resultado as r from venda_distribuicao vd where vd.sale_id = s.id) d on true')
    assert 'calcular_distribuicao_venda' not in ds_new, 'dashboard_stats: troca incompleta'
    fin = fns['financeiro_distribuicao_vendas()']['def']
    fin_new = fin.replace(
        'cross join lateral (\n    select public.calcular_distribuicao_venda(s.*) as resultado\n  ) d',
        'join lateral (\n    select vd.resultado from venda_distribuicao vd where vd.sale_id = s.id\n  ) d on true')
    assert 'calcular_distribuicao_venda' not in fin_new, 'financeiro: troca incompleta'

    def corpo(defn):
        m = re.search(r'AS \$function\$(.*)\$function\$\s*$', defn, re.S)
        if not m:
            raise SystemExit('definição de função fora do formato esperado')
        return m.group(1)

    bloco02 = []
    for sig, old, new in (('public.dashboard_stats()', ds, ds_new),
                          ('public.financeiro_distribuicao_vendas()', fin, fin_new)):
        bloco02.append(
            f"-- {sig}: texto de produção com UMA troca (cálculo ao vivo -> resultado gravado)\n"
            f"do $g$ begin\n"
            f"  if md5((select prosrc from pg_proc where oid = '{sig}'::regprocedure)) = '{hashlib.md5(corpo(new).encode()).hexdigest()}' then\n"
            f"    raise notice '{sig}: já lê o resultado gravado';\n"
            f"  elsif md5((select prosrc from pg_proc where oid = '{sig}'::regprocedure)) <> '{hashlib.md5(corpo(old).encode()).hexdigest()}' then\n"
            f"    raise exception '{sig} diverge da versão conferida em produção; gere o SQL de novo';\n"
            f"  end if;\nend $g$;\n"
            f"{new.rstrip()};\n")
    bloco02 = '\n'.join(bloco02)

    for path, bloco in ((M01, bloco01), (M02, bloco02)):
        src = path.read_text()
        src = re.sub(r'(-- >>> GERADO\n).*?(-- <<< GERADO)', lambda m: m.group(1) + bloco + m.group(2), src, flags=re.S)
        path.write_text(src)

    # ---------- desfazer
    rb = ["-- DESFAZER itens 1 e 2 (20261008100000/100100/100200). Gerado por supabase/tests/perf_itens_1_2/gerar_sql.py",
          "-- a partir das definições de PRODUÇÃO lidas em modo somente leitura. Restaura policies (USING) e funções",
          "-- originais e remove o que foi criado. NENHUM dado de venda é alterado: a tabela venda_distribuicao só",
          "-- guarda resultado de cálculo (pode ser apagada e recriada a qualquer momento).",
          "-- Depois de rodar, remover 20261008100000/100100/100200 de supabase_migrations.schema_migrations.",
          "BEGIN;",
          "SET LOCAL lock_timeout = '5s';",
          "SET LOCAL search_path = public, extensions;",
          "-- 1) policies: USING original de produção"]
    for t, pn, cmd, old, new in alvo:
        rb.append(f'ALTER POLICY "{pn}" ON public."{t}" USING ({old});')
    rb.append("-- 2) relatórios voltam a calcular ao vivo (texto original de produção)")
    rb.append(ds.rstrip() + ';')
    rb.append(fin.rstrip() + ';')
    rb += [
        "-- 3) gatilhos, funções e tabela do resultado gravado",
        "DROP TRIGGER IF EXISTS zz_venda_distribuicao ON public.sales;",
        "DROP TRIGGER IF EXISTS zz_venda_distribuicao ON public.sale_commission_extras;",
        "DROP TRIGGER IF EXISTS zz_venda_distribuicao ON public.occurrences;",
        "DROP TRIGGER IF EXISTS zz_venda_distribuicao ON public.occurrence_commissions;",
        "DROP FUNCTION IF EXISTS public.trg_venda_distribuicao();",
        "DROP FUNCTION IF EXISTS public.venda_distribuicao_recalcular_todas();",
        "DROP FUNCTION IF EXISTS public.venda_distribuicao_conferir();",
        "DROP FUNCTION IF EXISTS public.venda_distribuicao_recalcular(uuid);",
        "DROP TABLE IF EXISTS public.venda_distribuicao;",
        "-- 4) funções de lista (nenhuma policy as usa mais)",
        "DROP FUNCTION IF EXISTS public.vendas_visiveis_ids();",
        "DROP FUNCTION IF EXISTS public.vendas_coleader_leitura_ids();",
        "DROP FUNCTION IF EXISTS public.vendas_coleader_gestao_ids();",
        "DROP FUNCTION IF EXISTS public.vendas_coleader_edicao_ids();",
        "DROP FUNCTION IF EXISTS public.vendas_juridico_certidao_ids();",
        "-- 5) conferência: nenhuma policy pode continuar citando as listas",
        "DO $c$ BEGIN",
        "  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND (coalesce(qual,'')||coalesce(with_check,'')) ~ 'vendas_(visiveis|coleader_[a-z]+|juridico_certidao)_ids') THEN",
        "    RAISE EXCEPTION 'desfazer incompleto: policy ainda usa lista nova';",
        "  END IF;",
        "END $c$;",
        "-- A cópia de segurança em max_backup.definicoes (etapa 0) é mantida de propósito.",
        "COMMIT;", ""]
    RB.write_text('\n'.join(rb))
    print(f'policies: {len(alvo)} (SELECT {n_sel}, ALL {n_all}); funções trocadas: 2; desfazer: {RB.relative_to(ROOT)}')
    for t, pn, cmd, old, new in alvo:
        print(f'  {cmd:6} {t}.{pn}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
