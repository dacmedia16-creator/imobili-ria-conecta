-- Decisão Denis 03/10/2026: a exclusividade vale a partir da DATA DE ASSINATURA (cláusula 1.2 do
-- contrato: "dias, contados da data de assinatura"). Vencimento = signed_on + prazo_dias_numero.
-- signed_on: informada pelo gestor ao aprovar (padrão: hoje em SP) e corrigível depois.
-- Backfill: a única captação aprovada recebe a data em que o contrato assinado foi anexado.
-- Rollback: docs/sql/rollback/20261003120000_exclusividade_data_assinatura.rollback.sql
BEGIN;
ALTER TABLE public.exclusive_captures ADD COLUMN signed_on date;

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
    UPDATE public.exclusive_captures SET status='aprovada',updated_at=now(),
      signed_on=coalesce(signed_on,(now() AT TIME ZONE 'America/Sao_Paulo')::date) WHERE id=_id;
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

CREATE FUNCTION public.exclusive_set_signed_on(_id uuid, _date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_is_manager(_id, auth.uid()) THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  IF _c.status NOT IN ('enviada','em_assinatura','aprovada') THEN RAISE EXCEPTION 'Captação ainda não foi enviada'; END IF;
  IF _date IS NULL OR _date > (now() AT TIME ZONE 'America/Sao_Paulo')::date OR _date < _c.created_on_sp
  THEN RAISE EXCEPTION 'Data de assinatura inválida'; END IF;
  UPDATE public.exclusive_captures SET signed_on = _date, updated_at = now() WHERE id = _id;
  INSERT INTO public.exclusive_history(capture_id, actor_id, action, detail)
    VALUES (_id, auth.uid(), 'data_assinatura', to_char(_date, 'DD/MM/YYYY'));
END $function$;
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_set_signed_on(uuid, date) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_set_signed_on(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_set_signed_on(uuid, date) TO authenticated, service_role;

UPDATE public.exclusive_captures c SET signed_on = (
  SELECT (min(d.created_at) AT TIME ZONE 'America/Sao_Paulo')::date FROM public.exclusive_documents d
  WHERE d.capture_id = c.id AND d.kind = 'assinado')
WHERE c.status = 'aprovada' AND c.signed_on IS NULL;
COMMIT;
