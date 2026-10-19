#!/usr/bin/env python3
"""Gera migration + rollback SÓ do dashboard_stats a partir da migration/rollback 20261019140000 (já conferidos)."""
import re, sys
WT = sys.argv[1]
OUTWT = sys.argv[2]
OLD_UP = f"{WT}/supabase/migrations/20261019140000_rls_leve_painel_vendas_financeiro.sql"
OLD_DOWN = f"{WT}/supabase/rollback/20261019140000_rls_leve_painel_vendas_financeiro.sql"
V = "20261019153000_rls_leve_dashboard_stats"
up = open(OLD_UP).read()
down = open(OLD_DOWN).read()

def between(s, a, b):
    i = s.index(a); j = s.index(b, i)
    return s[i:j]

# guardas: só dashboard_stats + dependências usadas pelo painel + policies
guard_dash = re.search(r"md5\(\(select prosrc from pg_proc where oid = 'public\.dashboard_stats\(\)'::regprocedure\)\) <> '([0-9a-f]+)'", up).group(1)
deps = re.findall(r"(  if md5\(\(select prosrc from pg_proc where oid = 'public\.(?:sale_corretores|sale_responsaveis|is_sale_corretor|is_sale_responsavel)\([^']*\)'::regprocedure\)\) <> '[0-9a-f]+' then\n    raise exception [^\n]+\n  end if;\n)", up)
assert len(deps) == 4, deps
pol = re.search(r"(  if \(select md5\(string_agg\(tablename.*?\n    raise exception 'rls_leve: policies[^\n]+\n  end if;\n)", up, re.S).group(1)

por_rls = between(up, "CREATE OR REPLACE FUNCTION public.dashboard_stats_por_rls()", "CREATE OR REPLACE FUNCTION public.vendas_comerciais_canonicas_por_rls()")
ctx = between(up, "create or replace function public.rls_leve_contexto(", "-- ===================================================================================================\n-- vendas_comerciais_canonicas (leve)")
leve = between(up, "create or replace function public.dashboard_stats_leve()", "-- ===================================================================================================\n-- list_vendas_comerciais_paginadas (leve)")
disp = between(up, "CREATE OR REPLACE FUNCTION public.dashboard_stats()", "CREATE OR REPLACE FUNCTION public.vendas_comerciais_canonicas()")

# helper com nome próprio, sem cl_gest (o painel não usa)
ctx = ctx.replace("public.rls_leve_contexto(", "public.dashboard_stats_leve_contexto(")
ctx = ctx.replace(", out cl_gest uuid[]", "").replace(" cl_gest := '{}';", "")
ctx = ctx.replace("  cl_gest := array(select public.vendas_coleader_gestao_ids());\n", "")
assert "cl_gest" not in ctx and "rls_leve_contexto" not in ctx
# cl_edic só aparece no painel dentro de "(c.amplo or ...)": para quem tem acesso amplo não muda nada e custa caro
_a = "  cl_edic := array(select public.vendas_coleader_edicao_ids());\n"
assert _a in ctx
ctx = ctx.replace(_a, "  -- cl_edic só é usado no painel junto com \"amplo or ...\": para acesso amplo fica vazio (mesmo resultado, sem custo)\n  if not amplo then\n    cl_edic := array(select public.vendas_coleader_edicao_ids());\n  end if;\n")
import re as _re
for _m in _re.finditer(r"[^\n]*cl_edic[^\n]*", leve):
    assert "c.amplo or" in _m.group(0) or _m.group(0).strip().startswith("--"), _m.group(0)
assert "cl_gest" not in leve
leve = leve.replace("public.rls_leve_contexto()", "public.dashboard_stats_leve_contexto()")
assert "rls_leve_contexto" not in leve

head = f"""-- t_f9a40158 (Denis 19/10, tópico 6238, opção B): SÓ o painel inicial (dashboard_stats) fica leve.
-- Substitui a parte do painel da migration 20261019140000 (PR #126, não aplicada). NÃO mexe em
-- vendas_comerciais_canonicas, list_vendas_comerciais_paginadas, financeiro_distribuicao_vendas,
-- comparativo_comissao_6pct_inconsistencias, policies nem helpers compartilhados (só os LÊ).
-- Funções novas, de uso exclusivo do painel: dashboard_stats_por_rls (texto de produção intacto),
-- dashboard_stats_leve_contexto (sem GRANT a usuários) e dashboard_stats_leve.
-- O QUE NÃO MUDA: o jsonb devolvido (mesmas fórmulas), dono e GRANTs de dashboard_stats; quem não é o usuário
-- logado (service_role, relatórios SECURITY DEFINER) segue no texto anterior. Sem cache.
-- Desfazer: supabase/rollback/{V}.sql
select set_config('lock_timeout', '5s', true);

do $g$
declare _sp text := current_setting('search_path');
begin
  perform set_config('search_path', 'public', true);
  if exists (select 1 from pg_proc where oid = 'public.dashboard_stats()'::regprocedure and prosrc like '%dashboard_stats_leve%') then
    raise notice 'rls_leve_dashboard: já aplicada antes (reaplicando o mesmo texto)';
  elsif md5((select prosrc from pg_proc where oid = 'public.dashboard_stats()'::regprocedure)) <> '{guard_dash}' then
    raise exception 'rls_leve_dashboard: dashboard_stats diverge do texto conferido em produção em 19/10; gere a migration de novo';
  end if;
{''.join(deps)}{pol}  perform set_config('search_path', _sp, true);
end $g$;

-- ===== 1) Caminho anterior: texto de PRODUÇÃO intacto, só renomeado =====
"""
mig = head + por_rls + """-- ===== 2) Versão leve (SECURITY DEFINER, search_path vazio, checagem de usuário e imobiliária) =====
-- Contexto de permissão do PAINEL, calculado UMA vez por chamada com as mesmas funções das policies.
-- Sem GRANT para usuários; só dashboard_stats_leve (mesmo dono) a chama.
""" + ctx + leve + """alter function public.dashboard_stats_leve_contexto() owner to postgres;
alter function public.dashboard_stats_leve() owner to postgres;

-- ===== 3) Mesmo nome de hoje vira o despachante (SECURITY INVOKER; dono e GRANTs preservados) =====
""" + disp
open(f"{OUTWT}/supabase/migrations/{V}.sql", "w").write(mig)

# rollback: texto de produção do dashboard_stats + drop das novas
orig = between(down, "-- >>> dashboard_stats (produção", "-- >>> vendas_comerciais_canonicas (produção")
rb = f"""-- DESFAZER da migration {V} (t_f9a40158).
-- Volta dashboard_stats EXATAMENTE ao texto de produção de 19/10/2026 (pg_get_functiondef, somente leitura)
-- e apaga as funções novas do painel. Não mexe em dados, tabelas, policies nem nas outras funções.
-- CREATE OR REPLACE mantém dono e GRANTs. Idempotente.
begin;
select set_config('lock_timeout', '5s', true);

{orig}drop function if exists public.dashboard_stats_leve();
drop function if exists public.dashboard_stats_leve_contexto();
drop function if exists public.dashboard_stats_por_rls();
commit;
"""
open(f"{OUTWT}/supabase/rollback/{V}.sql", "w").write(rb)
print("ok", len(mig), len(rb))
