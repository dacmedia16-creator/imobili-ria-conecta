-- Quando uma ocorrência devolvida volta ao Financeiro, preserve a correção feita
-- pelo gestor diretamente na Ocorrência. Durante a devolução, alterações feitas
-- na Resumo continuam sincronizando a ocorrência pelo trigger de campos da venda.
-- O problema era o trigger de mudança de status: ao reenviar, ele copiava os campos
-- antigos de sales por cima da Ocorrência recém-corrigida.

create or replace function public.trg_sales_sync_antes_financeiro()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status::text = 'ocorrencia_analise_financeiro'
     and old.status::text is distinct from new.status::text
     and old.status::text <> 'ocorrencia_devolvida_gestor' then
    perform public.sincronizar_ocorrencia_antes_financeiro(old.id);
  end if;
  return new;
end;
$function$;

comment on function public.trg_sales_sync_antes_financeiro() is
  'Sincroniza antes do Financeiro, mas preserva os campos corrigidos diretamente na Ocorrência quando o reenvio vem de devolvida ao gestor.';
