-- previsao_recebimento_* vive dentro do bloco "Divisão da comissão" (só gestor edita) — o trigger
-- de trava precisa cobrir esses 3 campos novos também, senão o corretor conseguiria gravá-los via
-- chamada direta à API mesmo com a UI desabilitada.
CREATE OR REPLACE FUNCTION public.enforce_sale_comissao_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (
    NEW.percentual_comissao_captador IS DISTINCT FROM OLD.percentual_comissao_captador
    OR NEW.valor_comissao_captador IS DISTINCT FROM OLD.valor_comissao_captador
    OR NEW.percentual_comissao_vendedor IS DISTINCT FROM OLD.percentual_comissao_vendedor
    OR NEW.valor_comissao_vendedor IS DISTINCT FROM OLD.valor_comissao_vendedor
    OR NEW.indicador IS DISTINCT FROM OLD.indicador
    OR NEW.indicador_lado IS DISTINCT FROM OLD.indicador_lado
    OR NEW.percentual_comissao_indicador IS DISTINCT FROM OLD.percentual_comissao_indicador
    OR NEW.valor_comissao_indicador IS DISTINCT FROM OLD.valor_comissao_indicador
    OR NEW.previsao_recebimento_valor IS DISTINCT FROM OLD.previsao_recebimento_valor
    OR NEW.previsao_recebimento_data IS DISTINCT FROM OLD.previsao_recebimento_data
    OR NEW.previsao_recebimento_forma IS DISTINCT FROM OLD.previsao_recebimento_forma
  ) AND NOT public.can_edit_sale_comissao(auth.uid(), OLD.id) THEN
    RAISE EXCEPTION 'Somente o gestor (ou financeiro/admin) pode editar a divisão da comissão desta venda.';
  END IF;
  RETURN NEW;
END;
$function$;
