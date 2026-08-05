-- Royalty da franquia REMAX: % calculado sobre o valor TOTAL da comissão gerada (não sobre a fatia
-- da imobiliária), mas o valor em R$ resultante sai da fatia da imobiliária mesmo assim (é a
-- franquia cobrando do escritório local, não dos corretores) — mesmo tratamento de líder/indicador.
ALTER TABLE public.sales ADD COLUMN percentual_remax numeric;
ALTER TABLE public.sales ADD COLUMN valor_remax numeric;

-- Estende a trava de comissão (enforce_sale_comissao_lock) pros campos novos, mesmo padrão já
-- aplicado a líder/indicador por lado.
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
    OR NEW.indicador_captador IS DISTINCT FROM OLD.indicador_captador
    OR NEW.indicador_vendedor IS DISTINCT FROM OLD.indicador_vendedor
    OR NEW.valor_comissao_indicador_captador IS DISTINCT FROM OLD.valor_comissao_indicador_captador
    OR NEW.valor_comissao_indicador_vendedor IS DISTINCT FROM OLD.valor_comissao_indicador_vendedor
    OR NEW.valor_comissao_lider_captador IS DISTINCT FROM OLD.valor_comissao_lider_captador
    OR NEW.valor_comissao_lider_vendedor IS DISTINCT FROM OLD.valor_comissao_lider_vendedor
    OR NEW.percentual_remax IS DISTINCT FROM OLD.percentual_remax
    OR NEW.valor_remax IS DISTINCT FROM OLD.valor_remax
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
    RAISE EXCEPTION 'Somente o gestor/team leader (ou financeiro/admin) pode editar a divisão da comissão desta venda.';
  END IF;
  RETURN NEW;
END;
$function$;
