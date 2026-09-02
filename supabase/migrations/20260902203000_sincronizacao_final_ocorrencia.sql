-- Sincronização final e transacional da ocorrência padrão antes de chegar ao Financeiro.
-- A venda/Resumo é a fonte dos dados comerciais; sale_payment é a fonte do financiamento;
-- campos manuais e bancários preenchidos diretamente pelo Financeiro são preservados.

create or replace function public.sincronizar_ocorrencia_antes_financeiro(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sale public.sales%rowtype;
  v_payment public.sale_payment%rowtype;
  v_occ_id uuid;
begin
  select * into v_sale
  from public.sales
  where id = p_sale_id;

  if not found
     or v_sale.modalidade = 'lancamento'
     or v_sale.status::text not in (
       'aguardando_assinatura',
       'contrato_assinado',
       'ocorrencia_pendente',
       'ocorrencia_devolvida_gestor'
     ) then
    return;
  end if;

  select id into v_occ_id
  from public.occurrences
  where sale_id = p_sale_id
    and status = 'pendente';

  if v_occ_id is null then
    return;
  end if;

  select * into v_payment
  from public.sale_payment
  where sale_id = p_sale_id;

  update public.occurrences
  set
    valor_anunciado = v_sale.valor_anunciado,
    valor_negociado = v_sale.valor_negociado,
    percentual_comissao = v_sale.percentual_comissao,
    valor_comissao = coalesce(
      v_sale.valor_total_comissao,
      case
        when v_sale.valor_negociado is not null and v_sale.percentual_comissao is not null
          then round(v_sale.valor_negociado * v_sale.percentual_comissao / 100, 2)
        else null
      end
    ),
    prev_recebimento_valor = v_sale.previsao_recebimento_valor,
    prev_recebimento_data = v_sale.previsao_recebimento_data,
    prev_recebimento_forma = v_sale.previsao_recebimento_forma,
    prev_recebimento2_valor = v_sale.previsao_recebimento2_valor,
    prev_recebimento2_data = v_sale.previsao_recebimento2_data,
    prev_recebimento2_forma = v_sale.previsao_recebimento2_forma,
    prev_recebimento3_valor = v_sale.previsao_recebimento3_valor,
    prev_recebimento3_data = v_sale.previsao_recebimento3_data,
    prev_recebimento3_forma = v_sale.previsao_recebimento3_forma,
    financiamento = coalesce(v_payment.financiamento, false),
    financiamento_valor = v_payment.financiamento_valor,
    financiamento_banco = v_payment.financiamento_banco,
    financiamento_correspondente = v_payment.financiamento_correspondente,
    financiamento_previsao = v_payment.financiamento_previsao,
    oba_credito = coalesce(v_payment.oba_credito, false)
  where id = v_occ_id;

  perform public.sync_occurrence_commissions(p_sale_id);

  if v_sale.parceria_tipo is null then
    delete from public.occurrence_partners
    where occurrence_id = v_occ_id
      and from_sale = true;
  else
    update public.occurrence_partners
    set
      tipo = v_sale.parceria_tipo,
      nome = v_sale.parceria_nome,
      cpf_cnpj = v_sale.parceria_cpf_cnpj,
      percentual = v_sale.parceria_percentual,
      valor = v_sale.parceria_valor
    where occurrence_id = v_occ_id
      and from_sale = true;

    if not found then
      insert into public.occurrence_partners (
        occurrence_id, from_sale, tipo, nome, cpf_cnpj, percentual, valor,
        banco, agencia, conta, pix
      ) values (
        v_occ_id, true, v_sale.parceria_tipo, v_sale.parceria_nome,
        v_sale.parceria_cpf_cnpj, v_sale.parceria_percentual, v_sale.parceria_valor,
        v_sale.parceria_banco, v_sale.parceria_agencia, v_sale.parceria_conta,
        v_sale.parceria_pix
      );
    end if;
  end if;
end;
$function$;

comment on function public.sincronizar_ocorrencia_antes_financeiro(uuid) is
  'Sincroniza de forma transacional os dados comerciais da ocorrência padrão antes do Financeiro, preservando campos manuais.';

revoke all on function public.sincronizar_ocorrencia_antes_financeiro(uuid)
  from public, anon, authenticated;

-- Substitui o gatilho amplo anterior. Depois que a ocorrência chega ao Financeiro,
-- alterações na venda não podem sobrescrever a base que ele está conferindo.
create or replace function public.trg_sincronizar_financeiro_ocorrencia_da_venda()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.sincronizar_ocorrencia_antes_financeiro(new.id);
  return new;
end;
$function$;

drop trigger if exists trg_sales_sync_financeiro_ocorrencia on public.sales;
drop trigger if exists trg_sales_sync_previsao_ocorrencia_pendente on public.sales;
drop trigger if exists trg_sales_sync_antes_financeiro on public.sales;
create trigger trg_sales_sync_antes_financeiro
after update of
  valor_anunciado, valor_negociado, percentual_comissao, valor_total_comissao,
  valor_comissao_captador, valor_comissao_vendedor,
  valor_comissao_indicador_captador, valor_comissao_indicador_vendedor,
  valor_comissao_lider_captador, valor_comissao_lider_vendedor,
  parceria_tipo, parceria_nome, parceria_cpf_cnpj, parceria_percentual, parceria_valor,
  percentual_remax, valor_remax,
  previsao_recebimento_valor, previsao_recebimento_data, previsao_recebimento_forma,
  previsao_recebimento2_valor, previsao_recebimento2_data, previsao_recebimento2_forma,
  previsao_recebimento3_valor, previsao_recebimento3_data, previsao_recebimento3_forma
on public.sales
for each row
when (old is distinct from new)
execute function public.trg_sincronizar_financeiro_ocorrencia_da_venda();

create or replace function public.trg_sale_payment_sync_ocorrencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.sincronizar_ocorrencia_antes_financeiro(coalesce(new.sale_id, old.sale_id));
  return null;
end;
$function$;

drop trigger if exists trg_sale_payment_sync_ocorrencia on public.sale_payment;
create trigger trg_sale_payment_sync_ocorrencia
after insert or update or delete on public.sale_payment
for each row execute function public.trg_sale_payment_sync_ocorrencia();

create or replace function public.trg_sale_commission_extras_sync_ocorrencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.sincronizar_ocorrencia_antes_financeiro(coalesce(new.sale_id, old.sale_id));
  return null;
end;
$function$;

drop trigger if exists trg_sale_commission_extras_sync_ocorrencia on public.sale_commission_extras;
create trigger trg_sale_commission_extras_sync_ocorrencia
after insert or update or delete on public.sale_commission_extras
for each row execute function public.trg_sale_commission_extras_sync_ocorrencia();

-- Último gate: mesmo se uma atualização incremental tiver falhado antes, a transição ao
-- Financeiro refaz toda a sincronização dentro da mesma transação.
create or replace function public.trg_sales_sync_antes_financeiro()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status::text = 'ocorrencia_analise_financeiro'
     and old.status::text is distinct from new.status::text then
    perform public.sincronizar_ocorrencia_antes_financeiro(old.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sales_sync_antes_financeiro_status on public.sales;
create trigger trg_sales_sync_antes_financeiro_status
before update of status on public.sales
for each row execute function public.trg_sales_sync_antes_financeiro();

-- Uma ocorrência pode ter no máximo uma parceria originada da venda. Dados bancários
-- continuam pertencendo à ocorrência e não participam da sincronização posterior.
create unique index if not exists occurrence_partners_one_from_sale_per_occurrence
  on public.occurrence_partners (occurrence_id)
  where from_sale = true;

-- Alinha todas as ocorrências padrão que ainda não chegaram ao Financeiro.
do $function$
declare
  v_sale_id uuid;
begin
  for v_sale_id in
    select s.id
    from public.sales s
    join public.occurrences o on o.sale_id = s.id
    where s.modalidade = 'padrao'
      and s.status::text in (
        'aguardando_assinatura', 'contrato_assinado',
        'ocorrencia_pendente', 'ocorrencia_devolvida_gestor'
      )
      and o.status = 'pendente'
  loop
    perform public.sincronizar_ocorrencia_antes_financeiro(v_sale_id);
  end loop;
end;
$function$;

-- Repara somente linhas declaradas como gerenciadas pela venda que ficaram antigas antes
-- desta proteção. Linhas manuais do Financeiro (managed_by_sale = false) não são tocadas.
do $function$
declare
  v_sale_id uuid;
begin
  for v_sale_id in
    select distinct s.id
    from public.sales s
    join public.occurrences o on o.sale_id = s.id
    join public.sale_commission_extras e on e.sale_id = s.id
    left join public.occurrence_commissions c
      on c.occurrence_id = o.id
     and c.sale_commission_extra_id = e.id
     and c.managed_by_sale = true
    where s.modalidade = 'padrao'
      and (
        c.id is null
        or c.nome is distinct from e.nome
        or c.valor is distinct from e.valor
        or c.user_id is distinct from coalesce(
          e.user_id,
          case e.papel
            when 'gestor' then s.coordenador_id
            when 'team_leader' then s.team_leader_id
            else null
          end
        )
      )
  loop
    perform public.sync_occurrence_commissions(v_sale_id);
  end loop;
end;
$function$;
