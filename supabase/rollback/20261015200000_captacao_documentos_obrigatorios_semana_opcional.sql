-- Rollback de 20261015200000_captacao_documentos_obrigatorios_semana_opcional.sql: devolve as duas funções exatamente como estavam em produção antes
-- (exclusive_transition de 20261008210000 e exclusive_plano_ok de 20261009020000).
-- Depois, remover 20261015200000 de supabase_migrations.schema_migrations.
BEGIN;

CREATE OR REPLACE FUNCTION public.exclusive_transition(_id uuid, _action text, _detail text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _i integer; _d date;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  IF _action = 'enviar' AND _c.manual THEN
    -- Cadastro manual: contrato assinado + Plano de Marketing.
    IF _c.status NOT IN ('rascunho','devolvida') OR NOT public.exclusive_is_editor(_id,auth.uid())
      OR nullif(trim(_c.broker_name),'') IS NULL
    THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND kind='assinado')
    THEN RAISE EXCEPTION 'Anexe o contrato assinado antes de enviar'; END IF;
    IF NOT public.exclusive_plano_ok(_c.organization_id, _c.form_data)
    THEN RAISE EXCEPTION 'Marque ao menos 1 ação no Plano de Marketing antes de enviar'; END IF;
    UPDATE public.exclusive_captures SET status='enviada', updated_at=now() WHERE id=_id;
  ELSIF _action = 'enviar' THEN
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
    IF NOT public.exclusive_plano_ok(_c.organization_id, _c.form_data)
    THEN RAISE EXCEPTION 'Marque ao menos 1 ação no Plano de Marketing antes de enviar'; END IF;
    UPDATE public.exclusive_captures SET status='enviada', updated_at=now() WHERE id=_id;
  ELSIF _action = 'assinatura' THEN
    IF _c.manual OR _c.status <> 'enviada' OR NOT public.exclusive_is_manager(_id,auth.uid())
    THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND kind='gerado')
    THEN RAISE EXCEPTION 'Gere o contrato antes de enviar para assinatura'; END IF;
    UPDATE public.exclusive_captures SET status='em_assinatura',updated_at=now() WHERE id=_id;
  ELSIF _action = 'aprovar' THEN
    IF _c.status NOT IN ('enviada','em_assinatura') OR NOT public.exclusive_is_manager(_id,auth.uid())
      OR NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND kind='assinado')
    THEN RAISE EXCEPTION 'Contrato assinado e aprovação do gestor são necessários'; END IF;
    IF NOT public.exclusive_plano_ok(_c.organization_id, _c.form_data)
    THEN RAISE EXCEPTION 'Plano de Marketing sem ações marcadas: devolva ao corretor para marcar antes de aprovar'; END IF;
    -- Fluxo normal: o contrato assinado tem de ser o gerado pelo sistema (anexado depois dele).
    IF NOT _c.manual AND NOT EXISTS (
      SELECT 1 FROM public.exclusive_documents g JOIN public.exclusive_documents a
        ON a.capture_id = g.capture_id AND a.kind = 'assinado' AND a.created_at >= g.created_at
      WHERE g.capture_id = _id AND g.kind = 'gerado')
    THEN RAISE EXCEPTION 'Gere o contrato pelo sistema e anexe a versão assinada dele antes de aprovar'; END IF;
    -- Manual: vigência conta da data de assinatura escrita no contrato (conferida no cadastro).
    IF _c.manual AND coalesce(_c.form_data->>'data_assinatura','') ~ '^\d{4}-\d{2}-\d{2}$' THEN
      BEGIN
        _d := (_c.form_data->>'data_assinatura')::date;
      EXCEPTION WHEN others THEN _d := NULL;
      END;
      IF _d > _hoje OR _d < date '2000-01-01' THEN _d := NULL; END IF;
    END IF;
    UPDATE public.exclusive_captures SET status='aprovada',updated_at=now(),
      signed_on=coalesce(signed_on,_d,_hoje) WHERE id=_id;
  ELSIF _action = 'devolver' AND _c.status = 'aprovada' THEN
    -- Devolver captação aprovada ao corretor (ALTO-1): só sem venda ativa ligada.
    IF NOT public.exclusive_is_manager(_id,auth.uid()) OR _c.archived_at IS NOT NULL
      OR nullif(trim(coalesce(_detail,'')),'') IS NULL OR length(_detail) > 1000
    THEN RAISE EXCEPTION 'Informe o motivo da devolução'; END IF;
    IF public.exclusive_venda_ativa(_id) IS NOT NULL
    THEN RAISE EXCEPTION 'Esta captação tem uma venda ativa ligada. Arquive ou cancele a venda antes de devolver.'; END IF;
    UPDATE public.exclusive_captures SET status='devolvida', signed_on=NULL, updated_at=now() WHERE id=_id;
    -- O contrato assinado fica como histórico; o PDF gerado (sem assinatura) sai para ser refeito.
    DELETE FROM public.exclusive_documents WHERE capture_id=_id AND kind = 'gerado' AND NOT _c.manual;
    INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
      VALUES (_id,auth.uid(),'aprovacao_desfeita',
        'Aprovada antes' || coalesce(' (assinada em ' || to_char(_c.signed_on,'DD/MM/YYYY') || ')','')
        || '; contrato assinado mantido como histórico');
  ELSIF _action = 'devolver' THEN
    IF _c.status NOT IN ('enviada','em_assinatura') OR NOT public.exclusive_is_manager(_id,auth.uid())
      OR nullif(trim(coalesce(_detail,'')),'') IS NULL OR length(_detail) > 1000
    THEN RAISE EXCEPTION 'Informe o motivo da devolução'; END IF;
    UPDATE public.exclusive_captures SET status='devolvida',updated_at=now() WHERE id=_id;
    -- Manual: o contrato assinado é a prova do cadastro e fica; só a normal descarta o PDF.
    DELETE FROM public.exclusive_documents WHERE capture_id=_id
      AND (kind = 'gerado' OR (kind = 'assinado' AND NOT _c.manual));
  ELSE RAISE EXCEPTION 'Ação inválida'; END IF;
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),_action,nullif(trim(coalesce(_detail,'')),''));
END $function$;

CREATE OR REPLACE FUNCTION public.exclusive_plano_ok(_org uuid, _form jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT NOT (
      coalesce((SELECT m.enabled FROM public.organization_modules m
                WHERE m.organization_id = _org AND m.module = 'feedback_proprietario'), false)
      AND EXISTS (SELECT 1 FROM public.owner_feedback_actions a
                  WHERE a.organization_id = _org AND a.list = 'marketing' AND a.active))
    OR (EXISTS (
      SELECT 1 FROM public.owner_feedback_actions a
      WHERE a.organization_id = _org AND a.list = 'marketing' AND a.active
        AND jsonb_typeof(_form->'dossie') = 'array'
        AND (_form->'dossie') ? a.id::text)
      AND (jsonb_typeof(_form->'plano_semanas') IS DISTINCT FROM 'object' OR NOT EXISTS (
        SELECT 1 FROM public.owner_feedback_actions a
        WHERE a.organization_id = _org AND a.list = 'marketing' AND a.active
          AND jsonb_typeof(_form->'dossie') = 'array' AND (_form->'dossie') ? a.id::text
          AND NOT EXISTS (SELECT 1 FROM public.exclusive_plan_semanas(_form, a.id) s WHERE s > 0))))
$function$;

COMMIT;
