-- t_e68bebaf (aprovado por Denis 12/10, tópico 6238): Início mais rápido.
-- dashboard_stats() lia sales e occurrences ~39 vezes; cada leitura reavaliava as regras de acesso (RLS) por
-- linha — com gestor/team leader passava de 3 s e estourava o limite de 8 s no 1º carregamento (erro 500).
-- Agora cada tabela é lida UMA vez (CTE materialized vs/vo) e as contagens reaproveitam essa leitura.
-- A LÓGICA NÃO MUDA: mesmo nome, assinatura, retorno jsonb, SECURITY INVOKER, STABLE, search_path e GRANTs;
-- as mesmas regras de acesso continuam valendo (a leitura única é feita como o próprio usuário).
-- Conferido em produção (transação desfeita) e homologação: jsonb idêntico para todos os cargos/organizações.
-- Só troca se o texto atual for o conferido em produção (ou já o novo). Desfazer: supabase/rollback/20261012220000_dashboard_stats_le_uma_vez.sql
select set_config('lock_timeout', '5s', true);
do $g$ begin
  if md5((select prosrc from pg_proc where oid = 'public.dashboard_stats()'::regprocedure)) = '8f17263275432242ddacd7e9494f0adf' then
    raise notice 'public.dashboard_stats(): já está na versão otimizada';
  elsif md5((select prosrc from pg_proc where oid = 'public.dashboard_stats()'::regprocedure)) <> '9185ad948c467785f4750777ebefcd9a' then
    raise exception 'public.dashboard_stats() diverge da versão conferida em produção; gere o SQL de novo';
  end if;
end $g$;

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
$function$;

-- Permissões iguais às de antes (CREATE OR REPLACE preserva; reafirmadas por segurança).
revoke all on function public.dashboard_stats() from public, anon;
grant execute on function public.dashboard_stats() to authenticated, service_role;
