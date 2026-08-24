-- Reversão da migration 20260824110000. Não altera dados.
drop trigger if exists trg_bloquear_valor_negociado_inconsistente on public.sales;
drop trigger if exists trg_bloquear_edicao_pagamento_inconsistente on public.sale_payment;
drop function if exists public.bloquear_valor_negociado_inconsistente();
drop function if exists public.bloquear_edicao_pagamento_inconsistente();
drop function if exists public.status_exige_composicao_pagamento_valida(public.sale_status);
alter table public.sale_payment drop constraint if exists sale_payment_valores_nao_negativos;

create or replace function public.bloquear_venda_com_pagamento_inconsistente()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_resultado jsonb;
begin
  if old.status is distinct from new.status
     and new.status::text in (
       'enviada_revisao', 'aprovada_gestor', 'enviada_juridico',
       'contrato_conferencia_corretor', 'contrato_ok_corretor',
       'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
       'ocorrencia_analise_financeiro', 'ocorrencia_concluida'
     ) then
    v_resultado := public.validar_composicao_pagamento_venda(new.id);
    if not coalesce((v_resultado->>'valido')::boolean, false) then
      raise exception 'Não é possível avançar a venda: %', v_resultado->>'mensagem'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;
