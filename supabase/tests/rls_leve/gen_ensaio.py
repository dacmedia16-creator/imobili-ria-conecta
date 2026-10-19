#!/usr/bin/env python3
"""Gera captura.sql (saída completa de cada função por perfil) e medir.sql (tempos) do ensaio rls_leve.
Perfis: ids da massa SINTÉTICA da homologação local (fixture_seed.sql de perf_itens_1_2 + extra_seed.sql). Nenhum dado real."""
import os

d = os.path.dirname(os.path.abspath(__file__))
A = "00000000-0000-4000-8000-000000000001"
B = "2a000000-0000-4000-8000-0000000000b0"
USERS = [
    ("super_admin", "0a321807-c739-4b26-89e7-6e6fdef00297"),
    ("admin", "7dd997f7-2021-43ea-af9c-e758b826fcfd"),
    ("admin+corretor", "10000000-0000-4000-8000-000000000001"),
    ("financeiro", "b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed"),
    ("juridico", "d0000000-0000-4000-8000-0000000000a1"),
    ("gestor_A(lider equipe c/ co-lider)", "cab7391a-463f-4d97-b99b-ced6e4696796"),
    ("gestor_B+corretor(lider equipe-mae)", "10000000-0000-4000-8000-000000000002"),
    ("team_leader(sub-equipe)", "d0000000-0000-4000-8000-0000000000a5"),
    ("co_leader(team_leader)", "d0000000-0000-4000-8000-0000000000a4"),
    ("corretor_1", "ebffaded-075c-493f-89e2-1d3d62901dc4"),
    ("corretor_2", "b316b223-da46-4c2c-9952-25096d5ae5ff"),
    ("corretor_liderado", "10000000-0000-4000-8000-000000000003"),
    ("corretor_sub-equipe", "a742cfda-4731-4fa8-989a-374d2fdf0820"),
    ("sem_papel", "d0000000-0000-4000-8000-0000000000a2"),
    ("inativo", "d0000000-0000-4000-8000-0000000000a3"),
    ("sem_organizacao", "d0000000-0000-4000-8000-0000000000a6"),
    ("orgB_admin", "b3144521-7e3b-4f48-a1e0-29d90fd3f536"),
    ("orgB_admin+corretor(lider)", "4996f8c5-3b3d-4ea6-9f5b-671b79941a7e"),
    ("orgB_corretor", "23e65aaf-2614-463e-baec-cf562bb94244"),
    ("anonimo", None),
]
ROWS = "select count(*), coalesce(string_agg(x::text, '|' order by x::text), ''), array_agg(x.sale_id) from {f} x"
LIST = "select r::text, (select array_agg((e->>'id')::uuid) from jsonb_array_elements(r->'rows') e) from (select {f} r) q"
CALLS = [
    ("dashboard_stats", "select 1, public.dashboard_stats()::text, null::uuid[]"),
    ("vendas_comerciais_canonicas", ROWS.format(f="public.vendas_comerciais_canonicas()")),
    ("financeiro_distribuicao_vendas", ROWS.format(f="public.financeiro_distribuicao_vendas()")),
    ("comparativo_6pct_inconsistencias", ROWS.format(f="public.comparativo_comissao_6pct_inconsistencias()")),
]
LISTAS = [
    ("lista:padrao", "public.list_vendas_comerciais_paginadas()"),
    ("lista:pag2_tam5", "public.list_vendas_comerciais_paginadas(1, 5)"),
    ("lista:tam50", "public.list_vendas_comerciais_paginadas(0, 50)"),
    ("lista:status", "public.list_vendas_comerciais_paginadas(0, 50, 'ocorrencia_concluida')"),
    ("lista:statuses", "public.list_vendas_comerciais_paginadas(0, 50, null, array['contrato_assinado','ocorrencia_pendente','rascunho'])"),
    ("lista:periodo", "public.list_vendas_comerciais_paginadas(0, 50, null, null, (now() - interval '120 days')::date, now()::date)"),
    ("lista:busca_codigo", "public.list_vendas_comerciais_paginadas(0, 50, null, null, null, null, 'POC1')"),
    ("lista:busca_parte", "public.list_vendas_comerciais_paginadas(0, 50, null, null, null, null, 'Comprador')"),
    ("lista:corretores", "public.list_vendas_comerciais_paginadas(0, 50, null, null, null, null, null, array['ebffaded-075c-493f-89e2-1d3d62901dc4','a742cfda-4731-4fa8-989a-374d2fdf0820']::uuid[])"),
    ("lista:corretor_extra", "public.list_vendas_comerciais_paginadas(0, 50, null, null, null, null, null, array['10000000-0000-4000-8000-000000000003']::uuid[])"),
    ("lista:midia", "public.list_vendas_comerciais_paginadas(0, 50, null, null, null, null, null, null, 'Instagram')"),
    ("lista:sem_midia", "public.list_vendas_comerciais_paginadas(0, 50, null, null, null, null, null, null, '__sem_midia__')"),
]
# chamadores que herdam a mudança (INVOKER) ou não (DEFINER, seguem o texto antigo): têm de dar o mesmo resultado
CHAMADORES = [
    ("chamador:comparativo_6pct", ROWS.format(f="public.comparativo_comissao_6pct()")),
    ("chamador:participacoes_validas", ROWS.format(f="public.participacoes_comerciais_validas()")),
    ("chamador:resumo_desempenho", "select 1, coalesce(string_agg(x::text, '|' order by x::text), ''), null::uuid[] from public.resumo_desempenho_periodo('2026-01-01', '2026-12-31') x"),
    ("chamador:desempenho_ranking", "select 1, coalesce(string_agg(x::text, '|' order by x::text), ''), null::uuid[] from public.desempenho_ranking_periodo('2026-01-01', '2026-12-31') x"),
    ("chamador:comissoes_carteira", "select 1, coalesce(string_agg(x::text, '|' order by x::text), ''), null::uuid[] from public.comissoes_carteira_periodo('2026-01-01', '2026-12-31') x"),
    ("chamador:vendas_por_regiao", "select 1, coalesce(string_agg(x::text, '|' order by x::text), ''), null::uuid[] from public.vendas_por_regiao() x"),
    ("chamador:carreira_ranking(definer)", "select 1, coalesce(string_agg(x::text, '|' order by x::text), ''), null::uuid[] from public.carreira_ranking('2026-01-01', '2026-12-31') x"),
    ("chamador:meu_realizado(definer)", "select 1, coalesce(string_agg(x::text, '|' order by x::text), ''), null::uuid[] from public.meu_realizado('2026-01-01', '2026-12-31') x"),
]


def login(uid):
    if uid:
        return ["reset role;",
                f"select set_config('request.jwt.claims', json_build_object('sub','{uid}','role','authenticated')::text, true), "
                f"set_config('request.jwt.claim.sub','{uid}', true), set_config('mt.ctx', '', true), set_config('mt.ctx_m', '', true);",
                "set local role authenticated;"]
    return ["reset role;",
            "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true), set_config('request.jwt.claim.sub','', true), "
            "set_config('mt.ctx', '', true), set_config('mt.ctx_m', '', true);",
            "set local role anon;"]


cap = ["-- gerado por gen_ensaio.py; requer temp table saida e current_setting('rl.fase')"]
for label, uid in USERS:
    cap += login(uid)
    b = ["do $m$ declare n bigint; t text; ids uuid[]; begin"]
    for name, sql in CALLS + CHAMADORES:
        b.append(f"  begin {sql} into n, t, ids; exception when others then n := -1; t := 'ERRO ' || sqlstate || ' ' || sqlerrm; ids := null; end;"
                 f" insert into saida values (current_setting('rl.fase'), '{label}', '{uid or ''}', '{name}', n, t, ids);")
    for name, f in LISTAS:
        b.append(f"  begin {LIST.format(f=f)} into t, ids; n := coalesce(cardinality(ids), 0); exception when others then n := -1; t := 'ERRO ' || sqlstate || ' ' || sqlerrm; ids := null; end;"
                 f" insert into saida values (current_setting('rl.fase'), '{label}', '{uid or ''}', '{name}', n, t, ids);")
    b.append("end $m$;")
    cap.append("\n".join(b))
cap.append("reset role;")
open(os.path.join(d, "captura.sql"), "w").write("\n".join(cap) + "\n")

MED = [("dashboard_stats", "select public.dashboard_stats()"),
       ("vendas_comerciais_canonicas", "select count(*) from public.vendas_comerciais_canonicas()"),
       ("financeiro_distribuicao_vendas", "select count(*) from public.financeiro_distribuicao_vendas()"),
       ("comparativo_6pct_inconsistencias", "select count(*) from public.comparativo_comissao_6pct_inconsistencias()"),
       ("list_vendas_comerciais_paginadas", "select public.list_vendas_comerciais_paginadas(0, 10)")]
PERFIS_MED = ["super_admin", "financeiro", "gestor_A(lider equipe c/ co-lider)", "co_leader(team_leader)", "juridico", "corretor_1"]
med = ["-- gerado por gen_ensaio.py; requer temp table tempos e current_setting('rl.fase')"]
for label, uid in USERS:
    if label not in PERFIS_MED:
        continue
    med += login(uid)
    b = ["do $t$ declare t0 timestamptz; ms numeric; melhor numeric; i int; begin"]
    for name, sql in MED:
        b.append(f"  melhor := null; for i in 1..3 loop t0 := clock_timestamp(); begin execute '{sql.replace(chr(39), chr(39)*2)}'; "
                 f"exception when others then null; end; ms := extract(epoch from clock_timestamp() - t0) * 1000; "
                 f"melhor := least(coalesce(melhor, ms), ms); end loop; "
                 f"insert into tempos values (current_setting('rl.fase'), '{label}', '{name}', round(melhor, 1));")
    b.append("end $t$;")
    med.append("\n".join(b))
med.append("reset role;")
open(os.path.join(d, "medir.sql"), "w").write("\n".join(med) + "\n")
print("ok", len(USERS), "perfis,", len(CALLS) + len(CHAMADORES) + len(LISTAS), "chamadas")
