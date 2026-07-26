ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS previsao_recebimento2_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS previsao_recebimento2_data date,
  ADD COLUMN IF NOT EXISTS previsao_recebimento2_forma text,
  ADD COLUMN IF NOT EXISTS previsao_recebimento3_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS previsao_recebimento3_data date,
  ADD COLUMN IF NOT EXISTS previsao_recebimento3_forma text;

COMMENT ON COLUMN public.sales.previsao_recebimento2_valor IS 'Preenchido pelo gestor na Divisão da comissão — vira a 2ª parcela de prev_recebimento2 em occurrences quando a Ocorrência é criada.';
COMMENT ON COLUMN public.sales.previsao_recebimento3_valor IS 'Preenchido pelo gestor na Divisão da comissão — vira a 3ª parcela de prev_recebimento3 em occurrences quando a Ocorrência é criada.';

-- previsao_recebimento2_*/previsao_recebimento3_* também ficam dentro do bloco "Divisão da
-- comissão" (só gestor edita) — o trigger precisa cobrir os 2 novos trios de campos.
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
    OR NEW.previsao_recebimento2_valor IS DISTINCT FROM OLD.previsao_recebimento2_valor
    OR NEW.previsao_recebimento2_data IS DISTINCT FROM OLD.previsao_recebimento2_data
    OR NEW.previsao_recebimento2_forma IS DISTINCT FROM OLD.previsao_recebimento2_forma
    OR NEW.previsao_recebimento3_valor IS DISTINCT FROM OLD.previsao_recebimento3_valor
    OR NEW.previsao_recebimento3_data IS DISTINCT FROM OLD.previsao_recebimento3_data
    OR NEW.previsao_recebimento3_forma IS DISTINCT FROM OLD.previsao_recebimento3_forma
  ) AND NOT public.can_edit_sale_comissao(auth.uid(), OLD.id) THEN
    RAISE EXCEPTION 'Somente o gestor (ou financeiro/admin) pode editar a divisão da comissão desta venda.';
  END IF;
  RETURN NEW;
END;
$function$;
