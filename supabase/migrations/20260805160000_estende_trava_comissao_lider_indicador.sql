-- enforce_sale_comissao_lock (trigger em sales) só vigiava as colunas antigas de comissão
-- (captador/vendedor/indicador únicos). Os campos novos desta sessão — valor_comissao_lider_
-- captador/vendedor (Equipe → líder por lado) e valor_comissao_indicador_captador/vendedor
-- (indicador por lado) — não entravam na trava, então um corretor poderia gravá-los via API
-- direta fora da própria janela de edição, do mesmo jeito que a migration original
-- (20260725000000) já evitava para captador/vendedor/indicador. Estende a mesma trava.
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
