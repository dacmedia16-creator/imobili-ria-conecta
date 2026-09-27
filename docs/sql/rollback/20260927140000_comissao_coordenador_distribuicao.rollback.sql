-- Rollback do grupo 3: definição implantada antes (pg_get_functiondef em 27/09/2026).
-- args: p_mes date
CREATE OR REPLACE FUNCTION public.comissao_coordenador_dados(p_mes date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with concl as (
    select distinct on (h.sale_id) h.sale_id, h.created_at as concluida_em
    from sale_status_history h
    where h.para::text = 'ocorrencia_concluida'
    order by h.sale_id, h.created_at desc
  ),
  occs as (
    select o.id as occurrence_id, s.modalidade::text as modalidade
    from occurrences o
    join sales s on s.id = o.sale_id
    join concl c on c.sale_id = s.id
    where o.status = 'concluida'
      and s.status::text not in ('cancelada', 'arquivada')
      and c.concluida_em >= p_mes
      and c.concluida_em < p_mes + interval '1 month'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrence_id', oc.occurrence_id,
    'modalidade', occs.modalidade,
    'papel', oc.papel,
    'user_id', oc.user_id,
    'nome', p.nome,
    'valor', oc.valor,
    'sem_cadastro_confirmado', coalesce(oc.sem_cadastro_confirmado, false)
  )), '[]'::jsonb)
  from occurrence_commissions oc
  join occs on occs.occurrence_id = oc.occurrence_id
  left join profiles p on p.id = oc.user_id
  where has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$function$
;
