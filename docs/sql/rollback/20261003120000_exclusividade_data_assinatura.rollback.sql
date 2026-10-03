BEGIN;
DROP FUNCTION IF EXISTS public.exclusive_set_signed_on(uuid, date);
CREATE OR REPLACE FUNCTION public.exclusive_transition(_id uuid, _action text, _detail text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _i integer;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  IF _action = 'enviar' THEN
    IF _c.status NOT IN ('rascunho','devolvida') OR NOT public.exclusive_is_editor(_id,auth.uid())
      OR nullif(trim(_c.broker_name),'') IS NULL
      OR NOT public.exclusive_required_fields(_c.form_data,_c.broker_cpf,_c.broker_creci)
    THEN RAISE EXCEPTION 'Preencha todos os campos obrigatórios antes do envio'; END IF;
    FOR _i IN 1..2 LOOP
      IF _i = 1 OR (_c.form_data->('proprietario_' || _i::text) IS NOT NULL AND
        _c.form_data->('proprietario_' || _i::text) <> '{}'::jsonb) THEN
        IF NOT (EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND owner_index=_i AND kind='cnh')
          OR (EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND owner_index=_i AND kind='rg')
          AND EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND owner_index=_i AND kind='cpf')))
        THEN RAISE EXCEPTION 'Anexe RG e CPF ou CNH de cada proprietário'; END IF;
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND kind='gerado')
    THEN RAISE EXCEPTION 'Gere e confira o contrato antes do envio'; END IF;
    UPDATE public.exclusive_captures SET status='enviada', updated_at=now() WHERE id=_id;
  ELSIF _action = 'assinatura' THEN
    IF _c.status <> 'enviada' OR NOT public.exclusive_is_manager(_id,auth.uid())
    THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
    UPDATE public.exclusive_captures SET status='em_assinatura',updated_at=now() WHERE id=_id;
  ELSIF _action = 'aprovar' THEN
    IF _c.status NOT IN ('enviada','em_assinatura') OR NOT public.exclusive_is_manager(_id,auth.uid())
      OR NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND kind='assinado')
    THEN RAISE EXCEPTION 'Contrato assinado e aprovação do gestor são necessários'; END IF;
    UPDATE public.exclusive_captures SET status='aprovada',updated_at=now() WHERE id=_id;
  ELSIF _action = 'devolver' THEN
    IF _c.status NOT IN ('enviada','em_assinatura') OR NOT public.exclusive_is_manager(_id,auth.uid())
      OR nullif(trim(coalesce(_detail,'')),'') IS NULL OR length(_detail) > 1000
    THEN RAISE EXCEPTION 'Informe o motivo da devolução'; END IF;
    UPDATE public.exclusive_captures SET status='devolvida',updated_at=now() WHERE id=_id;
    DELETE FROM public.exclusive_documents WHERE capture_id=_id AND kind IN ('gerado','assinado');
  ELSE RAISE EXCEPTION 'Ação inválida'; END IF;
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),_action,nullif(trim(coalesce(_detail,'')),''));
END $function$;
ALTER TABLE public.exclusive_captures DROP COLUMN IF EXISTS signed_on;
COMMIT;
