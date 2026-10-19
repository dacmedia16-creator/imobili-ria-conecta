-- DESFAZER da migration 20261019140000_rls_leve_painel_vendas_financeiro (t_f8b87dd1).
-- Volta as 5 funções EXATAMENTE ao texto que estava em produção em 19/10/2026 (lido com pg_get_functiondef,
-- somente leitura) e apaga as funções novas (*_leve, *_por_rls, rls_leve_contexto) criadas pela migration. Não mexe em dados, tabelas nem policies.
-- CREATE OR REPLACE mantém dono e permissões (GRANT) das funções originais. Idempotente.
-- Este arquivo também é a FONTE do caminho antigo dentro da migration (gerar_migration.py lê daqui).
begin;
select set_config('lock_timeout', '5s', true);

-- >>> dashboard_stats (produção, md5 pg_get_functiondef 08981316557da1801f85e7d4efd99f8f)
CREATE OR REPLACE FUNCTION public.dashboard_stats()
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

-- >>> vendas_comerciais_canonicas (produção, md5 pg_get_functiondef 4dd27dfd65cbc55ce0a243ff55ad14ce)
CREATE OR REPLACE FUNCTION public.vendas_comerciais_canonicas()
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

-- >>> list_vendas_comerciais_paginadas (produção, md5 pg_get_functiondef 705357ff174d9a572881a57e1678e96b)
CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[], _midia text DEFAULT NULL::text)
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

-- >>> financeiro_distribuicao_vendas (produção, md5 pg_get_functiondef 71b1c578863cbdb711dab02e166db6cb)
CREATE OR REPLACE FUNCTION public.financeiro_distribuicao_vendas()
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

-- >>> comparativo_comissao_6pct_inconsistencias (produção, md5 pg_get_functiondef b5764149f09dc7fa63940828aa83012d)
CREATE OR REPLACE FUNCTION public.comparativo_comissao_6pct_inconsistencias()
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

drop function if exists public.dashboard_stats_leve();
drop function if exists public.vendas_comerciais_canonicas_leve();
drop function if exists public.list_vendas_comerciais_paginadas_leve(integer, integer, text, text[], date, date, text, uuid[], text);
drop function if exists public.financeiro_distribuicao_vendas_leve();
drop function if exists public.comparativo_comissao_6pct_inconsistencias_leve();
drop function if exists public.rls_leve_contexto();
drop function if exists public.dashboard_stats_por_rls();
drop function if exists public.vendas_comerciais_canonicas_por_rls();
drop function if exists public.list_vendas_comerciais_paginadas_por_rls(integer, integer, text, text[], date, date, text, uuid[], text);
drop function if exists public.financeiro_distribuicao_vendas_por_rls();
drop function if exists public.comparativo_comissao_6pct_inconsistencias_por_rls();
commit;
