-- Impede estado parcial entre "contrato assinado" e "ocorrência pendente".
-- Se a criação/validação da ocorrência falhar, toda a operação volta ao estado anterior e o
-- usuário recebe o erro real. A função reaproveita as permissões, transições, auditoria e
-- validações financeiras de change_sale_status.

create or replace function public.marcar_contrato_assinado_e_criar_ocorrencia(_sale_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.change_sale_status(_sale_id, 'contrato_assinado', null);
  perform public.change_sale_status(_sale_id, 'ocorrencia_pendente', 'Automático: contrato assinado');
end;
$function$;

revoke all on function public.marcar_contrato_assinado_e_criar_ocorrencia(uuid) from public;
grant execute on function public.marcar_contrato_assinado_e_criar_ocorrencia(uuid) to authenticated;

