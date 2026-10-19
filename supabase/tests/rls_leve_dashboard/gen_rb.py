#!/usr/bin/env python3
"""Teste do rollback em produção, transação desfeita: migration -> rollback -> confere texto/ACL/dono. gen_rb.py saida.sql"""
import re, sys
W = "/data/hermes-workspaces/max-tecnologia/wt-rls-dash/supabase"
V = "20261019153000_rls_leve_dashboard_stats"
mig = open(f"{W}/migrations/{V}.sql").read()
rb = open(f"{W}/rollback/{V}.sql").read()
rb = re.sub(r"(?m)^(begin|commit);\s*$", "", rb)
estado = """(select json_build_object('md5', md5(prosrc), 'acl', proacl::text, 'dono', proowner::regrole::text, 'secdef', prosecdef, 'cfg', proconfig::text)
  from pg_proc where oid='public.dashboard_stats()'::regprocedure)"""
novas = "(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('dashboard_stats_leve','dashboard_stats_leve_contexto','dashboard_stats_por_rls'))"
sql = f"""begin;
create temp table _e(fase text, estado json, novas int);
insert into _e select 'antes', {estado}, {novas};
{mig}
insert into _e select 'migrada', {estado}, {novas};
{mig}
insert into _e select 'migrada_2x', {estado}, {novas};
{rb}
insert into _e select 'desfeita', {estado}, {novas};
do $r$ begin raise exception 'RESULTADO_JSON:%', (select json_agg(e) from _e e); end $r$;
"""
open(sys.argv[1], "w").write(sql)
print("ok")
