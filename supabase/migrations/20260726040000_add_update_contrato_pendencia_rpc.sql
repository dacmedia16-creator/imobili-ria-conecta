-- Gestor já pode editar a pendência do contrato nas etapas de conferência/assinatura (já cobertas
-- por can_edit_sale_stage), mas jurídico só tinha permissão de editar sales em
-- aprovada_gestor/em_elaboracao_contrato — uma vez que o contrato já foi enviado ao gestor, o
-- jurídico ficava sem conseguir atualizar contrato_pendencia_descricao/contrato_libera_assinatura
-- (ex.: anexar a certidão que faltava depois e liberar a assinatura). Em vez de abrir
-- can_edit_sale_stage geral pro jurídico nessas etapas (deixaria ele editar qualquer coisa da
-- venda), esta função mexe só nessas 2 colunas, com sua própria checagem de papel/status.
CREATE OR REPLACE FUNCTION public.update_contrato_pendencia(
  _sale_id uuid,
  _pendencia_descricao text,
  _libera_assinatura boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_view_sale(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Sem permissão para editar esta venda.';
  END IF;

  IF NOT public.has_any_role(auth.uid(), ARRAY['gestor','juridico','financeiro','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Somente gestor, jurídico, financeiro ou admin podem editar a pendência do contrato.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id
    AND s.status::text = ANY(ARRAY[
      'em_elaboracao_contrato','contrato_conferencia_gestor','contrato_conferencia_corretor',
      'contrato_ok_corretor','aguardando_assinatura'
    ])
  ) THEN
    RAISE EXCEPTION 'A pendência do contrato só pode ser editada durante as etapas de elaboração/conferência/assinatura do contrato.';
  END IF;

  UPDATE public.sales
  SET contrato_pendencia_descricao = _pendencia_descricao,
      contrato_libera_assinatura = _libera_assinatura
  WHERE id = _sale_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_contrato_pendencia(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_contrato_pendencia(uuid, text, boolean) TO authenticated;
