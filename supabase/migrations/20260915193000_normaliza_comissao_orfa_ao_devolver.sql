-- Ao devolver uma ocorrência ao gestor, remove somente valores de comissão
-- que não possuem beneficiário vinculado. Esses resíduos antigos deixavam a
-- distribuição negativa e faziam sync_occurrence_commissions falhar com 23514.
-- Participantes válidos (com user_id) e comissões de captador/vendedor não são alterados.

create or replace function public.destravar_ocorrencia_ao_devolver_gestor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status::text = 'ocorrencia_devolvida_gestor'
     and old.status::text is distinct from new.status::text then
    update public.sales
    set indicador_captador = case when indicador_captador_id is null then null else indicador_captador end,
        indicador_captador_id = case when indicador_captador_id is null then null else indicador_captador_id end,
        valor_comissao_indicador_captador = case when indicador_captador_id is null then null else valor_comissao_indicador_captador end,
        indicador_vendedor = case when indicador_vendedor_id is null then null else indicador_vendedor end,
        indicador_vendedor_id = case when indicador_vendedor_id is null then null else indicador_vendedor_id end,
        valor_comissao_indicador_vendedor = case when indicador_vendedor_id is null then null else valor_comissao_indicador_vendedor end,
        lider_captador_nome = case when lider_captador_id is null then null else lider_captador_nome end,
        valor_comissao_lider_captador = case when lider_captador_id is null then null else valor_comissao_lider_captador end,
        lider_vendedor_nome = case when lider_vendedor_id is null then null else lider_vendedor_nome end,
        valor_comissao_lider_vendedor = case when lider_vendedor_id is null then null else valor_comissao_lider_vendedor end
    where id = new.id
      and (
        (indicador_captador_id is null and (indicador_captador is not null or valor_comissao_indicador_captador is not null))
        or (indicador_vendedor_id is null and (indicador_vendedor is not null or valor_comissao_indicador_vendedor is not null))
        or (lider_captador_id is null and (lider_captador_nome is not null or valor_comissao_lider_captador is not null))
        or (lider_vendedor_id is null and (lider_vendedor_nome is not null or valor_comissao_lider_vendedor is not null))
      );

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

comment on function public.destravar_ocorrencia_ao_devolver_gestor() is
  'Remove a trava financeira e normaliza comissões de indicador/líder sem vínculo ao devolver a ocorrência ao gestor.';
