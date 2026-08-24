-- Toda modalidade precisa detalhar 100% do valor negociado antes de avançar.
-- Rascunhos continuam livres para preenchimento gradual; a trava ocorre na troca de etapa.

alter table public.sale_payment
  add column if not exists consorcio_valor numeric(14,2);

comment on column public.sale_payment.consorcio_valor is
  'Valor da carta de consórcio; obrigatório quando tipo_pagamento = consorcio.';

create or replace function public.validar_composicao_pagamento_venda(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_sale public.sales%rowtype;
  v_payment public.sale_payment%rowtype;
  v_tipo text;
  v_total numeric := 0;
  v_diferenca numeric := 0;
  v_mensagem text;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  select * into v_payment from public.sale_payment where sale_id = p_sale_id;
  if not found then
    return jsonb_build_object('valido', false, 'mensagem', 'Falta detalhar a forma de pagamento.');
  end if;

  if coalesce(v_sale.valor_negociado, 0) <= 0 then
    return jsonb_build_object('valido', false, 'mensagem', 'Falta informar o valor negociado.');
  end if;

  v_tipo := coalesce(v_payment.tipo_pagamento, 'vista');
  if v_tipo = 'financiamento' and coalesce(v_payment.financiamento_valor, 0) <= 0 then
    return jsonb_build_object('valido', false, 'mensagem', 'Informe o valor financiado.');
  end if;
  if v_tipo = 'consorcio' and coalesce(v_payment.consorcio_valor, 0) <= 0 then
    return jsonb_build_object('valido', false, 'mensagem', 'Informe o valor da carta de consórcio.');
  end if;

  v_total :=
    coalesce(v_payment.entrada_valor, 0) +
    coalesce(v_payment.parcela1_valor, 0) +
    coalesce(v_payment.parcela2_valor, 0) +
    coalesce(v_payment.pagamento_final_valor, 0) +
    case when coalesce(v_payment.fgts, false) then coalesce(v_payment.fgts_valor, 0) else 0 end +
    case when v_tipo = 'financiamento' then coalesce(v_payment.financiamento_valor, 0) else 0 end +
    case when v_tipo = 'consorcio' then coalesce(v_payment.consorcio_valor, 0) else 0 end;

  v_diferenca := round(v_sale.valor_negociado - v_total, 2);
  if abs(v_diferenca) <= 0.01 then
    return jsonb_build_object('valido', true, 'total', v_total, 'diferenca', v_diferenca);
  end if;

  v_mensagem := case when v_diferenca > 0 then
    'A composição do pagamento está R$ ' || to_char(v_diferenca, 'FM999G999G999G990D00') || ' abaixo do valor da venda.'
  else
    'A composição do pagamento está R$ ' || to_char(abs(v_diferenca), 'FM999G999G999G990D00') || ' acima do valor da venda.'
  end;
  return jsonb_build_object('valido', false, 'mensagem', v_mensagem, 'total', v_total, 'diferenca', v_diferenca);
end;
$function$;

revoke all on function public.validar_composicao_pagamento_venda(uuid) from public, anon;
grant execute on function public.validar_composicao_pagamento_venda(uuid) to authenticated, service_role;

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

drop trigger if exists trg_bloquear_pagamento_inconsistente on public.sales;
create trigger trg_bloquear_pagamento_inconsistente
  before update of status on public.sales
  for each row
  execute function public.bloquear_venda_com_pagamento_inconsistente();

revoke all on function public.bloquear_venda_com_pagamento_inconsistente() from public, anon;
