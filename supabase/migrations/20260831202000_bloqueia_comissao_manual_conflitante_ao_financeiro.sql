-- Impede que uma comissão manual antiga/duplicada siga silenciosamente para o Financeiro.
-- Linhas manuais continuam permitidas e preservadas, mas o envio é bloqueado quando:
-- 1) a linha é órfã (sem usuário e sem confirmação explícita de parceiro externo); ou
-- 2) ela aponta para o mesmo beneficiário de uma linha oficial gerenciada pela venda.
--
-- A validação fica no backend (change_sale_status), cobrindo todos os botões/clientes.

create or replace function public.change_sale_status(_sale_id uuid, _new_status text, _motivo text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _prev_status text;
  _occ_id uuid;
  _conflito record;
begin
  if not public.can_view_sale(auth.uid(), _sale_id) then
    raise exception 'Sem permissão para acessar esta venda.';
  end if;

  select status::text into _prev_status
  from public.sales
  where id = _sale_id
  for update;

  if _prev_status is null then
    raise exception 'Venda não encontrada.';
  end if;

  if _new_status in ('cancelada', 'arquivada') and nullif(btrim(_motivo), '') is null then
    raise exception 'Informe o motivo para cancelar ou arquivar a venda.' using errcode = '23514';
  end if;

  if _new_status in ('ocorrencia_pendente', 'ocorrencia_analise_financeiro') then
    perform public.criar_ocorrencia_completa(_sale_id);
  end if;

  if _new_status = 'ocorrencia_analise_financeiro' then
    select id into _occ_id from public.occurrences where sale_id = _sale_id;

    select m.id, m.papel, m.nome, m.valor
    into _conflito
    from public.occurrence_commissions m
    where m.occurrence_id = _occ_id
      and m.managed_by_sale = false
      and m.user_id is null
      and coalesce(m.sem_cadastro_confirmado, false) = false
    limit 1;

    if found then
      raise exception 'Existe uma comissão manual incompleta na Ocorrência (% / %). Exclua-a ou escolha explicitamente o beneficiário antes de enviar ao Financeiro.',
        coalesce(_conflito.papel, 'sem papel'),
        coalesce(_conflito.valor::text, 'sem valor')
        using errcode = '23514';
    end if;

    select m.id, m.papel, m.nome, m.valor
    into _conflito
    from public.occurrence_commissions m
    join public.occurrence_commissions o
      on o.occurrence_id = m.occurrence_id
     and o.managed_by_sale = true
     and (
       (m.user_id is not null and o.user_id = m.user_id)
       or (
         nullif(btrim(m.nome), '') is not null
         and lower(btrim(o.nome)) = lower(btrim(m.nome))
       )
     )
    where m.occurrence_id = _occ_id
      and m.managed_by_sale = false
    limit 1;

    if found then
      raise exception 'Existe uma comissão manual duplicando um beneficiário da divisão oficial (% / %). Revise ou exclua a linha manual antes de enviar ao Financeiro.',
        coalesce(_conflito.nome, _conflito.papel, 'sem identificação'),
        coalesce(_conflito.valor::text, 'sem valor')
        using errcode = '23514';
    end if;
  end if;

  update public.sales set status = _new_status::sale_status where id = _sale_id;

  insert into public.sale_status_history (sale_id, de, para, autor_id, motivo)
  values (_sale_id, _prev_status::sale_status, _new_status::sale_status, auth.uid(), _motivo);

  insert into public.activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), _sale_id, 'status_change', jsonb_build_object('de', _prev_status, 'para', _new_status, 'motivo', _motivo));
end;
$function$;

comment on function public.change_sale_status(uuid, text, text) is
  'Altera o status atomicamente; antes do envio ao Financeiro bloqueia comissão manual órfã ou duplicada com a divisão oficial.';
