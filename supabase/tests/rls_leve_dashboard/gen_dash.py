#!/usr/bin/env python3
"""Ensaio SÓ do dashboard_stats em produção, numa transação que termina em RAISE (tudo desfeito).
Uso: gen_dash.py dry|pos saida.sql
  dry: BEGIN + migration 20261019160000 + comparação leve x por_rls + tempo das outras telas + hash das outras funções
  pos: depois de aplicada (só leitura): mesma comparação, sem migration
"""
import sys
modo, out = sys.argv[1], sys.argv[2]
MIG = "/data/hermes-workspaces/max-tecnologia/wt-rls-dash/supabase/migrations/20261019153000_rls_leve_dashboard_stats.sql"
usuarios = """
  select user_id, role from (
    select r.user_id, r.role::text as role,
           row_number() over (partition by r.role order by md5(r.user_id::text)) as rn
    from public.user_roles r join public.profiles p on p.id = r.user_id
    where p.organization_id is not null
  ) x where rn <= 3
  union
  select '{TESTE}'::uuid, 'corretor_teste'
"""
outras = [
    ("canonicas", "select coalesce(string_agg(x::text,'|' order by x::text),'') from public.vendas_comerciais_canonicas() x"),
    ("financeiro", "select coalesce(string_agg(x::text,'|' order by x::text),'') from public.financeiro_distribuicao_vendas() x"),
    ("inconsist", "select coalesce(string_agg(x::text,'|' order by x::text),'') from public.comparativo_comissao_6pct_inconsistencias() x"),
    ("lista", "select public.list_vendas_comerciais_paginadas(0, 50)::text"),
    ("somas", "select coalesce(sum(vgv_proprio),0)::text||'/'||coalesce(sum(comissao_propria),0)::text||'/'||count(*) from public.vendas_comerciais_canonicas()"),
]
def q(s): return s.replace("'", "''")
REP = 3
nova = "select public.dashboard_stats()::text"
velha = "select public.dashboard_stats_por_rls()::text" if modo in ("dry", "pos") else nova
corpo = [f"""
      ms_v := null; ms_n := null;
      for i in 1..{REP} loop
        t0 := clock_timestamp();
        begin execute '{q(nova)}' into n; exception when others then n := 'ERRO '||sqlstate||' '||sqlerrm; end;
        ms_n := least(coalesce(ms_n, 1e9), extract(epoch from clock_timestamp()-t0)*1000);
        t0 := clock_timestamp();
        begin execute '{q(velha)}' into v; exception when others then v := 'ERRO '||sqlstate||' '||sqlerrm; end;
        ms_v := least(coalesce(ms_v, 1e9), extract(epoch from clock_timestamp()-t0)*1000);
      end loop;
      insert into _cmp values (u.role, u.user_id, 'dashboard', md5(v), md5(n), v is not distinct from n, round(ms_v,1), round(ms_n,1), left(case when v like 'ERRO%' then v else '' end,120), left(case when n like 'ERRO%' then n else '' end,120));"""]
for nome, s in outras:
    corpo.append(f"""
      ms_n := null;
      for i in 1..{REP} loop
        t0 := clock_timestamp();
        begin execute '{q(s)}' into n; exception when others then n := 'ERRO '||sqlstate||' '||sqlerrm; end;
        ms_n := least(coalesce(ms_n, 1e9), extract(epoch from clock_timestamp()-t0)*1000);
      end loop;
      insert into _cmp values (u.role, u.user_id, '{nome}', null, case when '{nome}'='somas' then n else md5(n) end, null, null, round(ms_n,1), '', left(case when n like 'ERRO%' then n else '' end,120));""")
teste = None
for line in open("/root/.config/max/adm-max-teste.env"):
    if line.startswith("ADM_TESTE_USER_ID="):
        teste = line.split("=", 1)[1].strip().strip('"')
sql = ["begin;"]
if modo == "dry":
    sql.append(open(MIG).read())
sql.append("create temp table _cmp(role text, user_id uuid, func text, md5_velha text, md5_nova text, igual boolean, ms_velha numeric, ms_nova numeric, erro_v text, erro_n text);")
sql.append("grant all on _cmp to authenticated;")
sql.append(f"""
do $c$
declare u record; v text; n text; i int; t0 timestamptz; ms_v numeric; ms_n numeric;
begin
  for u in {usuarios.replace('{TESTE}', teste)} loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u.user_id::text, true);
    perform set_config('mt.ctx', '', true); perform set_config('mt.ctx_m', '', true);
    execute 'set local role authenticated';
    {''.join(corpo)}
    execute 'reset role';
  end loop;
end $c$;""")
sql.append("""
do $r$ begin
  raise exception 'RESULTADO_JSON:%', json_build_object(
    'rows', (select json_agg(c order by role, user_id, func) from _cmp c),
    'outras_md5', (select json_object_agg(p.proname, md5(p.prosrc)) from pg_proc p where p.pronamespace='public'::regnamespace
                   and p.proname in ('vendas_comerciais_canonicas','list_vendas_comerciais_paginadas','financeiro_distribuicao_vendas','comparativo_comissao_6pct_inconsistencias','vendas_comerciais_validas','metricas_venda_sem_parceria','sale_corretores','sale_responsaveis','is_sale_corretor','is_sale_responsavel')),
    'leve_existe', (select count(*) from pg_proc where proname like '%\\_leve%' and pronamespace='public'::regnamespace));
end $r$;""")
open(out, "w").write("\n".join(sql))
print("ok", out)
