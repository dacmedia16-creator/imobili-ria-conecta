-- Antes, a troca de status da venda gravava em sales/sale_status_history/activity_logs em 3
-- chamadas separadas do client, sem transação -- se a 2ª ou 3ª falhasse (rede caiu no meio), o
-- status já tinha mudado no banco mas o histórico de auditoria ficava sem esse registro, sem
-- nenhum erro visível pro usuário. Esta função faz as 3 gravações numa única transação (tudo ou
-- nada) -- SECURITY DEFINER porque insere em sale_status_history/activity_logs em nome do usuário,
-- mas com can_view_sale() checado explicitamente no topo (mesmo padrão de update_contrato_pendencia)
-- já que SECURITY DEFINER ignora RLS das tabelas por baixo.
--
-- A validação de QUEM pode fazer QUAL transição continua sendo feita pela trigger já existente
-- (trg_validate_sale_status BEFORE UPDATE, validate_sale_status_transition()) -- essa função só
-- garante que status + histórico + log fiquem sempre em sincronia.
CREATE OR REPLACE FUNCTION public.change_sale_status(_sale_id uuid, _new_status text, _motivo text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _prev_status text;
BEGIN
  IF NOT public.can_view_sale(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Sem permissão para acessar esta venda.';
  END IF;

  SELECT status::text INTO _prev_status FROM public.sales WHERE id = _sale_id;
  IF _prev_status IS NULL THEN
    RAISE EXCEPTION 'Venda não encontrada.';
  END IF;

  UPDATE public.sales SET status = _new_status::sale_status WHERE id = _sale_id;

  INSERT INTO public.sale_status_history (sale_id, de, para, autor_id, motivo)
  VALUES (_sale_id, _prev_status::sale_status, _new_status::sale_status, auth.uid(), _motivo);

  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
  VALUES (auth.uid(), _sale_id, 'status_change', jsonb_build_object('de', _prev_status, 'para', _new_status, 'motivo', _motivo));
END;
$function$;
