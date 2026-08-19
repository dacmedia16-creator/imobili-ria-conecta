-- RPC pro relatório novo "Comissão por Coordenador" (pedido do usuário, validado por várias
-- rodadas de simulação nesta conversa). Traz as linhas brutas de occurrence_commissions das
-- ocorrências concluídas dentro do mês escolhido — o agrupamento em si (quem é coordenador de
-- quem, bloco Agentes/Team Leaders, linha "vendeu ele mesmo" etc.) fica no front-end
-- (src/lib/comissao-coordenador.ts), puro e testável, no mesmo padrão de
-- comissao-por-beneficiario.ts — não replicado em SQL pra não duplicar a lógica de negócio em
-- dois lugares.
--
-- Mês de referência: a data em que a venda entrou pela ÚLTIMA vez no status 'ocorrencia_concluida'
-- (sale_status_history.para), não `data_assinatura` (só existe pra modalidade padrão) nem
-- `updated_at` (muda por qualquer motivo). Mesma fonte que "Movimentação do período" já usa pra
-- perguntas parecidas ("quando essa venda chegou nesse status").
--
-- Acesso: financeiro/admin/super_admin — mesmo papel que já vê a Visão Executiva (onde esse
-- relatório vai morar).
create or replace function public.comissao_coordenador_dados(p_mes date)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
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
$function$;

grant execute on function public.comissao_coordenador_dados(date) to authenticated;
