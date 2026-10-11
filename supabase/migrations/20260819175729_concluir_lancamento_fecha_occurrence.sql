-- Bug encontrado enquanto o usuário conferia um relatório novo (comissão por coordenador): pra
-- venda de modalidade padrão, o botão "Confirmar e finalizar ocorrência" (vendas.$id.tsx,
-- doFinalizar) sempre atualiza DOIS campos juntos, na mesma ação — occurrences.status = 'concluida'
-- E sales.status = 'ocorrencia_concluida'. Mas concluir_lancamento() (usada só por vendas de
-- Lançamento, quando o financeiro confirma o saldo) só atualizava sales.status — nunca tocava em
-- occurrences.status, que ficava travado em 'pendente' pra sempre.
--
-- Impacto real, confirmado em produção antes desta migration: as 4 vendas de Lançamento já
-- concluídas pelo financeiro (sales.status = 'ocorrencia_concluida') continuavam contando como
-- "prevista" em TODO lugar que lê occurrences.status = 'concluida' — dashboard_stats()
-- ('comissao_concluida_total', 'liquido_imobiliaria_prevista_total'/'concluida_total') e, por
-- consequência, os cards "Comissão concluída"/"Líquido da imobiliária" no Dashboard e na Visão
-- Executiva. Nunca migravam de prevista pra concluída, mesmo com o saldo já confirmado.
--
-- Esta migration:
-- 1) corrige concluir_lancamento() pra atualizar occurrences.status junto com sales.status, igual
--    ao fluxo padrão (mesma ordem: occurrence primeiro, sale depois);
-- 2) corrige retroativamente as ocorrências já travadas por esse bug (sales já concluídas cujo
--    occurrences.status ainda não refletia isso).
--
-- Não existe hoje nenhuma RPC de "reabrir"/"devolver" ocorrência de Lançamento em produção (só a de
-- modalidade padrão, em vendas.$id.tsx) — não há caminho simétrico de reabertura pra corrigir aqui.

create or replace function public.concluir_lancamento(p_sale_id uuid, p_saldo_confirmado numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype;
  v_dist jsonb;
  v_saldo numeric;
begin
  if not public.can_view_sale(auth.uid(), p_sale_id) then
    raise exception 'Sem permissão para acessar esta venda.' using errcode = '42501';
  end if;

  if not public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]) then
    raise exception 'Apenas o financeiro pode concluir a ocorrência.' using errcode = '42501';
  end if;

  -- FOR UPDATE: mesma trava de salvar_divisao_comissao_lancamento() — ver comentário lá.
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.modalidade <> 'lancamento' then
    raise exception 'Esta venda não é uma venda de Lançamento.' using errcode = '23514';
  end if;

  if v_sale.status::text <> 'ocorrencia_analise_financeiro' then
    raise exception 'Esta venda não está em análise do financeiro.' using errcode = '23505';
  end if;

  v_dist := public.calcular_distribuicao_venda(p_sale_id);
  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível concluir este lançamento: %', (
      select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
    ) using errcode = '23514';
  end if;

  v_saldo := (v_dist->>'saldo_imobiliaria')::numeric;
  if p_saldo_confirmado is null or abs(p_saldo_confirmado - v_saldo) > 0.01 then
    raise exception 'O saldo confirmado (R$ %) não corresponde ao saldo calculado agora (R$ %) — recarregue a página e confirme novamente.',
      round(coalesce(p_saldo_confirmado, 0), 2), round(v_saldo, 2)
      using errcode = '23514';
  end if;

  -- Mesmo par de updates do fluxo padrão (vendas.$id.tsx doFinalizar): occurrence primeiro, sale
  -- depois — os dois campos nunca podem divergir, é a raiz do bug corrigido nesta migration.
  update occurrences set status = 'concluida' where sale_id = p_sale_id;

  update sales set
    status = 'ocorrencia_concluida',
    lancamento_saldo_imobiliaria = v_saldo,
    lancamento_saldo_confirmado_em = now(),
    lancamento_saldo_confirmado_por = auth.uid()
  where id = p_sale_id;

  insert into sale_status_history (sale_id, de, para, autor_id, motivo)
  values (p_sale_id, v_sale.status, 'ocorrencia_concluida'::sale_status, auth.uid(),
    'Saldo da imobiliária/construtora confirmado: R$ ' || round(v_saldo, 2));

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'status_change', jsonb_build_object('de', v_sale.status, 'para', 'ocorrencia_concluida'));

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'lancamento_concluido', jsonb_build_object(
    'comissao_bruta', v_dist->'comissao_bruta',
    'total_pessoas', v_dist->'total_pessoas',
    'parceria_externa', v_dist->'parceria_externa',
    'saldo_imobiliaria', v_saldo
  ));

  return public.calcular_distribuicao_venda(p_sale_id);
end;
$function$;

-- Backfill: corrige retroativamente as ocorrências de Lançamento já concluídas pelo financeiro
-- antes desta migration existir, que ficaram travadas em occurrences.status = 'pendente'.
update occurrences o
set status = 'concluida'
from sales s
where s.id = o.sale_id
  and s.modalidade = 'lancamento'
  and s.status::text = 'ocorrencia_concluida'
  and o.status <> 'concluida';
