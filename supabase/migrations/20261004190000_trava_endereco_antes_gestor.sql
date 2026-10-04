-- Trava: venda (exceto Lançamento, que não passa pelo jurídico) só segue do corretor para o
-- gestor/jurídico com o endereço do imóvel separado completo: rua, número (aceita S/N), bairro, cidade e UF.
create or replace function public.bloquear_avanco_sem_endereco()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  faltando text[] := array[]::text[];
begin
  if new.status is not distinct from old.status then return new; end if;
  if coalesce(new.modalidade::text, '') = 'lancamento' then return new; end if;
  if old.status::text not in ('rascunho', 'devolvida_ajuste') then return new; end if;
  if new.status::text not in ('enviada_revisao', 'aprovada_gestor', 'em_elaboracao_contrato') then return new; end if;

  if nullif(trim(coalesce(new.imovel_logradouro, '')), '') is null then faltando := array_append(faltando, 'Rua'); end if;
  if nullif(trim(coalesce(new.imovel_numero, '')), '') is null then faltando := array_append(faltando, 'Número'); end if;
  if nullif(trim(coalesce(new.imovel_bairro, '')), '') is null then faltando := array_append(faltando, 'Bairro'); end if;
  if nullif(trim(coalesce(new.imovel_cidade, '')), '') is null then faltando := array_append(faltando, 'Cidade'); end if;
  if nullif(trim(coalesce(new.imovel_uf, '')), '') is null then faltando := array_append(faltando, 'UF'); end if;

  if array_length(faltando, 1) > 0 then
    raise exception 'Complete o endereço do imóvel (falta: %). Sem ele a venda não segue para o gestor e o jurídico.',
      array_to_string(faltando, ', ')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bloquear_avanco_sem_endereco on public.sales;
create trigger trg_bloquear_avanco_sem_endereco
  before update of status on public.sales
  for each row execute function public.bloquear_avanco_sem_endereco();
