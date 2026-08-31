-- Quando o Financeiro devolve a ocorrência, a etapa volta a ser do gestor.
-- A trava de aceite financeiro não pode sobreviver à devolução, senão o status diz
-- "devolvida ao gestor" enquanto Resumo/Partes/Pagamento/Ocorrência continuam somente leitura.
--
-- Trigger no banco (e não só na tela) para cobrir change_sale_status e qualquer outro
-- cliente autorizado que faça a mesma transição. Tudo ocorre na mesma transação.

create or replace function public.destravar_ocorrencia_ao_devolver_gestor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status::text = 'ocorrencia_devolvida_gestor'
     and old.status::text is distinct from new.status::text then
    update public.occurrences
    set aceita_financeiro = false,
        aceita_financeiro_em = null,
        aceita_financeiro_por = null
    where sale_id = new.id
      and (
        aceita_financeiro = true
        or aceita_financeiro_em is not null
        or aceita_financeiro_por is not null
      );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_destravar_ocorrencia_ao_devolver_gestor on public.sales;
create trigger trg_destravar_ocorrencia_ao_devolver_gestor
after update of status on public.sales
for each row
execute function public.destravar_ocorrencia_ao_devolver_gestor();

-- Corrige também eventual ocorrência que já esteja devolvida e tenha herdado a trava antiga.
update public.occurrences o
set aceita_financeiro = false,
    aceita_financeiro_em = null,
    aceita_financeiro_por = null
from public.sales s
where s.id = o.sale_id
  and s.status::text = 'ocorrencia_devolvida_gestor'
  and (
    o.aceita_financeiro = true
    or o.aceita_financeiro_em is not null
    or o.aceita_financeiro_por is not null
  );

comment on function public.destravar_ocorrencia_ao_devolver_gestor() is
  'Remove atomicamente a trava do Financeiro quando a ocorrência é devolvida ao gestor.';
