-- Cadastro manual de exclusividade JÁ ASSINADA no papel (maquete aprovada por Denis em 08/10).
--
-- Fluxo: o captador (usuário logado) cria a captação marcada como manual, anexa o contrato assinado
-- (PDF ou foto: ÚNICO item obrigatório), confere o que a leitura por IA preencheu, marca o Plano de
-- Marketing (opcional) e envia ao gestor. O gestor confere e aprova; só então ela conta como
-- assinada. Não há PDF gerado pelo sistema nem passo de assinatura externa.
--
-- Critério do mapa (PR #41, migration 20261008150000, mapa_captacoes() NÃO é alterada): depois da
-- aprovação a captação manual fica com status 'aprovada' + signed_on (data de assinatura lida do
-- contrato e conferida; sem data válida, o dia da aprovação, como na captação normal). Com endereço,
-- a tela a localiza no mapa pelo mesmo exclusive_set_geo das demais. O alerta de vencimento usa os
-- mesmos dois campos, sem mudança.
--
-- O que muda (só para captações manual = true; captações normais seguem idênticas):
--  * exclusive_captures.manual (novo, padrão false) + RPC exclusive_create_manual(unidade).
--  * exclusive_register_document: o editor (rascunho/devolvida) anexa o contrato assinado, PDF ou
--    imagem; gestor pode substituir enquanto confere (enviada). Manual não aceita contrato "gerado".
--  * exclusive_transition: 'enviar' exige só o contrato assinado; 'assinatura' não se aplica;
--    'aprovar' grava signed_on com a data do contrato; 'devolver' NÃO apaga o contrato assinado.
--  * exclusive_set_signed_on: na manual a data pode ser anterior à criação (contrato antigo).
--  * exclusive_archive: rascunho manual pode ser excluído (o contrato não foi gerado pelo sistema).
--  * exclusive_documents_read: o contrato assinado da manual é visível a quem vê a captação (foi o
--    próprio captador que anexou). Nas normais continua só gestor ou após a aprovação.
-- Rollback: supabase/rollback/20261008160000_exclusividade_cadastro_manual.sql
BEGIN;

ALTER TABLE public.exclusive_captures ADD COLUMN manual boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.exclusive_captures.manual IS
  'Cadastro manual de contrato de exclusividade já assinado no papel (sem PDF gerado pelo sistema).';

-- Mesmo controle de exclusive_create_unit; muda só a marca manual e o histórico.
CREATE FUNCTION public.exclusive_create_manual(_unit_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _id uuid; _p public.profiles%ROWTYPE; _u public.exclusive_units%ROWTYPE;
BEGIN
  IF NOT public.exclusive_capture_enabled() OR auth.uid() IS NULL OR
    NOT public.has_any_role(auth.uid(), ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[])
  THEN RAISE EXCEPTION 'Captação exclusiva indisponível'; END IF;
  SELECT * INTO _u FROM public.exclusive_units
    WHERE id = _unit_id AND organization_id = public.current_org_id() AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unidade inválida'; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = auth.uid() AND ativo;
  IF NOT FOUND AND public.platform_current_org() IS NOT NULL THEN RAISE EXCEPTION 'A captação deve ser criada por um corretor desta imobiliária'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil inativo'; END IF;
  IF nullif(trim(_p.nome),'') IS NULL THEN RAISE EXCEPTION 'Preencha seu nome no perfil antes de criar'; END IF;
  -- Condições começam vazias (não os padrões 180 dias / 6%): vêm da leitura do contrato assinado.
  INSERT INTO public.exclusive_captures(captor_id,created_by,template,unit_id,broker_name,broker_cpf,broker_creci,manual,form_data)
  VALUES (auth.uid(),auth.uid(),
    CASE WHEN _u.contrato_antigo THEN _u.legacy_template ELSE 'remax-padrao' END,_u.id,
    _p.nome,coalesce(_p.cpf,''),coalesce(_p.creci,''),true,
    jsonb_build_object('condicoes', jsonb_build_object(
      'prazo_dias_numero','','prazo_dias_extenso','','prazo_dias_uteis_numero','','prazo_dias_uteis_extenso','',
      'comissao_percentual_numero','','comissao_percentual_extenso','','foro_comarca','','foro_estado','')))
  RETURNING id INTO _id;
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),'criada',concat_ws(',','cadastro manual',
      CASE WHEN _p.cpf IS NOT NULL THEN 'CPF:perfil' END,
      CASE WHEN _p.creci IS NOT NULL THEN 'CRECI:perfil' END));
  RETURN _id;
END $function$;

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
    -- Cadastro manual: o único item obrigatório é o contrato assinado.
    IF _c.status NOT IN ('rascunho','devolvida') OR NOT public.exclusive_is_editor(_id,auth.uid())
      OR nullif(trim(_c.broker_name),'') IS NULL
    THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND kind='assinado')
    THEN RAISE EXCEPTION 'Anexe o contrato assinado antes de enviar'; END IF;
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

CREATE OR REPLACE FUNCTION public.exclusive_set_signed_on(_id uuid, _date date)
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
  -- Manual: contrato assinado antes do cadastro no sistema; a data pode ser anterior à criação.
  IF _date IS NULL OR _date > (now() AT TIME ZONE 'America/Sao_Paulo')::date
    OR _date < CASE WHEN _c.manual THEN date '2000-01-01' ELSE _c.created_on_sp END
  THEN RAISE EXCEPTION 'Data de assinatura inválida'; END IF;
  UPDATE public.exclusive_captures SET signed_on = _date, updated_at = now() WHERE id = _id;
  INSERT INTO public.exclusive_history(capture_id, actor_id, action, detail)
    VALUES (_id, auth.uid(), 'data_assinatura', to_char(_date, 'DD/MM/YYYY'));
END $function$;

CREATE OR REPLACE FUNCTION public.exclusive_archive(_id uuid, _action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _contract boolean;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  -- Rascunho manual: o contrato anexado não foi gerado pelo sistema, então ainda pode ser excluído.
  _contract := _c.status <> 'rascunho' OR (NOT _c.manual AND EXISTS (SELECT 1 FROM public.exclusive_documents
    WHERE capture_id = _id AND kind IN ('gerado','assinado')));
  IF _action = 'excluir' THEN
    IF _contract THEN RAISE EXCEPTION 'Captação com contrato gerado não pode ser excluída; use Arquivar'; END IF;
    UPDATE public.exclusive_captures SET discarded_at = now(), discarded_by = auth.uid(), updated_at = now() WHERE id = _id;
  ELSIF _action = 'arquivar' THEN
    IF NOT _contract THEN RAISE EXCEPTION 'Rascunho sem contrato: use Excluir'; END IF;
    IF _c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Captação já arquivada'; END IF;
    UPDATE public.exclusive_captures SET archived_at = now(), archived_by = auth.uid(), updated_at = now() WHERE id = _id;
  ELSIF _action = 'desarquivar' THEN
    IF _c.archived_at IS NULL THEN RAISE EXCEPTION 'Captação não está arquivada'; END IF;
    UPDATE public.exclusive_captures SET archived_at = NULL, archived_by = NULL, updated_at = now() WHERE id = _id;
  ELSE RAISE EXCEPTION 'Ação inválida'; END IF;
  INSERT INTO public.exclusive_history(capture_id, actor_id, action) VALUES (_id, auth.uid(), _action);
END $function$;

DROP POLICY IF EXISTS exclusive_documents_read ON public.exclusive_documents;
CREATE POLICY exclusive_documents_read ON public.exclusive_documents
  FOR SELECT TO authenticated
  USING (
    public.exclusive_can_view(capture_id, (SELECT auth.uid()))
    AND (
      kind NOT IN ('gerado','assinado')
      OR public.exclusive_is_manager(capture_id, (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.exclusive_captures c
                 WHERE c.id = exclusive_documents.capture_id
                   AND (c.status = 'aprovada' OR (c.manual AND exclusive_documents.kind = 'assinado')))
    )
  );

-- Mesmo dono das demais RPCs da captação (ALTER OWNER exige CREATE no schema: temporário).
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_create_manual(uuid) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_create_manual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_create_manual(uuid) TO authenticated, service_role;

COMMIT;
