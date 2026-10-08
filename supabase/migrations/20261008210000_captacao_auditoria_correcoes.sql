-- Correções da auditoria t_874f3f48 no fluxo da captação exclusiva (aprovado por Denis em 08/10/2026,
-- tópico 6238, "corrigir todos").
--
--  ALTO-1  Devolver captação APROVADA ao corretor: gestor/TL do captador ou admin, motivo obrigatório,
--          só sem venda ativa ligada (exclusive_venda_ativa nula). Limpa signed_on, mantém o contrato
--          assinado como histórico e registra no histórico. Sai do Mapa (o mapa só lista 'aprovada').
--  ALTO-2  Trava no BANCO, nos dois fluxos (normal e assinada no papel):
--          - 'enviar' e 'aprovar' exigem Plano de Marketing (form_data->'dossie' com ao menos 1 ação
--            ativa do catálogo) quando a imobiliária tem catálogo ativo e o módulo Feedback ligado
--            (mesma condição que a tela usa para mostrar o Plano);
--          - fluxo normal: o contrato 'assinado' só é aceito depois do 'gerado' pelo sistema, e
--            'aprovar' exige o 'gerado' e um 'assinado' anexado depois dele.
--          Registros antigos não são alterados; as captações pendentes sem Plano ficam barradas até
--          serem devolvidas e completadas.
--  BAIXO-1 Histórico com o NOME de quem agiu (RPC exclusive_history_view; profiles não é legível
--          por todos via RLS).
--  Avisos  Coluna opcional notifications.exclusive_capture_id para o sino abrir a captação.
--
-- Base: definições IMPLANTADAS (pg_get_functiondef em 08/10) de exclusive_transition e
-- exclusive_register_document; só o delta acima foi acrescentado.
-- Rollback: supabase/rollback/20261008210000_captacao_auditoria_correcoes.sql
BEGIN;

-- Plano de Marketing obrigatório? (catálogo ativo + módulo Feedback ligado na imobiliária) --------
CREATE FUNCTION public.exclusive_plano_ok(_org uuid, _form jsonb)
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
    OR EXISTS (
      SELECT 1 FROM public.owner_feedback_actions a
      WHERE a.organization_id = _org AND a.list = 'marketing' AND a.active
        AND jsonb_typeof(_form->'dossie') = 'array'
        AND (_form->'dossie') ? a.id::text)
$function$;

-- Transições -------------------------------------------------------------------------------------
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

-- Documentos: no fluxo normal o assinado só depois do gerado ------------------------------------
CREATE OR REPLACE FUNCTION public.exclusive_register_document(_id uuid, _kind text, _owner integer, _path text, _file_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _status text; _manual boolean; _mime text;
BEGIN
  SELECT status, manual INTO _status, _manual FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  IF NOT ((_kind IN ('rg','cpf','cnh') AND _owner IN (1,2)) OR
          (_kind IN ('residencia','iptu','matricula','gerado','assinado') AND _owner = 0))
    OR _file_name IS NULL OR length(trim(_file_name)) NOT BETWEEN 1 AND 180
    OR _path !~ ('^' || public.current_org_id()::text || '/' || _id::text || '/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$')
  THEN RAISE EXCEPTION 'Documento inválido'; END IF;
  IF _kind = 'assinado' AND _manual THEN
    -- Cadastro manual: o próprio captador anexa o contrato já assinado (PDF ou foto) antes do envio;
    -- o gestor pode substituir enquanto confere.
    IF NOT (public.exclusive_is_editor(_id, auth.uid())
            OR (public.exclusive_is_manager(_id, auth.uid()) AND _status = 'enviada'))
    THEN RAISE EXCEPTION 'Contrato assinado não pode ser anexado agora'; END IF;
  ELSIF _kind = 'assinado' THEN
    IF NOT public.exclusive_is_manager(_id, auth.uid()) OR _status NOT IN ('enviada','em_assinatura')
      OR _path !~ '[.]pdf$' THEN RAISE EXCEPTION 'Apenas gestor pode anexar contrato assinado'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND kind='gerado')
    THEN RAISE EXCEPTION 'Gere o contrato pelo sistema antes de anexar a versão assinada'; END IF;
  ELSIF _kind = 'gerado' THEN
    -- Contrato é gerado só por gestor, team leader ou ADM, depois do envio. Manual já vem assinado.
    IF _manual OR NOT public.exclusive_is_manager(_id, auth.uid()) OR _status <> 'enviada'
      OR _path !~ '[.]pdf$' THEN RAISE EXCEPTION 'Apenas gestor, team leader ou ADM pode gerar o contrato'; END IF;
  ELSIF NOT public.exclusive_is_editor(_id, auth.uid()) THEN
    RAISE EXCEPTION 'Upload não autorizado';
  END IF;
  SELECT metadata->>'mimetype' INTO _mime FROM storage.objects
    WHERE bucket_id = 'exclusive-captures' AND name = _path;
  IF NOT FOUND OR _mime NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
    OR (_kind = 'gerado' AND _mime <> 'application/pdf')
    OR (_kind = 'assinado' AND NOT _manual AND _mime <> 'application/pdf')
  THEN RAISE EXCEPTION 'Arquivo ausente ou formato inválido'; END IF;
  INSERT INTO public.exclusive_documents(capture_id,kind,owner_index,storage_path,file_name,uploaded_by)
    VALUES (_id,_kind,_owner,_path,trim(_file_name),auth.uid())
    ON CONFLICT (capture_id,kind,owner_index) DO UPDATE
      SET storage_path=excluded.storage_path,file_name=excluded.file_name,
          uploaded_by=excluded.uploaded_by,created_at=now();
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),'documento_anexado',_kind || ':' || _owner::text);
END $function$;

-- Histórico com nome (BAIXO-1) -------------------------------------------------------------------
CREATE FUNCTION public.exclusive_history_view(_id uuid)
 RETURNS TABLE(id bigint, actor_id uuid, actor_nome text, action text, detail text, created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT h.id, h.actor_id, nullif(btrim(p.nome), ''), h.action, h.detail, h.created_at
  FROM public.exclusive_history h
  LEFT JOIN public.profiles p ON p.id = h.actor_id AND p.organization_id = h.organization_id
  WHERE h.capture_id = _id AND h.organization_id = public.current_org_id()
    AND public.exclusive_can_view(_id, auth.uid())
  ORDER BY h.created_at DESC, h.id DESC
$function$;

-- Sino: aviso de captação abre a própria captação ------------------------------------------------
ALTER TABLE public.notifications ADD COLUMN exclusive_capture_id uuid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_exclusive_capture_org_fk
  FOREIGN KEY (exclusive_capture_id, organization_id)
  REFERENCES public.exclusive_captures (id, organization_id) ON DELETE CASCADE;
CREATE INDEX notifications_exclusive_capture_idx ON public.notifications (exclusive_capture_id)
  WHERE exclusive_capture_id IS NOT NULL;
COMMENT ON COLUMN public.notifications.exclusive_capture_id IS
  'Captação exclusiva do aviso (enviada/devolvida/aprovada). Gravada só pelo servidor (service_role).';

-- Dono e permissões (mesmo dono das demais RPCs da captação) ------------------------------------
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_plano_ok(uuid, jsonb) OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_history_view(uuid) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_plano_ok(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exclusive_history_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_history_view(uuid) TO authenticated, service_role;

COMMIT;
