#!/usr/bin/env python3
"""Gera a migration 20261019140000_rls_leve_painel_vendas_financeiro.sql (t_f8b87dd1).

Fontes (rodar de novo só se uma delas mudar):
  supabase/rollback/<V>.sql   — texto de PRODUÇÃO das 5 funções (pg_get_functiondef, lido só leitura em 19/10).
                                Vira o caminho antigo X_por_rls() sem nenhuma mudança além do nome.
  leve.sql.tpl                — versões leves (SECURITY DEFINER, filtro único) + contexto de permissão.

Desenho:
  X()          mesmo nome/assinatura/retorno/dono/GRANT de hoje, SECURITY INVOKER. Despacha:
                 current_user = 'authenticated' (usuário logado vindo do site) -> X_leve()
                 qualquer outro chamador (funções SECURITY DEFINER donas, service_role, mt_1b_definer) -> X_por_rls()
               Assim ~20 relatórios DEFINER que chamam vendas_comerciais_canonicas() continuam recebendo exatamente
               o que recebem hoje.
  X_por_rls()  texto de produção, intacto (renomeado), SECURITY INVOKER, mesmas permissões.
  X_leve()     SECURITY DEFINER, search_path vazio; calcula UMA vez as listas de vendas visíveis com as MESMAS
               funções das policies e filtra cada tabela pela mesma união de regras das policies dela.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
V = "20261019140000_rls_leve_painel_vendas_financeiro"
ROLLBACK = os.path.join(ROOT, "supabase", "rollback", V + ".sql")
OUT = os.path.join(ROOT, "supabase", "migrations", V + ".sql")

# md5(prosrc) de produção em 19/10 (somente leitura). A migration só troca se o texto atual for este (ou já o novo).
SRC_MD5 = {
    "dashboard_stats()": "8f17263275432242ddacd7e9494f0adf",
    "vendas_comerciais_canonicas()": "20c18c0daaee8800937022f8f45652e0",
    "list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[],text)": "e5331e5f2b94ef20e79818100c0fbf0f",
    "financeiro_distribuicao_vendas()": "ffaad4a67671f98f8b702122d2128ece",
    "comparativo_comissao_6pct_inconsistencias()": "6bdf331b60dcea05ce4ccb2cb4fd89e5",
}
# Dependências que a versão leve reproduz: se mudarem, a migration recusa (é preciso gerar de novo).
DEP_MD5 = {
    "sale_corretores(uuid)": "ddc81a755325cdd55149fc63be1a7e0e",
    "sale_responsaveis(uuid)": "95b39b29ad45dd908389591048ddcd7d",
    "is_sale_corretor(uuid,uuid)": "a066b3ede2fea1fb0330621e5a51d6f0",
    "is_sale_responsavel(uuid,uuid)": "02d2b7d13a64b194cf66b404a91ede36",
    "vendas_comerciais_validas()": "86d2938e30d3da0cce7a28849cfbcf0c",
    "metricas_venda_sem_parceria()": "852fd47440acb281bcf1b959c3a34cf3",
}
POLICY_TABLES = ["sales", "occurrences", "occurrence_partners", "occurrence_commissions", "sale_status_history",
                 "venda_distribuicao", "sale_commission_extras", "sale_parties"]
POLICY_MD5 = "480305b9925b8f9565897807cf72c42e"
POLICY_EXPR = (
    "(select md5(string_agg(tablename||'.'||policyname||'|'||cmd||'|'||permissive||'|'||roles::text||'|'||"
    "coalesce(qual,'')||'|'||coalesce(with_check,''), E'\\n' order by tablename, policyname)) from pg_policies "
    "where schemaname='public' and tablename in (%s) and cmd in ('SELECT','ALL'))"
    % ",".join("'%s'" % t for t in POLICY_TABLES))

# Uma CTE por tabela = a mesma união das policies de LEITURA (SELECT/ALL, PERMISSIVE para authenticated)
# daquela tabela, com a policy RESTRICTIVE org_isolation (organization_id = current_org_id()).
# c.vis = vendas_visiveis_ids(); c.cl_leit/cl_edic/cl_gest = vendas_coleader_*_ids(); c.jur = vendas_juridico_certidao_ids();
# c.amplo = has_any_role(uid, financeiro/admin/super_admin) (policy zz_mt_leitor_amplo_select).
CTE = {
    # sales: sales_select (vis OU corretor/captador/vendedor + is_active_user), sales_co_leader_principal_read, juridico_returned_sale_read
    "VS": "vs as materialized (select s.* from public.sales s, c where s.organization_id = c.org and ("
          "s.id in (select unnest(c.vis) from c) or s.id in (select unnest(c.cl_leit) from c) or s.id in (select unnest(c.jur) from c)"
          " or (c.uid in (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id) and c.ativo)))",
    # occurrences: occ_view (vis), occ_write (vis + papel ⊂ occ_view), co_leader_occurrence_write (cl_edic), co_leader_principal_read (cl_leit), amplo
    "VO": "vo as materialized (select o.* from public.occurrences o, c where o.organization_id = c.org and ("
          "c.amplo or o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c)))",
    # occurrence_partners: EXISTS em occurrences (que também tem RLS -> usa vo) com vis / cl_edic / cl_leit; amplo
    "VOP": "vop as materialized (select op.* from public.occurrence_partners op, c where op.organization_id = c.org and ("
           "c.amplo or exists (select 1 from vo o where o.id = op.occurrence_id and ("
           "o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c)))))",
    # occurrence_commissions: idem occurrence_partners
    "VOC": "voc as materialized (select oc.* from public.occurrence_commissions oc, c where oc.organization_id = c.org and ("
           "c.amplo or exists (select 1 from vo o where o.id = oc.occurrence_id and ("
           "o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c)))))",
    # sale_status_history: history_view (vis), co_leader_history_read (cl_gest), juridico_returned_history_read (jur), amplo
    "VH": "vh as materialized (select h.* from public.sale_status_history h, c where h.organization_id = c.org and ("
          "c.amplo or h.sale_id in (select unnest(c.vis) from c) or h.sale_id in (select unnest(c.cl_gest) from c) or h.sale_id in (select unnest(c.jur) from c)))",
    # venda_distribuicao: vd_select (vis OU cl_leit OU jur)
    "VVD": "vvd as materialized (select vd.* from public.venda_distribuicao vd, c where vd.organization_id = c.org and ("
           "vd.sale_id in (select unnest(c.vis) from c) or vd.sale_id in (select unnest(c.cl_leit) from c) or vd.sale_id in (select unnest(c.jur) from c)))",
    # sale_commission_extras: select (vis), co_leader_extras_write (cl_edic), co_leader_principal_read (cl_leit), juridico (jur), amplo
    "VEXT": "vext as materialized (select e.* from public.sale_commission_extras e, c where e.organization_id = c.org and ("
            "c.amplo or e.sale_id in (select unnest(c.vis) from c) or e.sale_id in (select unnest(c.cl_edic) from c) or e.sale_id in (select unnest(c.cl_leit) from c) or e.sale_id in (select unnest(c.jur) from c)))",
    # sale_parties: idem sale_commission_extras
    "VPART": "vpart as materialized (select sp.* from public.sale_parties sp, c where sp.organization_id = c.org and ("
             "c.amplo or sp.sale_id in (select unnest(c.vis) from c) or sp.sale_id in (select unnest(c.cl_edic) from c) or sp.sale_id in (select unnest(c.cl_leit) from c) or sp.sale_id in (select unnest(c.jur) from c)))",
}

ORIG = ["dashboard_stats", "vendas_comerciais_canonicas", "list_vendas_comerciais_paginadas",
        "financeiro_distribuicao_vendas", "comparativo_comissao_6pct_inconsistencias"]
LIST_ARGS = "integer, integer, text, text[], date, date, text, uuid[], text"
SIG = {
    "dashboard_stats": "",
    "vendas_comerciais_canonicas": "",
    "list_vendas_comerciais_paginadas": LIST_ARGS,
    "financeiro_distribuicao_vendas": "",
    "comparativo_comissao_6pct_inconsistencias": "",
}
GRANT_ORIG = "authenticated, service_role, mt_1b_definer"  # = ACL de produção das 5 funções (além do dono postgres)

RT_CANON = ("TABLE(sale_id uuid, venda_em timestamp with time zone, data_fechamento date, modalidade text, status text, "
            "codigo_interno text, imovel_id text, corretor_id uuid, percentual_comissao numeric, valor_negociado numeric, "
            "valor_total_comissao numeric, comissao_bruta numeric, parceria_externa numeric, vgv_proprio numeric, "
            "comissao_propria numeric, occurrence_count bigint, occurrence_concluida_count bigint)")
RT_FIN = "TABLE(sale_id uuid, saldo_inicial_imobiliaria numeric, saldo_liquido_imobiliaria numeric)"
RT_INC = "TABLE(sale_id uuid, codigo_interno text, modalidade text, motivo text)"
LIST_PARAMS = ("_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, "
               "_statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, "
               "_q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[], _midia text DEFAULT NULL::text")
LIST_CALL = "_page, _page_size, _status, _statuses, _desde, _ate, _q, _corretor_ids, _midia"


def prod_bodies():
    txt = open(ROLLBACK).read()
    out = {}
    for m in re.finditer(r"^-- >>> (\w+) \(produção[^\n]*\n(.*?)(?=^-- >>> |^drop function)", txt, re.S | re.M):
        out[m.group(1)] = m.group(2).strip()
    assert set(out) == set(ORIG), out.keys()
    return out


def renamed(name, body):
    head = f"CREATE OR REPLACE FUNCTION public.{name}("
    assert body.startswith(head), name
    return f"CREATE OR REPLACE FUNCTION public.{name}_por_rls(" + body[len(head):]


def dispatcher(name):
    marker = "  -- rls_leve: usuário logado (papel authenticated) -> versão leve; demais chamadores -> texto anterior (RLS)\n"
    if name == "dashboard_stats":
        return ("CREATE OR REPLACE FUNCTION public.dashboard_stats()\n RETURNS jsonb\n LANGUAGE sql\n STABLE\n"
                " SET search_path TO 'public'\nAS $function$\n" + marker +
                "  select case when current_user = 'authenticated' then public.dashboard_stats_leve()\n"
                "              else public.dashboard_stats_por_rls() end\n$function$;")
    if name == "list_vendas_comerciais_paginadas":
        return (f"CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas({LIST_PARAMS})\n RETURNS jsonb\n"
                " LANGUAGE sql\n STABLE\n SET search_path TO 'public'\nAS $function$\n" + marker +
                f"  select case when current_user = 'authenticated' then public.list_vendas_comerciais_paginadas_leve({LIST_CALL})\n"
                f"              else public.list_vendas_comerciais_paginadas_por_rls({LIST_CALL}) end\n$function$;")
    rt = {"vendas_comerciais_canonicas": RT_CANON, "financeiro_distribuicao_vendas": RT_FIN,
          "comparativo_comissao_6pct_inconsistencias": RT_INC}[name]
    return (f"CREATE OR REPLACE FUNCTION public.{name}()\n RETURNS {rt}\n LANGUAGE plpgsql\n STABLE\n"
            " SET search_path TO 'public'\nAS $function$\nbegin\n" + marker +
            "  if current_user = 'authenticated' then\n"
            f"    return query select * from public.{name}_leve();\n"
            "  else\n"
            f"    return query select * from public.{name}_por_rls();\n"
            "  end if;\nend\n$function$;")


def main():
    bodies = prod_bodies()
    tpl = open(os.path.join(HERE, "leve.sql.tpl")).read()
    for k, v in CTE.items():
        tpl = tpl.replace("{{%s}}" % k, v)
    assert "{{" not in tpl
    guard_src = "\n".join(
        f"    or md5((select prosrc from pg_proc where oid = 'public.{f}'::regprocedure)) <> '{h}'"
        for f, h in SRC_MD5.items()).replace("    or ", "    ", 1)
    guard_dep = "\n".join(
        f"  if md5((select prosrc from pg_proc where oid = 'public.{f}'::regprocedure)) <> '{h}' then\n"
        f"    raise exception 'public.{f} mudou desde a conferência de 19/10; gere a migration de novo';\n  end if;"
        for f, h in DEP_MD5.items())
    p = []
    p.append(f"""-- t_f8b87dd1 (aprovado por Denis 19/10, tópico 6238) — etapa 2 da lentidão do banco.
-- Painel inicial (dashboard_stats), vendas_comerciais_canonicas, lista de Vendas (list_vendas_comerciais_paginadas),
-- Financeiro (financeiro_distribuicao_vendas) e inconsistências (comparativo_comissao_6pct_inconsistencias) ficam leves:
-- as listas de vendas visíveis são calculadas UMA vez por chamada (mesmas funções das policies) e cada tabela é
-- filtrada pela mesma união de regras das policies dela, em vez da RLS linha a linha / aninhada.
--
-- O QUE NÃO MUDA: fórmulas de VGV, comissão, saldo_inicial e saldo_liquido (texto copiado de produção); nomes,
-- assinaturas, retorno, dono e GRANTs das 5 funções; quem vê o quê (matriz por papel e imobiliária idêntica no
-- ensaio local, ver supabase/tests/rls_leve/). Sem cache.
-- Chamadores que não são o usuário logado (relatórios SECURITY DEFINER, service_role) seguem no texto anterior
-- (X_por_rls), sem nenhuma mudança.
-- GERADO por supabase/tests/rls_leve/gerar_migration.py — não editar à mão.
-- Desfazer: supabase/rollback/{V}.sql (texto de produção de 19/10 + remove as funções novas).
select set_config('lock_timeout', '5s', true);

do $g$
declare _sp text := current_setting('search_path');
begin
  -- o texto das policies (pg_policies) depende do search_path da sessão; fixa 'public' só para a conferência
  perform set_config('search_path', 'public', true);
  if exists (select 1 from pg_proc where oid = 'public.dashboard_stats()'::regprocedure and prosrc like '%dashboard_stats_leve%') then
    raise notice 'rls_leve: já aplicada antes (reaplicando o mesmo texto)';
  elsif
{guard_src}
  then
    raise exception 'rls_leve: alguma das 5 funções diverge do texto conferido em produção em 19/10; gere a migration de novo';
  end if;
{guard_dep}
  if {POLICY_EXPR} <> '{POLICY_MD5}' then
    raise exception 'rls_leve: policies de leitura das tabelas de venda mudaram desde 19/10; gere a migration de novo';
  end if;
  perform set_config('search_path', _sp, true);
end $g$;
""")
    p.append("-- ===== 1) Caminho anterior: texto de PRODUÇÃO intacto, só renomeado para X_por_rls =====")
    for n in ORIG:
        p.append(renamed(n, bodies[n]))
        sig = f"public.{n}_por_rls({SIG[n]})"
        p.append(f"alter function {sig} owner to postgres;")
        p.append(f"revoke all on function {sig} from public, anon;")
        p.append(f"grant execute on function {sig} to {GRANT_ORIG};\n")
    p.append("-- ===== 2) Versões leves (SECURITY DEFINER, search_path vazio, checagem de usuário e imobiliária) =====")
    p.append(tpl)
    for f in ["rls_leve_contexto()"] + [f"{n}_leve({SIG[n]})" for n in ORIG]:
        p.append(f"alter function public.{f} owner to postgres;")
    p.append("\n-- ===== 3) Mesmo nome de hoje vira o despachante (SECURITY INVOKER; dono e GRANTs preservados) =====")
    for n in ORIG:
        p.append(dispatcher(n))
    p.append("")
    open(OUT, "w").write("\n".join(p) + "\n")
    print("ok", OUT)


if __name__ == "__main__":
    main()
