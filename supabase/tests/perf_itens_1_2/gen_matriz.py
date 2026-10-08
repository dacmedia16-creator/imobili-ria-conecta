#!/usr/bin/env python3
"""Gera os testes de permissão dos itens 1 e 2 (rodar de novo só se mudar a lista de perfis/tabelas):

  snapshot.sql     — para cada um dos 16 perfis, fotografa o que ele enxerga: linhas por tabela + "impressão
                     digital" (hash) dos ids, e o resultado exato de cada relatório. Grava na temp table `matriz`
                     com a fase atual (current_setting('perf.fase')). Rodado antes, depois, após desfazer e após
                     reaplicar; a comparação está em ensaio.sh.
  equivalencia.sql — prova direta: para cada perfil logado, lista nova (vendas_visiveis_ids) = vendas em que
                     can_view_sale (versão de produção) dá verdadeiro. Grava na temp table `equiv`.

Perfis: ids da massa sintética do homolog (fixture_seed.sql). Nenhum dado real.
"""
import os

d = os.path.dirname(os.path.abspath(__file__))
USERS = [
    ('admin+corretor', '10000000-0000-4000-8000-000000000001'),
    ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
    ('super_admin', '0a321807-c739-4b26-89e7-6e6fdef00297'),
    ('financeiro', 'b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed'),
    ('gestor_A', 'cab7391a-463f-4d97-b99b-ced6e4696796'),
    ('gestor_B+corretor', '10000000-0000-4000-8000-000000000002'),
    ('co_lider', 'd0000000-0000-4000-8000-0000000000a4'),
    ('corretor_1', 'ebffaded-075c-493f-89e2-1d3d62901dc4'),
    ('corretor_2', 'b316b223-da46-4c2c-9952-25096d5ae5ff'),
    ('corretor_liderado', '10000000-0000-4000-8000-000000000003'),
    ('juridico', 'd0000000-0000-4000-8000-0000000000a1'),
    ('sem_papel', 'd0000000-0000-4000-8000-0000000000a2'),
    ('inativo', 'd0000000-0000-4000-8000-0000000000a3'),
    ('outra_imob_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'),
    ('outra_imob_corretor', '23e65aaf-2614-463e-baec-cf562bb94244'),
    ('anonimo_sem_login', None),
]
TABLES = [('sales', 'id'), ('sale_commission_extras', 'id'), ('occurrences', 'id'), ('occurrence_commissions', 'id'),
          ('occurrence_partners', 'id'), ('sale_status_history', 'id'), ('sale_parties', 'id'), ('sale_payment', 'id'),
          ('sale_documents', 'id'), ('sale_comments', 'id'), ('activity_logs', 'id'), ('sale_bank_accounts', 'id'),
          ('sale_comment_recipients', 'id'), ('document_extractions', 'id'), ('sale_geo', 'sale_id')]
RPCS = [
    ('dashboard_stats', "select coalesce(md5(public.dashboard_stats()::text),'null') into h; n := 1;"),
    ('financeiro_distribuicao_vendas', "select count(*), md5(coalesce(string_agg(x::text, '|' order by x.sale_id),'')) into n, h from public.financeiro_distribuicao_vendas() x;"),
    ('vendas_comerciais_canonicas', "select count(*), md5(coalesce(string_agg(x::text, '|' order by x.sale_id),'')) into n, h from public.vendas_comerciais_canonicas() x;"),
    ('comparativo_comissao_6pct', "select count(*), md5(coalesce(string_agg(x::text, '|' order by x.sale_id),'')) into n, h from public.comparativo_comissao_6pct() x;"),
    ('comparativo_6pct_inconsistencias', "select count(*), md5(coalesce(string_agg(x::text, '|' order by x.sale_id),'')) into n, h from public.comparativo_comissao_6pct_inconsistencias() x;"),
    # teste negativo multiempresa: vendas de OUTRA imobiliária visíveis (tem de ser 0 sempre)
    ('outra_imobiliaria_vistas', "select count(*), '' into n, h from public.sales where organization_id is distinct from public.current_org_id();"),
]
# Tabela nova (só existe depois): cada perfil tem de ver nela exatamente as vendas que vê em sales.
VD_CHECK = ("  if to_regclass('public.venda_distribuicao') is not null then"
            " begin execute 'select count(*), md5(coalesce(string_agg(sale_id::text, '','' order by sale_id),'''')) from public.venda_distribuicao' into n, h;"
            " exception when others then n := -1; h := 'ERRO ' || sqlstate; end;"
            " insert into matriz values (current_setting('perf.fase'), '{label}', 'vd:venda_distribuicao', n, h); end if;")


def login(uid):
    if uid:
        return ["reset role;",
                f"select set_config('request.jwt.claims', json_build_object('sub','{uid}','role','authenticated')::text, true), set_config('request.jwt.claim.sub','{uid}', true);",
                "set local role authenticated;"]
    return ["reset role;",
            "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true), set_config('request.jwt.claim.sub','', true);",
            "set local role anon;"]


out = ["-- gerado por gen_matriz.py; requer temp table matriz e current_setting('perf.fase')",
       "grant all on matriz to authenticated, anon;"]
for label, uid in USERS:
    out += login(uid)
    body = ["do $m$ declare n bigint; h text; begin"]
    for t, k in TABLES:
        body.append(f"  begin select count(*), md5(coalesce(string_agg({k}::text, ',' order by {k}),'')) into n, h from public.{t};"
                    f" exception when others then n := -1; h := 'ERRO ' || sqlstate; end;"
                    f" insert into matriz values (current_setting('perf.fase'), '{label}', 'tab:{t}', n, h);")
    for name, sql in RPCS:
        body.append(f"  begin {sql} exception when others then n := -1; h := 'ERRO ' || sqlstate; end;"
                    f" insert into matriz values (current_setting('perf.fase'), '{label}', 'rpc:{name}', n, h);")
    body.append(VD_CHECK.replace('{label}', label))
    body.append("end $m$;")
    out.append("\n".join(body))
out.append("reset role;")
open(os.path.join(d, 'snapshot.sql'), 'w').write("\n".join(out) + "\n")

eq = ["-- gerado por gen_matriz.py; requer temp table equiv",
      "grant all on equiv to authenticated;"]
for label, uid in USERS:
    if not uid:
        continue
    eq += login(uid)
    eq.append(f"""insert into equiv
with antigo as (select s.id from public.sales s where public.can_view_sale('{uid}'::uuid, s.id)),
     novo as (select id from public.vendas_visiveis_ids() id)
select current_setting('perf.fase'), '{label}', (select count(*) from antigo where id not in (select id from novo)),
       (select count(*) from novo where id not in (select id from antigo)), (select count(*) from antigo);""")
eq.append("reset role;")
open(os.path.join(d, 'equivalencia.sql'), 'w').write("\n".join(eq) + "\n")
print('ok', len(USERS), 'perfis,', len(TABLES), 'tabelas,', len(RPCS), 'relatórios')
