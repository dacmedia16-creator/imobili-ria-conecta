-- Rollback da migration 20261104160000_comissao_analise_financeiro_sync (t_59cb12e0).
-- Restaura exatamente a definição anterior do gatilho (copiada de produção em 04/11/2026; md5 do
-- pg_get_functiondef = bb7d43e20987efc900fb1460be9ba250) e remove a função nova.
-- Não mexe em dados: ocorrências já sincronizadas pela versão nova continuam com os valores que receberam.
BEGIN;

CREATE OR REPLACE FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.sincronizar_ocorrencia_antes_financeiro(new.id);
  return new;
end;
$function$;

DROP FUNCTION IF EXISTS public.sincronizar_comissao_ocorrencia_em_analise(uuid);

COMMIT;
