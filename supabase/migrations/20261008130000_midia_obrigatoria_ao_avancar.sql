-- Mídia obrigatória para a venda avançar (reunião de gestores 08/10, item 11).
-- O rascunho continua podendo ser salvo sem mídia; a trava só vale na troca de status.
-- Nenhum dado existente é alterado.
--
-- Regra 1 (venda): saindo de rascunho/devolvida_ajuste para qualquer etapa seguinte (enviar ao
--   gestor, direto ao jurídico ou, no Lançamento, ao financeiro) exige sales.midia preenchida.
--   Arquivar/cancelar continua livre.
-- Regra 2 (ocorrência): enviar a ocorrência ao financeiro (status ocorrencia_analise_financeiro)
--   exige occurrences.midia preenchida. Pega as vendas antigas que já passaram do rascunho sem
--   mídia: o gestor preenche a Mídia na aba Ocorrência antes de enviar. Reabertura de ocorrência
--   já concluída não é bloqueada.
create or replace function public.bloquear_avanco_sem_midia()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then return new; end if;

  if old.status::text in ('rascunho', 'devolvida_ajuste')
     and new.status::text not in ('rascunho', 'devolvida_ajuste', 'arquivada', 'cancelada')
     and nullif(trim(coalesce(new.midia, '')), '') is null then
    raise exception 'Informe a Mídia da venda (de onde veio o cliente) antes de enviar. Sem ela a venda não sai do rascunho.'
      using errcode = 'check_violation';
  end if;

  -- Reabrir uma ocorrência concluída (correção do financeiro) não é envio novo: não trava.
  if new.status::text = 'ocorrencia_analise_financeiro'
     and old.status::text <> 'ocorrencia_concluida'
     and exists (
       select 1 from public.occurrences o
       where o.sale_id = new.id and nullif(trim(coalesce(o.midia, '')), '') is null
     ) then
    raise exception 'Informe a Mídia na Ocorrência (de onde veio o cliente) antes de enviar ao financeiro.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.bloquear_avanco_sem_midia() from public, anon;

-- Nome "trg_bloquear_avanco_a_..." para rodar antes dos outros gatilhos de avanço (ordem alfabética):
-- quem preenche vê primeiro a mensagem da Mídia, que é a correção mais simples.
drop trigger if exists trg_bloquear_avanco_a_midia on public.sales;
create trigger trg_bloquear_avanco_a_midia
  before update of status on public.sales
  for each row execute function public.bloquear_avanco_sem_midia();
