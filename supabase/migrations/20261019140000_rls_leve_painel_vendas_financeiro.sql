-- t_f8b87dd1 (aprovado por Denis 19/10, tópico 6238) — etapa 2 da lentidão do banco.
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
-- Desfazer: supabase/rollback/20261019140000_rls_leve_painel_vendas_financeiro.sql (texto de produção de 19/10 + remove as funções novas).
select set_config('lock_timeout', '5s', true);

do $g$
declare _sp text := current_setting('search_path');
begin
  -- o texto das policies (pg_policies) depende do search_path da sessão; fixa 'public' só para a conferência
  perform set_config('search_path', 'public', true);
  if exists (select 1 from pg_proc where oid = 'public.dashboard_stats()'::regprocedure and prosrc like '%dashboard_stats_leve%') then
    raise notice 'rls_leve: já aplicada antes (reaplicando o mesmo texto)';
  elsif
    md5((select prosrc from pg_proc where oid = 'public.dashboard_stats()'::regprocedure)) <> '8f17263275432242ddacd7e9494f0adf'
    or md5((select prosrc from pg_proc where oid = 'public.vendas_comerciais_canonicas()'::regprocedure)) <> '20c18c0daaee8800937022f8f45652e0'
    or md5((select prosrc from pg_proc where oid = 'public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[],text)'::regprocedure)) <> 'e5331e5f2b94ef20e79818100c0fbf0f'
    or md5((select prosrc from pg_proc where oid = 'public.financeiro_distribuicao_vendas()'::regprocedure)) <> 'ffaad4a67671f98f8b702122d2128ece'
    or md5((select prosrc from pg_proc where oid = 'public.comparativo_comissao_6pct_inconsistencias()'::regprocedure)) <> '6bdf331b60dcea05ce4ccb2cb4fd89e5'
  then
    raise exception 'rls_leve: alguma das 5 funções diverge do texto conferido em produção em 19/10; gere a migration de novo';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.sale_corretores(uuid)'::regprocedure)) <> 'ddc81a755325cdd55149fc63be1a7e0e' then
    raise exception 'public.sale_corretores(uuid) mudou desde a conferência de 19/10; gere a migration de novo';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.sale_responsaveis(uuid)'::regprocedure)) <> '95b39b29ad45dd908389591048ddcd7d' then
    raise exception 'public.sale_responsaveis(uuid) mudou desde a conferência de 19/10; gere a migration de novo';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.is_sale_corretor(uuid,uuid)'::regprocedure)) <> 'a066b3ede2fea1fb0330621e5a51d6f0' then
    raise exception 'public.is_sale_corretor(uuid,uuid) mudou desde a conferência de 19/10; gere a migration de novo';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.is_sale_responsavel(uuid,uuid)'::regprocedure)) <> '02d2b7d13a64b194cf66b404a91ede36' then
    raise exception 'public.is_sale_responsavel(uuid,uuid) mudou desde a conferência de 19/10; gere a migration de novo';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.vendas_comerciais_validas()'::regprocedure)) <> '86d2938e30d3da0cce7a28849cfbcf0c' then
    raise exception 'public.vendas_comerciais_validas() mudou desde a conferência de 19/10; gere a migration de novo';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.metricas_venda_sem_parceria()'::regprocedure)) <> '852fd47440acb281bcf1b959c3a34cf3' then
    raise exception 'public.metricas_venda_sem_parceria() mudou desde a conferência de 19/10; gere a migration de novo';
  end if;
  if (select md5(string_agg(tablename||'.'||policyname||'|'||cmd||'|'||permissive||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' order by tablename, policyname)) from pg_policies where schemaname='public' and tablename in ('sales','occurrences','occurrence_partners','occurrence_commissions','sale_status_history','venda_distribuicao','sale_commission_extras','sale_parties') and cmd in ('SELECT','ALL')) <> '480305b9925b8f9565897807cf72c42e' then
    raise exception 'rls_leve: policies de leitura das tabelas de venda mudaram desde 19/10; gere a migration de novo';
  end if;
  perform set_config('search_path', _sp, true);
end $g$;

-- ===== 1) Caminho anterior: texto de PRODUÇÃO intacto, só renomeado para X_por_rls =====
CREATE OR REPLACE FUNCTION public.dashboard_stats_por_rls()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with vs as materialized (select * from public.sales),
  vo as materialized (select * from public.occurrences),
  parceria_por_occ as (
    select occurrence_id, sum(valor) as valor
    from (
      select occurrence_id, coalesce(valor, 0) as valor
      from occurrence_partners
      union all
      select occurrence_id, coalesce(valor, 0)
      from occurrence_commissions
      where sem_cadastro_confirmado
    ) p
    group by occurrence_id
  ),
  distribuicao_por_occ as (
    select
      o.id as occurrence_id,
      vd.resultado as resultado
    from vo o
    join vs s on s.id = o.sale_id
    join venda_distribuicao vd on vd.sale_id = s.id
  ),
  minha_parte_ocorrencia as (
    -- Venda com ocorrência: a parte do usuário é a linha dele em occurrence_commissions.
    select sum(oc.valor) as valor
    from occurrence_commissions oc
    join vo o on o.id = oc.occurrence_id
    join vs s on s.id = o.sale_id
    where oc.user_id = auth.uid()
      and coalesce(oc.sem_cadastro_confirmado, false) = false
      and s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
  ),
  minha_parte_venda as (
    -- Antes da ocorrência: líquido do lado em que participa (mesma distribuição oficial),
    -- indicador, líder e extras vinculados à conta do usuário.
    select sum(
      case when s.corretor_captador_id = auth.uid() then coalesce((d.r->>'liquido_captador')::numeric, 0) else 0 end
      + case when s.corretor_vendedor_id = auth.uid() then coalesce((d.r->>'liquido_vendedor')::numeric, 0) else 0 end
      + case when s.indicador_captador_id = auth.uid() then coalesce(s.valor_comissao_indicador_captador, 0) else 0 end
      + case when s.indicador_vendedor_id = auth.uid() then coalesce(s.valor_comissao_indicador_vendedor, 0) else 0 end
      + case when s.lider_captador_id = auth.uid() then coalesce(s.valor_comissao_lider_captador, 0) else 0 end
      + case when s.lider_vendedor_id = auth.uid() then coalesce(s.valor_comissao_lider_vendedor, 0) else 0 end
      + coalesce((select sum(coalesce(e.valor, 0)) from sale_commission_extras e
                  where e.sale_id = s.id and e.user_id = auth.uid()
                    and coalesce(e.sem_cadastro_confirmado, false) = false), 0)
    ) as valor
    from vs s
    join lateral (select vd.resultado as r from venda_distribuicao vd where vd.sale_id = s.id) d on true
    where s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
      and not exists (select 1 from vo o where o.sale_id = s.id)
      and (
        auth.uid() in (s.corretor_captador_id, s.corretor_vendedor_id, s.indicador_captador_id,
                       s.indicador_vendedor_id, s.lider_captador_id, s.lider_vendedor_id)
        or exists (select 1 from sale_commission_extras e where e.sale_id = s.id and e.user_id = auth.uid())
      )
  )
  select jsonb_build_object(
    'funil', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
        select status::text as status, count(*) as cnt from vs group by status
      ) t
    ),
    'minhas_vendas', (select count(*) from vs s where public.is_sale_corretor(auth.uid(), s.id)),
    'minhas_pendencias', (select count(*) from vs s where s.status::text in ('rascunho','devolvida_ajuste') and public.is_sale_responsavel(auth.uid(), s.id)),
    'meus_contratos_conferir', (select count(*) from vs s where s.status::text = 'contrato_conferencia_corretor' and public.is_sale_responsavel(auth.uid(), s.id)),
    'meus_assinados', (select count(*) from vs s where s.status::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida') and public.is_sale_corretor(auth.uid(), s.id)),
    'minha_comissao_prevista', coalesce((select valor from minha_parte_ocorrencia), 0) + coalesce((select valor from minha_parte_venda), 0),
    'gestor_aguardando_revisao', (select count(*) from vs where status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (select count(*) from vs where status::text in ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (select count(*) from vs where status::text in ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (select count(*) from vs where status::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (select count(*) from vs where status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (select count(*) from vs where status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (select count(*) from vs where status::text = 'aguardando_assinatura'),
    'juridico_assinados', (select count(*) from vs where status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (select count(*) from vs where status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (select count(*) from vs where status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (select count(*) from vo o join vs s on s.id = o.sale_id where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'occ_concluidas_total', (select count(*) from vo o join vs s on s.id = o.sale_id where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'comissao_prevista_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from vo o
      join vs s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_concluida_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from vo o
      join vs s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_prevista_total', coalesce((
      select sum(p.valor)
      from vo o
      join vs s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_concluida_total', coalesce((
      select sum(p.valor)
      from vo o
      join vs s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_prevista_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from vo o
      join vs s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_concluida_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from vo o
      join vs s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_por_corretor', (
      select coalesce(jsonb_object_agg(user_id, total), '{}'::jsonb) from (
        select oc.user_id::text as user_id, sum(oc.valor) as total
        from occurrence_commissions oc
        join vo o on o.id = oc.occurrence_id
        join vs s on s.id = o.sale_id
        where s.status::text not in ('cancelada','arquivada') and oc.user_id is not null
        group by oc.user_id
      ) t
    )
  );
$function$
;
alter function public.dashboard_stats_por_rls() owner to postgres;
revoke all on function public.dashboard_stats_por_rls() from public, anon;
grant execute on function public.dashboard_stats_por_rls() to authenticated, service_role, mt_1b_definer;

CREATE OR REPLACE FUNCTION public.vendas_comerciais_canonicas_por_rls()
 RETURNS TABLE(sale_id uuid, venda_em timestamp with time zone, data_fechamento date, modalidade text, status text, codigo_interno text, imovel_id text, corretor_id uuid, percentual_comissao numeric, valor_negociado numeric, valor_total_comissao numeric, comissao_bruta numeric, parceria_externa numeric, vgv_proprio numeric, comissao_propria numeric, occurrence_count bigint, occurrence_concluida_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH metricas AS (
    SELECT * FROM public.metricas_venda_sem_parceria()
  )
  SELECT
    v.sale_id,
    v.venda_em,
    (v.venda_em at time zone 'America/Sao_Paulo')::date AS data_fechamento,
    s.modalidade::text,
    s.status::text,
    s.codigo_interno,
    s.imovel_id,
    s.corretor_id,
    s.percentual_comissao,
    m.vgv AS valor_negociado,
    m.comissao_bruta AS valor_total_comissao,
    m.comissao_bruta,
    m.parceria_externa,
    CASE
      WHEN m.comissao_bruta > 0 THEN
        m.vgv * least(greatest(m.comissao_bruta - m.parceria_externa, 0) / m.comissao_bruta, 1)
      ELSE 0
    END AS vgv_proprio,
    greatest(m.comissao_bruta - m.parceria_externa, 0) AS comissao_propria,
    coalesce(o.occurrence_count, 0),
    coalesce(o.occurrence_concluida_count, 0)
  FROM public.vendas_comerciais_validas() v
  JOIN public.sales s ON s.id = v.sale_id
  JOIN metricas m ON m.sale_id = v.sale_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS occurrence_count,
      count(*) FILTER (WHERE oc.status = 'concluida') AS occurrence_concluida_count
    FROM public.occurrences oc
    WHERE oc.sale_id = s.id
  ) o ON true
  WHERE s.status::text NOT IN ('cancelada', 'arquivada')
    AND s.valor_negociado > 0
    AND s.valor_total_comissao > 0;
$function$
;
alter function public.vendas_comerciais_canonicas_por_rls() owner to postgres;
revoke all on function public.vendas_comerciais_canonicas_por_rls() from public, anon;
grant execute on function public.vendas_comerciais_canonicas_por_rls() to authenticated, service_role, mt_1b_definer;

CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas_por_rls(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[], _midia text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with assinaturas as (
    select o.sale_id, max(o.data_assinatura) as data_assinatura
    from public.occurrences o
    group by o.sale_id
  ), base as (
    select
      s.id,
      s.status,
      s.valor_negociado,
      s.imovel_id,
      s.codigo_interno,
      s.corretor_captador,
      s.corretor_vendedor,
      s.updated_at,
      s.created_at,
      s.corretor_id,
      s.modalidade,
      s.data_assinatura,
      case
        when s.modalidade::text = 'lancamento' then
          coalesce(
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
        else
          coalesce(
            u.data_assinatura,
            a.data_assinatura,
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
      end as data_venda
    from public.sales s
    left join assinaturas a on a.sale_id = s.id
    left join lateral (
      select (max(h.created_at) at time zone 'America/Sao_Paulo')::date as data_assinatura
      from public.sale_status_history h
      where h.sale_id = s.id
        and h.para::text = 'contrato_assinado'
    ) u on true
    where (_status is null or s.status::text = _status)
      and (_statuses is null or s.status::text = any(_statuses))
      and (_corretor_ids is null or exists (
        select 1 from unnest(_corretor_ids) c where public.is_sale_corretor(c, s.id)
      ))
      and (_midia is null
        or (_midia = '__sem_midia__' and s.midia is null)
        or s.midia = _midia)
  ), filtradas as (
    select b.*
    from base b
    where b.data_venda is not null
      and (_desde is null or b.data_venda >= _desde)
      and (_ate is null or b.data_venda <= _ate)
      and (
        nullif(trim(_q), '') is null
        or b.imovel_id ilike '%' || trim(_q) || '%'
        or b.codigo_interno ilike '%' || trim(_q) || '%'
        or b.corretor_captador ilike '%' || trim(_q) || '%'
        or b.corretor_vendedor ilike '%' || trim(_q) || '%'
        or exists (
          select 1 from public.sales se
          where se.id = b.id
            and concat_ws(' ', se.imovel_endereco, se.imovel_logradouro, se.imovel_bairro, se.imovel_cidade, se.imovel_cep)
                ilike '%' || trim(_q) || '%'
        )
        or exists (
          select 1
          from public.sale_parties sp
          where sp.sale_id = b.id
            and sp.nome ilike '%' || trim(_q) || '%'
        )
      )
  ), pagina as (
    select f.*, public.sale_corretores_ids(f.id) as corretores_ids
    from filtradas f
    order by data_venda desc, id
    limit least(greatest(coalesce(_page_size, 10), 1), 50)
    offset greatest(coalesce(_page, 0), 0) * least(greatest(coalesce(_page_size, 10), 1), 50)
  ), totais as (
    select
      count(*)::integer as total_count,
      coalesce(sum(coalesce(valor_negociado, 0)) filter (where status::text not in ('cancelada', 'arquivada')), 0) as total_valor
    from filtradas
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.data_venda desc, p.id) from pagina p),
      '[]'::jsonb
    ),
    'total_count', totais.total_count,
    'total_valor', totais.total_valor
  )
  from totais;
$function$
;
alter function public.list_vendas_comerciais_paginadas_por_rls(integer, integer, text, text[], date, date, text, uuid[], text) owner to postgres;
revoke all on function public.list_vendas_comerciais_paginadas_por_rls(integer, integer, text, text[], date, date, text, uuid[], text) from public, anon;
grant execute on function public.list_vendas_comerciais_paginadas_por_rls(integer, integer, text, text[], date, date, text, uuid[], text) to authenticated, service_role, mt_1b_definer;

CREATE OR REPLACE FUNCTION public.financeiro_distribuicao_vendas_por_rls()
 RETURNS TABLE(sale_id uuid, saldo_inicial_imobiliaria numeric, saldo_liquido_imobiliaria numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    v.sale_id,
    coalesce((d.resultado->>'saldo_inicial_imobiliaria')::numeric, 0),
    coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )
  from public.vendas_comerciais_canonicas() v
  join public.sales s on s.id = v.sale_id
  join lateral (
    select vd.resultado from venda_distribuicao vd where vd.sale_id = s.id
  ) d on true
  where s.status::text not in ('cancelada', 'arquivada')
    and public.has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin']::public.app_role[]
    );
$function$
;
alter function public.financeiro_distribuicao_vendas_por_rls() owner to postgres;
revoke all on function public.financeiro_distribuicao_vendas_por_rls() from public, anon;
grant execute on function public.financeiro_distribuicao_vendas_por_rls() to authenticated, service_role, mt_1b_definer;

CREATE OR REPLACE FUNCTION public.comparativo_comissao_6pct_inconsistencias_por_rls()
 RETURNS TABLE(sale_id uuid, codigo_interno text, modalidade text, motivo text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_any_role((select auth.uid()), array['admin','super_admin','financeiro']::public.app_role[]) then
    raise exception 'Acesso não autorizado ao Comparativo de Comissão.' using errcode = '42501';
  end if;
  return query
  select s.id, s.codigo_interno, s.modalidade::text, 'valores_invalidos'::text
  from public.vendas_comerciais_validas() v
  join public.sales s on s.id = v.sale_id
  where not (s.valor_negociado is not null and s.valor_negociado > 0
    and s.valor_total_comissao is not null and s.valor_total_comissao > 0);
end;
$function$
;
alter function public.comparativo_comissao_6pct_inconsistencias_por_rls() owner to postgres;
revoke all on function public.comparativo_comissao_6pct_inconsistencias_por_rls() from public, anon;
grant execute on function public.comparativo_comissao_6pct_inconsistencias_por_rls() to authenticated, service_role, mt_1b_definer;

-- ===== 2) Versões leves (SECURITY DEFINER, search_path vazio, checagem de usuário e imobiliária) =====
-- ===================================================================================================
-- Contexto de permissão calculado UMA vez por chamada (mesmas funções que as policies usam).
-- SECURITY DEFINER: lê como dono, sem RLS; quem filtra são as funções *_leve abaixo, com as mesmas regras.
-- Sem login ou sem imobiliária ativa: org = null e todas as listas vazias (= nada visível, igual à RLS).
-- Não é exposta a usuários (sem GRANT para authenticated/anon); só as funções *_leve (donas) a chamam.
-- ===================================================================================================
create or replace function public.rls_leve_contexto(
  out uid uuid, out org uuid, out ativo boolean, out amplo boolean,
  out vis uuid[], out cl_leit uuid[], out cl_edic uuid[], out cl_gest uuid[], out jur uuid[])
language plpgsql stable security definer set search_path to ''
as $function$
begin
  uid := auth.uid();
  org := public.current_org_id();
  ativo := false; amplo := false;
  vis := '{}'; cl_leit := '{}'; cl_edic := '{}'; cl_gest := '{}'; jur := '{}';
  -- checagem explícita: sem usuário ou sem imobiliária no contexto, nada é visível
  if uid is null or org is null then
    org := null;
    return;
  end if;
  ativo := coalesce(public.is_active_user(uid), false);
  amplo := coalesce(public.has_any_role(uid, array['financeiro','admin','super_admin']::public.app_role[]), false);
  vis := array(select public.vendas_visiveis_ids());
  cl_leit := array(select public.vendas_coleader_leitura_ids());
  cl_edic := array(select public.vendas_coleader_edicao_ids());
  cl_gest := array(select public.vendas_coleader_gestao_ids());
  jur := array(select public.vendas_juridico_certidao_ids());
end $function$;
revoke all on function public.rls_leve_contexto() from public, anon, authenticated;

-- ===================================================================================================
-- vendas_comerciais_canonicas (leve): mesmo cálculo de vendas_comerciais_validas + metricas_venda_sem_parceria
-- + canonicas, com cada tabela filtrada pelas MESMAS regras das policies de leitura dela.
-- ===================================================================================================
create or replace function public.vendas_comerciais_canonicas_leve()
 returns table(sale_id uuid, venda_em timestamp with time zone, data_fechamento date, modalidade text, status text, codigo_interno text, imovel_id text, corretor_id uuid, percentual_comissao numeric, valor_negociado numeric, valor_total_comissao numeric, comissao_bruta numeric, parceria_externa numeric, vgv_proprio numeric, comissao_propria numeric, occurrence_count bigint, occurrence_concluida_count bigint)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with c as materialized (select * from public.rls_leve_contexto()),
  vs as materialized (select s.* from public.sales s, c where s.organization_id = c.org and (s.id in (select unnest(c.vis) from c) or s.id in (select unnest(c.cl_leit) from c) or s.id in (select unnest(c.jur) from c) or (c.uid in (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id) and c.ativo))),
  vo as materialized (select o.* from public.occurrences o, c where o.organization_id = c.org and (c.amplo or o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))),
  vop as materialized (select op.* from public.occurrence_partners op, c where op.organization_id = c.org and (c.amplo or exists (select 1 from vo o where o.id = op.occurrence_id and (o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))))),
  voc as materialized (select oc.* from public.occurrence_commissions oc, c where oc.organization_id = c.org and (c.amplo or exists (select 1 from vo o where o.id = oc.occurrence_id and (o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))))),
  vh as materialized (select h.* from public.sale_status_history h, c where h.organization_id = c.org and (c.amplo or h.sale_id in (select unnest(c.vis) from c) or h.sale_id in (select unnest(c.cl_gest) from c) or h.sale_id in (select unnest(c.jur) from c))),
  validas as (
    select
      s.id as sale_id,
      case
        when s.modalidade::text = 'lancamento' then
          coalesce(
            (s.data_assinatura::timestamp at time zone 'America/Sao_Paulo'),
            max(h.created_at) filter (where h.para::text = 'ocorrencia_analise_financeiro')
          )
        else
          max(h.created_at) filter (where h.para::text = 'contrato_assinado')
      end as venda_em
    from vs s
    join vh h on h.sale_id = s.id
    where s.status::text in (
      'contrato_assinado',
      'ocorrencia_pendente',
      'ocorrencia_analise_financeiro',
      'ocorrencia_devolvida_gestor',
      'ocorrencia_concluida'
    )
    group by s.id, s.modalidade, s.data_assinatura
    having case
      when s.modalidade::text = 'lancamento' then
        max(h.created_at) filter (where h.para::text = 'ocorrencia_analise_financeiro') is not null
      else
        max(h.created_at) filter (where h.para::text = 'contrato_assinado') is not null
    end
  ),
  metricas as (
    select s.id as sale_id, coalesce(s.valor_negociado, 0) as vgv, coalesce(s.valor_total_comissao, 0) as comissao_bruta,
      coalesce((select sum(op.valor) from vo o join vop op on op.occurrence_id = o.id where o.sale_id = s.id), 0)
      + coalesce((select sum(oc.valor) from vo o join voc oc on oc.occurrence_id = o.id where o.sale_id = s.id and oc.sem_cadastro_confirmado), 0)
        as parceria_externa
    from vs s
    where s.status::text not in ('cancelada','arquivada')
  )
  select
    v.sale_id,
    v.venda_em,
    (v.venda_em at time zone 'America/Sao_Paulo')::date as data_fechamento,
    s.modalidade::text,
    s.status::text,
    s.codigo_interno,
    s.imovel_id,
    s.corretor_id,
    s.percentual_comissao,
    m.vgv as valor_negociado,
    m.comissao_bruta as valor_total_comissao,
    m.comissao_bruta,
    m.parceria_externa,
    case
      when m.comissao_bruta > 0 then
        m.vgv * least(greatest(m.comissao_bruta - m.parceria_externa, 0) / m.comissao_bruta, 1)
      else 0
    end as vgv_proprio,
    greatest(m.comissao_bruta - m.parceria_externa, 0) as comissao_propria,
    coalesce(o.occurrence_count, 0),
    coalesce(o.occurrence_concluida_count, 0)
  from validas v
  join vs s on s.id = v.sale_id
  join metricas m on m.sale_id = v.sale_id
  left join lateral (
    select
      count(*) as occurrence_count,
      count(*) filter (where oc.status = 'concluida') as occurrence_concluida_count
    from vo oc
    where oc.sale_id = s.id
  ) o on true
  where s.status::text not in ('cancelada', 'arquivada')
    and s.valor_negociado > 0
    and s.valor_total_comissao > 0;
$function$;
revoke all on function public.vendas_comerciais_canonicas_leve() from public, anon;
grant execute on function public.vendas_comerciais_canonicas_leve() to authenticated;

-- ===================================================================================================
-- financeiro_distribuicao_vendas (leve): mesma checagem has_any_role e mesmas fórmulas de saldo.
-- ===================================================================================================
create or replace function public.financeiro_distribuicao_vendas_leve()
 returns table(sale_id uuid, saldo_inicial_imobiliaria numeric, saldo_liquido_imobiliaria numeric)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with c as materialized (select * from public.rls_leve_contexto()),
  vs as materialized (select s.* from public.sales s, c where s.organization_id = c.org and (s.id in (select unnest(c.vis) from c) or s.id in (select unnest(c.cl_leit) from c) or s.id in (select unnest(c.jur) from c) or (c.uid in (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id) and c.ativo))),
  vvd as materialized (select vd.* from public.venda_distribuicao vd, c where vd.organization_id = c.org and (vd.sale_id in (select unnest(c.vis) from c) or vd.sale_id in (select unnest(c.cl_leit) from c) or vd.sale_id in (select unnest(c.jur) from c)))
  select
    v.sale_id,
    coalesce((d.resultado->>'saldo_inicial_imobiliaria')::numeric, 0),
    coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )
  from public.vendas_comerciais_canonicas_leve() v
  join vs s on s.id = v.sale_id
  join lateral (
    select vd.resultado from vvd vd where vd.sale_id = s.id
  ) d on true
  where s.status::text not in ('cancelada', 'arquivada')
    and public.has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin']::public.app_role[]
    );
$function$;
revoke all on function public.financeiro_distribuicao_vendas_leve() from public, anon;
grant execute on function public.financeiro_distribuicao_vendas_leve() to authenticated;

-- ===================================================================================================
-- comparativo_comissao_6pct_inconsistencias (leve): mesma barreira de papel e mesma regra.
-- ===================================================================================================
create or replace function public.comparativo_comissao_6pct_inconsistencias_leve()
 returns table(sale_id uuid, codigo_interno text, modalidade text, motivo text)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if not public.has_any_role((select auth.uid()), array['admin','super_admin','financeiro']::public.app_role[]) then
    raise exception 'Acesso não autorizado ao Comparativo de Comissão.' using errcode = '42501';
  end if;
  return query
  with c as materialized (select * from public.rls_leve_contexto()),
  vs as materialized (select s.* from public.sales s, c where s.organization_id = c.org and (s.id in (select unnest(c.vis) from c) or s.id in (select unnest(c.cl_leit) from c) or s.id in (select unnest(c.jur) from c) or (c.uid in (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id) and c.ativo))),
  vh as materialized (select h.* from public.sale_status_history h, c where h.organization_id = c.org and (c.amplo or h.sale_id in (select unnest(c.vis) from c) or h.sale_id in (select unnest(c.cl_gest) from c) or h.sale_id in (select unnest(c.jur) from c))),
  validas as (
    select s.id as sale_id
    from vs s
    join vh h on h.sale_id = s.id
    where s.status::text in (
      'contrato_assinado',
      'ocorrencia_pendente',
      'ocorrencia_analise_financeiro',
      'ocorrencia_devolvida_gestor',
      'ocorrencia_concluida'
    )
    group by s.id, s.modalidade, s.data_assinatura
    having case
      when s.modalidade::text = 'lancamento' then
        max(h.created_at) filter (where h.para::text = 'ocorrencia_analise_financeiro') is not null
      else
        max(h.created_at) filter (where h.para::text = 'contrato_assinado') is not null
    end
  )
  select s.id, s.codigo_interno, s.modalidade::text, 'valores_invalidos'::text
  from validas v
  join vs s on s.id = v.sale_id
  where not (s.valor_negociado is not null and s.valor_negociado > 0
    and s.valor_total_comissao is not null and s.valor_total_comissao > 0);
end;
$function$;
revoke all on function public.comparativo_comissao_6pct_inconsistencias_leve() from public, anon;
grant execute on function public.comparativo_comissao_6pct_inconsistencias_leve() to authenticated;

-- ===================================================================================================
-- dashboard_stats (leve): mesmo jsonb. is_sale_corretor/is_sale_responsavel viram comparação direta
-- (mesma regra de sale_corretores/sale_responsaveis, que já liam sem RLS). Sem cache.
-- ===================================================================================================
create or replace function public.dashboard_stats_leve()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with c as materialized (select * from public.rls_leve_contexto()),
  vs as materialized (select s.* from public.sales s, c where s.organization_id = c.org and (s.id in (select unnest(c.vis) from c) or s.id in (select unnest(c.cl_leit) from c) or s.id in (select unnest(c.jur) from c) or (c.uid in (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id) and c.ativo))),
  vo as materialized (select o.* from public.occurrences o, c where o.organization_id = c.org and (c.amplo or o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))),
  vop as materialized (select op.* from public.occurrence_partners op, c where op.organization_id = c.org and (c.amplo or exists (select 1 from vo o where o.id = op.occurrence_id and (o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))))),
  voc as materialized (select oc.* from public.occurrence_commissions oc, c where oc.organization_id = c.org and (c.amplo or exists (select 1 from vo o where o.id = oc.occurrence_id and (o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))))),
  vvd as materialized (select vd.* from public.venda_distribuicao vd, c where vd.organization_id = c.org and (vd.sale_id in (select unnest(c.vis) from c) or vd.sale_id in (select unnest(c.cl_leit) from c) or vd.sale_id in (select unnest(c.jur) from c))),
  vext as materialized (select e.* from public.sale_commission_extras e, c where e.organization_id = c.org and (c.amplo or e.sale_id in (select unnest(c.vis) from c) or e.sale_id in (select unnest(c.cl_edic) from c) or e.sale_id in (select unnest(c.cl_leit) from c) or e.sale_id in (select unnest(c.jur) from c))),
  meu_cor as materialized (
    -- = is_sale_corretor(auth.uid(), s.id): sale_corretores(s.id) contém o usuário
    select s.id from vs s, c
    where c.uid is not null and (
         c.uid in (s.corretor_captador_id, s.corretor_vendedor_id)
      or exists (select 1 from public.sale_commission_extras e
                 where e.sale_id = s.id and e.papel in ('corretor_captador', 'corretor_vendedor') and e.user_id = c.uid)
      or (s.corretor_id = c.uid and s.corretor_captador_id is null and s.corretor_vendedor_id is null
          and not exists (select 1 from public.sale_commission_extras e
                          where e.sale_id = s.id and e.papel in ('corretor_captador', 'corretor_vendedor') and e.user_id is not null)))
  ),
  meu_resp as materialized (
    -- = is_sale_responsavel(auth.uid(), s.id): lançamento -> corretor_id; demais -> sale_corretores
    select s.id from vs s, c
    where c.uid is not null and (
         (s.modalidade::text = 'lancamento' and s.corretor_id = c.uid)
      or (s.modalidade::text is distinct from 'lancamento' and s.id in (select id from meu_cor)))
  ),
  parceria_por_occ as (
    select occurrence_id, sum(valor) as valor
    from (
      select occurrence_id, coalesce(valor, 0) as valor
      from vop
      union all
      select occurrence_id, coalesce(valor, 0)
      from voc
      where sem_cadastro_confirmado
    ) p
    group by occurrence_id
  ),
  distribuicao_por_occ as (
    select
      o.id as occurrence_id,
      vd.resultado as resultado
    from vo o
    join vs s on s.id = o.sale_id
    join vvd vd on vd.sale_id = s.id
  ),
  minha_parte_ocorrencia as (
    select sum(oc.valor) as valor
    from voc oc
    join vo o on o.id = oc.occurrence_id
    join vs s on s.id = o.sale_id
    where oc.user_id = (select uid from c)
      and coalesce(oc.sem_cadastro_confirmado, false) = false
      and s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
  ),
  minha_parte_venda as (
    select sum(
      case when s.corretor_captador_id = (select uid from c) then coalesce((d.r->>'liquido_captador')::numeric, 0) else 0 end
      + case when s.corretor_vendedor_id = (select uid from c) then coalesce((d.r->>'liquido_vendedor')::numeric, 0) else 0 end
      + case when s.indicador_captador_id = (select uid from c) then coalesce(s.valor_comissao_indicador_captador, 0) else 0 end
      + case when s.indicador_vendedor_id = (select uid from c) then coalesce(s.valor_comissao_indicador_vendedor, 0) else 0 end
      + case when s.lider_captador_id = (select uid from c) then coalesce(s.valor_comissao_lider_captador, 0) else 0 end
      + case when s.lider_vendedor_id = (select uid from c) then coalesce(s.valor_comissao_lider_vendedor, 0) else 0 end
      + coalesce((select sum(coalesce(e.valor, 0)) from vext e
                  where e.sale_id = s.id and e.user_id = (select uid from c)
                    and coalesce(e.sem_cadastro_confirmado, false) = false), 0)
    ) as valor
    from vs s
    join lateral (select vd.resultado as r from vvd vd where vd.sale_id = s.id) d on true
    where s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
      and not exists (select 1 from vo o where o.sale_id = s.id)
      and (
        (select uid from c) in (s.corretor_captador_id, s.corretor_vendedor_id, s.indicador_captador_id,
                       s.indicador_vendedor_id, s.lider_captador_id, s.lider_vendedor_id)
        or exists (select 1 from vext e where e.sale_id = s.id and e.user_id = (select uid from c))
      )
  )
  select jsonb_build_object(
    'funil', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
        select status::text as status, count(*) as cnt from vs group by status
      ) t
    ),
    'minhas_vendas', (select count(*) from vs s where s.id in (select id from meu_cor)),
    'minhas_pendencias', (select count(*) from vs s where s.status::text in ('rascunho','devolvida_ajuste') and s.id in (select id from meu_resp)),
    'meus_contratos_conferir', (select count(*) from vs s where s.status::text = 'contrato_conferencia_corretor' and s.id in (select id from meu_resp)),
    'meus_assinados', (select count(*) from vs s where s.status::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida') and s.id in (select id from meu_cor)),
    'minha_comissao_prevista', coalesce((select valor from minha_parte_ocorrencia), 0) + coalesce((select valor from minha_parte_venda), 0),
    'gestor_aguardando_revisao', (select count(*) from vs where status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (select count(*) from vs where status::text in ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (select count(*) from vs where status::text in ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (select count(*) from vs where status::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (select count(*) from vs where status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (select count(*) from vs where status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (select count(*) from vs where status::text = 'aguardando_assinatura'),
    'juridico_assinados', (select count(*) from vs where status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (select count(*) from vs where status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (select count(*) from vs where status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (select count(*) from vo o join vs s on s.id = o.sale_id where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'occ_concluidas_total', (select count(*) from vo o join vs s on s.id = o.sale_id where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'comissao_prevista_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from vo o
      join vs s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_concluida_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from vo o
      join vs s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_prevista_total', coalesce((
      select sum(p.valor)
      from vo o
      join vs s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_concluida_total', coalesce((
      select sum(p.valor)
      from vo o
      join vs s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_prevista_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from vo o
      join vs s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_concluida_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from vo o
      join vs s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_por_corretor', (
      select coalesce(jsonb_object_agg(user_id, total), '{}'::jsonb) from (
        select oc.user_id::text as user_id, sum(oc.valor) as total
        from voc oc
        join vo o on o.id = oc.occurrence_id
        join vs s on s.id = o.sale_id
        where s.status::text not in ('cancelada','arquivada') and oc.user_id is not null
        group by oc.user_id
      ) t
    )
  );
$function$;
revoke all on function public.dashboard_stats_leve() from public, anon;
grant execute on function public.dashboard_stats_leve() to authenticated;

-- ===================================================================================================
-- list_vendas_comerciais_paginadas (leve): mesmos filtros, ordem, página e totais. Sem cache.
-- ===================================================================================================
create or replace function public.list_vendas_comerciais_paginadas_leve(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[], _midia text DEFAULT NULL::text)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with c as materialized (select * from public.rls_leve_contexto()),
  vs as materialized (select s.* from public.sales s, c where s.organization_id = c.org and (s.id in (select unnest(c.vis) from c) or s.id in (select unnest(c.cl_leit) from c) or s.id in (select unnest(c.jur) from c) or (c.uid in (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id) and c.ativo))),
  vo as materialized (select o.* from public.occurrences o, c where o.organization_id = c.org and (c.amplo or o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))),
  vh as materialized (select h.* from public.sale_status_history h, c where h.organization_id = c.org and (c.amplo or h.sale_id in (select unnest(c.vis) from c) or h.sale_id in (select unnest(c.cl_gest) from c) or h.sale_id in (select unnest(c.jur) from c))),
  vpart as materialized (select sp.* from public.sale_parties sp, c where sp.organization_id = c.org and (c.amplo or sp.sale_id in (select unnest(c.vis) from c) or sp.sale_id in (select unnest(c.cl_edic) from c) or sp.sale_id in (select unnest(c.cl_leit) from c) or sp.sale_id in (select unnest(c.jur) from c))),
  assinaturas as (
    select o.sale_id, max(o.data_assinatura) as data_assinatura
    from vo o
    group by o.sale_id
  ), assinatura_hist as (
    -- = lateral de produção (max por venda), agregado uma vez: CTE materializada não tem índice
    select h.sale_id, (max(h.created_at) at time zone 'America/Sao_Paulo')::date as data_assinatura
    from vh h
    where h.para::text = 'contrato_assinado'
    group by h.sale_id
  ), base as (
    select
      s.id,
      s.status,
      s.valor_negociado,
      s.imovel_id,
      s.codigo_interno,
      s.corretor_captador,
      s.corretor_vendedor,
      s.updated_at,
      s.created_at,
      s.corretor_id,
      s.modalidade,
      s.data_assinatura,
      case
        when s.modalidade::text = 'lancamento' then
          coalesce(
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
        else
          coalesce(
            u.data_assinatura,
            a.data_assinatura,
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
      end as data_venda
    from vs s
    left join assinaturas a on a.sale_id = s.id
    left join assinatura_hist u on u.sale_id = s.id
    where (_status is null or s.status::text = _status)
      and (_statuses is null or s.status::text = any(_statuses))
      and (_corretor_ids is null or exists (
        -- = is_sale_corretor(x, s.id) para algum x da lista (regra de sale_corretores, sem RLS)
        select 1 from unnest(_corretor_ids) x
        where x is not null and (
             x in (s.corretor_captador_id, s.corretor_vendedor_id)
          or exists (select 1 from public.sale_commission_extras e
                     where e.sale_id = s.id and e.papel in ('corretor_captador', 'corretor_vendedor') and e.user_id = x)
          or (s.corretor_id = x and s.corretor_captador_id is null and s.corretor_vendedor_id is null
              and not exists (select 1 from public.sale_commission_extras e
                              where e.sale_id = s.id and e.papel in ('corretor_captador', 'corretor_vendedor') and e.user_id is not null)))
      ))
      and (_midia is null
        or (_midia = '__sem_midia__' and s.midia is null)
        or s.midia = _midia)
  ), filtradas as (
    select b.*
    from base b
    where b.data_venda is not null
      and (_desde is null or b.data_venda >= _desde)
      and (_ate is null or b.data_venda <= _ate)
      and (
        nullif(trim(_q), '') is null
        or b.imovel_id ilike '%' || trim(_q) || '%'
        or b.codigo_interno ilike '%' || trim(_q) || '%'
        or b.corretor_captador ilike '%' || trim(_q) || '%'
        or b.corretor_vendedor ilike '%' || trim(_q) || '%'
        or exists (
          select 1 from vs se
          where se.id = b.id
            and concat_ws(' ', se.imovel_endereco, se.imovel_logradouro, se.imovel_bairro, se.imovel_cidade, se.imovel_cep)
                ilike '%' || trim(_q) || '%'
        )
        or exists (
          select 1
          from vpart sp
          where sp.sale_id = b.id
            and sp.nome ilike '%' || trim(_q) || '%'
        )
      )
  ), pagina as (
    select f.*, public.sale_corretores_ids(f.id) as corretores_ids
    from filtradas f
    order by data_venda desc, id
    limit least(greatest(coalesce(_page_size, 10), 1), 50)
    offset greatest(coalesce(_page, 0), 0) * least(greatest(coalesce(_page_size, 10), 1), 50)
  ), totais as (
    select
      count(*)::integer as total_count,
      coalesce(sum(coalesce(valor_negociado, 0)) filter (where status::text not in ('cancelada', 'arquivada')), 0) as total_valor
    from filtradas
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.data_venda desc, p.id) from pagina p),
      '[]'::jsonb
    ),
    'total_count', totais.total_count,
    'total_valor', totais.total_valor
  )
  from totais;
$function$;
revoke all on function public.list_vendas_comerciais_paginadas_leve(integer, integer, text, text[], date, date, text, uuid[], text) from public, anon;
grant execute on function public.list_vendas_comerciais_paginadas_leve(integer, integer, text, text[], date, date, text, uuid[], text) to authenticated;

alter function public.rls_leve_contexto() owner to postgres;
alter function public.dashboard_stats_leve() owner to postgres;
alter function public.vendas_comerciais_canonicas_leve() owner to postgres;
alter function public.list_vendas_comerciais_paginadas_leve(integer, integer, text, text[], date, date, text, uuid[], text) owner to postgres;
alter function public.financeiro_distribuicao_vendas_leve() owner to postgres;
alter function public.comparativo_comissao_6pct_inconsistencias_leve() owner to postgres;

-- ===== 3) Mesmo nome de hoje vira o despachante (SECURITY INVOKER; dono e GRANTs preservados) =====
CREATE OR REPLACE FUNCTION public.dashboard_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- rls_leve: usuário logado (papel authenticated) -> versão leve; demais chamadores -> texto anterior (RLS)
  select case when current_user = 'authenticated' then public.dashboard_stats_leve()
              else public.dashboard_stats_por_rls() end
$function$;
CREATE OR REPLACE FUNCTION public.vendas_comerciais_canonicas()
 RETURNS TABLE(sale_id uuid, venda_em timestamp with time zone, data_fechamento date, modalidade text, status text, codigo_interno text, imovel_id text, corretor_id uuid, percentual_comissao numeric, valor_negociado numeric, valor_total_comissao numeric, comissao_bruta numeric, parceria_externa numeric, vgv_proprio numeric, comissao_propria numeric, occurrence_count bigint, occurrence_concluida_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  -- rls_leve: usuário logado (papel authenticated) -> versão leve; demais chamadores -> texto anterior (RLS)
  if current_user = 'authenticated' then
    return query select * from public.vendas_comerciais_canonicas_leve();
  else
    return query select * from public.vendas_comerciais_canonicas_por_rls();
  end if;
end
$function$;
CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[], _midia text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- rls_leve: usuário logado (papel authenticated) -> versão leve; demais chamadores -> texto anterior (RLS)
  select case when current_user = 'authenticated' then public.list_vendas_comerciais_paginadas_leve(_page, _page_size, _status, _statuses, _desde, _ate, _q, _corretor_ids, _midia)
              else public.list_vendas_comerciais_paginadas_por_rls(_page, _page_size, _status, _statuses, _desde, _ate, _q, _corretor_ids, _midia) end
$function$;
CREATE OR REPLACE FUNCTION public.financeiro_distribuicao_vendas()
 RETURNS TABLE(sale_id uuid, saldo_inicial_imobiliaria numeric, saldo_liquido_imobiliaria numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  -- rls_leve: usuário logado (papel authenticated) -> versão leve; demais chamadores -> texto anterior (RLS)
  if current_user = 'authenticated' then
    return query select * from public.financeiro_distribuicao_vendas_leve();
  else
    return query select * from public.financeiro_distribuicao_vendas_por_rls();
  end if;
end
$function$;
CREATE OR REPLACE FUNCTION public.comparativo_comissao_6pct_inconsistencias()
 RETURNS TABLE(sale_id uuid, codigo_interno text, modalidade text, motivo text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  -- rls_leve: usuário logado (papel authenticated) -> versão leve; demais chamadores -> texto anterior (RLS)
  if current_user = 'authenticated' then
    return query select * from public.comparativo_comissao_6pct_inconsistencias_leve();
  else
    return query select * from public.comparativo_comissao_6pct_inconsistencias_por_rls();
  end if;
end
$function$;

