-- t_f9a40158 (Denis 19/10, tópico 6238, opção B): SÓ o painel inicial (dashboard_stats) fica leve.
-- Substitui a parte do painel da migration 20261019140000 (PR #126, não aplicada). NÃO mexe em
-- vendas_comerciais_canonicas, list_vendas_comerciais_paginadas, financeiro_distribuicao_vendas,
-- comparativo_comissao_6pct_inconsistencias, policies nem helpers compartilhados (só os LÊ).
-- Funções novas, de uso exclusivo do painel: dashboard_stats_por_rls (texto de produção intacto),
-- dashboard_stats_leve_contexto (sem GRANT a usuários) e dashboard_stats_leve.
-- O QUE NÃO MUDA: o jsonb devolvido (mesmas fórmulas), dono e GRANTs de dashboard_stats; quem não é o usuário
-- logado (service_role, relatórios SECURITY DEFINER) segue no texto anterior. Sem cache.
-- Desfazer: supabase/rollback/20261019153000_rls_leve_dashboard_stats.sql
select set_config('lock_timeout', '5s', true);

do $g$
declare _sp text := current_setting('search_path');
begin
  perform set_config('search_path', 'public', true);
  if exists (select 1 from pg_proc where oid = 'public.dashboard_stats()'::regprocedure and prosrc like '%dashboard_stats_leve%') then
    raise notice 'rls_leve_dashboard: já aplicada antes (reaplicando o mesmo texto)';
  elsif md5((select prosrc from pg_proc where oid = 'public.dashboard_stats()'::regprocedure)) <> '8f17263275432242ddacd7e9494f0adf' then
    raise exception 'rls_leve_dashboard: dashboard_stats diverge do texto conferido em produção em 19/10; gere a migration de novo';
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
  if (select md5(string_agg(tablename||'.'||policyname||'|'||cmd||'|'||permissive||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' order by tablename, policyname)) from pg_policies where schemaname='public' and tablename in ('sales','occurrences','occurrence_partners','occurrence_commissions','sale_status_history','venda_distribuicao','sale_commission_extras','sale_parties') and cmd in ('SELECT','ALL')) <> '480305b9925b8f9565897807cf72c42e' then
    raise exception 'rls_leve: policies de leitura das tabelas de venda mudaram desde 19/10; gere a migration de novo';
  end if;
  perform set_config('search_path', _sp, true);
end $g$;

-- ===== 1) Caminho anterior: texto de PRODUÇÃO intacto, só renomeado =====
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

-- ===== 2) Versão leve (SECURITY DEFINER, search_path vazio, checagem de usuário e imobiliária) =====
-- Contexto de permissão do PAINEL, calculado UMA vez por chamada com as mesmas funções das policies.
-- Sem GRANT para usuários; só dashboard_stats_leve (mesmo dono) a chama.
create or replace function public.dashboard_stats_leve_contexto(
  out uid uuid, out org uuid, out ativo boolean, out amplo boolean,
  out vis uuid[], out cl_leit uuid[], out cl_edic uuid[], out jur uuid[])
language plpgsql stable security definer set search_path to ''
as $function$
begin
  uid := auth.uid();
  org := public.current_org_id();
  ativo := false; amplo := false;
  vis := '{}'; cl_leit := '{}'; cl_edic := '{}'; jur := '{}';
  -- checagem explícita: sem usuário ou sem imobiliária no contexto, nada é visível
  if uid is null or org is null then
    org := null;
    return;
  end if;
  ativo := coalesce(public.is_active_user(uid), false);
  amplo := coalesce(public.has_any_role(uid, array['financeiro','admin','super_admin']::public.app_role[]), false);
  vis := array(select public.vendas_visiveis_ids());
  cl_leit := array(select public.vendas_coleader_leitura_ids());
  -- cl_edic só é usado no painel junto com "amplo or ...": para acesso amplo fica vazio (mesmo resultado, sem custo)
  if not amplo then
    cl_edic := array(select public.vendas_coleader_edicao_ids());
  end if;
  jur := array(select public.vendas_juridico_certidao_ids());
end $function$;
revoke all on function public.dashboard_stats_leve_contexto() from public, anon, authenticated;

create or replace function public.dashboard_stats_leve()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with c as materialized (select * from public.dashboard_stats_leve_contexto()),
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

alter function public.dashboard_stats_leve_contexto() owner to postgres;
alter function public.dashboard_stats_leve() owner to postgres;

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
