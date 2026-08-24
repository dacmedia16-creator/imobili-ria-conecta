-- Impede que uma venda já avançada volte a ficar com a composição de pagamento divergente.
-- Rascunhos e etapas devolvidas continuam livres para correção gradual.

alter table public.sale_payment
  add constraint sale_payment_valores_nao_negativos check (
    coalesce(entrada_valor, 0) >= 0 and
    coalesce(parcela1_valor, 0) >= 0 and
    coalesce(parcela2_valor, 0) >= 0 and
    coalesce(pagamento_final_valor, 0) >= 0 and
    coalesce(fgts_valor, 0) >= 0 and
    coalesce(financiamento_valor, 0) >= 0 and
    coalesce(consorcio_valor, 0) >= 0
  ) not valid;

create or replace function public.status_exige_composicao_pagamento_valida(p_status public.sale_status)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status::text in (
    'aprovada_gestor', 'enviada_juridico', 'em_elaboracao_contrato',
    'contrato_conferencia_corretor', 'contrato_ok_corretor',
    'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
    'ocorrencia_analise_financeiro', 'ocorrencia_concluida'
  );
$$;

create or replace function public.bloquear_edicao_pagamento_inconsistente()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sale_id uuid;
  v_status public.sale_status;
  v_resultado jsonb;
begin
  v_sale_id := case when tg_op = 'DELETE' then old.sale_id else new.sale_id end;
  select status into v_status from public.sales where id = v_sale_id;
  if public.status_exige_composicao_pagamento_valida(v_status) then
    v_resultado := public.validar_composicao_pagamento_venda(v_sale_id);
    if not coalesce((v_resultado->>'valido')::boolean, false) then
      raise exception 'Não é possível salvar o pagamento: %', v_resultado->>'mensagem'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create constraint trigger trg_bloquear_edicao_pagamento_inconsistente
after insert or update or delete on public.sale_payment
deferrable initially immediate
for each row execute function public.bloquear_edicao_pagamento_inconsistente();

create or replace function public.bloquear_valor_negociado_inconsistente()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_resultado jsonb;
begin
  if public.status_exige_composicao_pagamento_valida(new.status) then
    v_resultado := public.validar_composicao_pagamento_venda(new.id);
    if not coalesce((v_resultado->>'valido')::boolean, false) then
      raise exception 'Não é possível alterar o valor negociado: %', v_resultado->>'mensagem'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

create constraint trigger trg_bloquear_valor_negociado_inconsistente
after update of valor_negociado on public.sales
deferrable initially immediate
for each row
when (old.valor_negociado is distinct from new.valor_negociado)
execute function public.bloquear_valor_negociado_inconsistente();

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
       'em_elaboracao_contrato', 'contrato_conferencia_gestor',
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

revoke all on function public.status_exige_composicao_pagamento_valida(public.sale_status) from public, anon;
revoke all on function public.bloquear_edicao_pagamento_inconsistente() from public, anon;
revoke all on function public.bloquear_valor_negociado_inconsistente() from public, anon;
