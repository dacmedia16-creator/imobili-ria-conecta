-- Captação exclusiva é uma entidade independente: sem FK, trigger ou consulta para sales.
-- Instalação fail-closed. Habilitar somente após aprovação e revisão da migração:
-- UPDATE public.exclusive_capture_settings SET enabled = true WHERE id = true; (service role)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cpf text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS creci text;
-- CPF informado no perfil ou manualmente deve ter dígitos verificadores válidos.
CREATE FUNCTION public.exclusive_valid_cpf(_value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE _digits text; _sum integer; _check integer; _i integer;
BEGIN
  IF _value IS NULL OR _value !~ '^([0-9]{11}|[0-9]{3}[.][0-9]{3}[.][0-9]{3}-[0-9]{2})$'
  THEN RETURN false; END IF;
  _digits := regexp_replace(_value, '[^0-9]', '', 'g');
  IF _digits = repeat(substr(_digits, 1, 1), 11) THEN RETURN false; END IF;
  FOR _check IN 10..11 LOOP
    _sum := 0;
    FOR _i IN 1..(_check - 1) LOOP
      _sum := _sum + substr(_digits, _i, 1)::integer * (_check + 1 - _i);
    END LOOP;
    IF (CASE WHEN (_sum * 10) % 11 = 10 THEN 0 ELSE (_sum * 10) % 11 END)
      <> substr(_digits, _check, 1)::integer THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
ALTER TABLE public.profiles ADD CONSTRAINT exclusive_profile_cpf_valid
  CHECK (cpf IS NULL OR public.exclusive_valid_cpf(cpf));
ALTER TABLE public.profiles ADD CONSTRAINT exclusive_profile_creci_valid
  CHECK (creci IS NULL OR (length(creci) BETWEEN 4 AND 50
    AND creci ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'));
-- RLS protege LINHAS, não COLUNAS: gestores já podem ler outros profiles.
-- Retira SELECT da tabela inteira e devolve só as colunas não sensíveis.
REVOKE SELECT ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, nome, email, telefone, ativo, created_at, updated_at, avatar_url,
  public_profile_enabled, pagina_pessoal_url, instagram_url) ON public.profiles TO authenticated;

-- Não usar is_active_user aqui: a versão legada devolve true para perfil ausente.
CREATE FUNCTION public.exclusive_actor_active(_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _actor IS NOT NULL AND _actor = auth.uid() AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _actor AND ativo IS TRUE
  )
$$;
REVOKE ALL ON FUNCTION public.exclusive_actor_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_actor_active(uuid) TO authenticated;
-- O update de profiles já permitia ao usuário reativar a si próprio. Bloqueá-lo
-- também fecha essa via de contorno quando o módulo revoga um perfil inativo.
CREATE POLICY exclusive_inactive_profile_update ON public.profiles AS RESTRICTIVE
FOR UPDATE TO authenticated USING (public.exclusive_actor_active((SELECT auth.uid())))
WITH CHECK (public.exclusive_actor_active((SELECT auth.uid())));

CREATE FUNCTION public.exclusive_profile_registration()
RETURNS TABLE(user_id uuid, cpf text, creci text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.cpf, p.creci FROM public.profiles p WHERE
    public.exclusive_actor_active(auth.uid()) AND (
      p.id = auth.uid()
      OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[])
      OR (public.has_any_role(auth.uid(), ARRAY['gestor','team_leader']::public.app_role[])
        AND public.is_lead_of(auth.uid(),p.id))
    )
$$;
REVOKE ALL ON FUNCTION public.exclusive_profile_registration() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_profile_registration() TO authenticated;

CREATE TABLE public.exclusive_capture_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.exclusive_capture_settings (id, enabled) VALUES (true, false);
REVOKE ALL ON public.exclusive_capture_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE (enabled) ON public.exclusive_capture_settings TO service_role;

CREATE FUNCTION public.exclusive_capture_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT enabled FROM public.exclusive_capture_settings WHERE id), false)
$$;
REVOKE ALL ON FUNCTION public.exclusive_capture_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_capture_enabled() TO authenticated;

CREATE TABLE public.exclusive_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captor_id uuid NOT NULL REFERENCES public.profiles(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  template text NOT NULL CHECK (template IN ('campolim', 'barao-de-tatui')),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','devolvida','enviada','em_assinatura','aprovada')),
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(form_data) = 'object'),
  broker_name text NOT NULL DEFAULT '',
  broker_cpf text NOT NULL DEFAULT '',
  broker_creci text NOT NULL DEFAULT '',
  created_on_sp date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exclusive_captures_captor_idx ON public.exclusive_captures(captor_id);
ALTER TABLE public.exclusive_captures ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.exclusive_captures TO authenticated;

CREATE FUNCTION public.exclusive_can_view(_id uuid, _actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.exclusive_capture_enabled() AND public.exclusive_actor_active(_actor)
    AND public.has_any_role(_actor,
      ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[]) AND EXISTS (
    SELECT 1 FROM public.exclusive_captures c
    WHERE c.id = _id AND (
      c.captor_id = _actor
      OR public.has_any_role(_actor, ARRAY['admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_actor, ARRAY['gestor','team_leader']::public.app_role[])
          AND public.is_lead_of(_actor, c.captor_id))
    )
  )
$$;
REVOKE ALL ON FUNCTION public.exclusive_can_view(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_can_view(uuid, uuid) TO authenticated;
CREATE POLICY exclusive_captures_read ON public.exclusive_captures FOR SELECT TO authenticated
USING (public.exclusive_can_view(id, (SELECT auth.uid())));

CREATE TABLE public.exclusive_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id uuid NOT NULL REFERENCES public.exclusive_captures(id),
  kind text NOT NULL CHECK (kind IN ('rg','cpf','cnh','residencia','iptu','matricula','gerado','assinado')),
  owner_index integer NOT NULL DEFAULT 0 CHECK (owner_index IN (0,1,2)),
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capture_id, kind, owner_index),
  CHECK ((kind IN ('rg','cpf','cnh') AND owner_index IN (1,2)) OR
         (kind NOT IN ('rg','cpf','cnh') AND owner_index = 0))
);
CREATE INDEX exclusive_documents_capture_idx ON public.exclusive_documents(capture_id);
ALTER TABLE public.exclusive_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.exclusive_documents TO authenticated;
CREATE POLICY exclusive_documents_read ON public.exclusive_documents FOR SELECT TO authenticated
USING (public.exclusive_can_view(capture_id, (SELECT auth.uid())));

CREATE TABLE public.exclusive_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  capture_id uuid NOT NULL REFERENCES public.exclusive_captures(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exclusive_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.exclusive_history TO authenticated;
CREATE POLICY exclusive_history_read ON public.exclusive_history FOR SELECT TO authenticated
USING (public.exclusive_can_view(capture_id, (SELECT auth.uid())));

-- Only SECURITY DEFINER RPCs mutate rows. RLS is an additional read boundary; no
-- direct INSERT/UPDATE/DELETE grants to authenticated on captures, docs or history.
CREATE FUNCTION public.exclusive_is_editor(_id uuid, _actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.exclusive_can_view(_id, _actor) AND EXISTS (
    SELECT 1 FROM public.exclusive_captures c WHERE c.id = _id
      AND c.status IN ('rascunho','devolvida')
  )
$$;
REVOKE ALL ON FUNCTION public.exclusive_is_editor(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_is_editor(uuid, uuid) TO authenticated;

CREATE FUNCTION public.exclusive_is_manager(_id uuid, _actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.exclusive_capture_enabled() AND public.exclusive_actor_active(_actor) AND EXISTS (
    SELECT 1 FROM public.exclusive_captures c WHERE c.id = _id AND (
      public.has_any_role(_actor, ARRAY['admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_actor, ARRAY['gestor','team_leader']::public.app_role[])
          AND (c.captor_id = _actor OR public.is_lead_of(_actor, c.captor_id)))
    )
  )
$$;
REVOKE ALL ON FUNCTION public.exclusive_is_manager(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_is_manager(uuid, uuid) TO authenticated;

CREATE FUNCTION public.exclusive_create(_template text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _id uuid; _p public.profiles%ROWTYPE;
BEGIN
  IF NOT public.exclusive_capture_enabled() OR auth.uid() IS NULL OR
    NOT public.has_any_role(auth.uid(), ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[])
  THEN RAISE EXCEPTION 'Captação exclusiva indisponível'; END IF;
  IF _template NOT IN ('campolim','barao-de-tatui') THEN RAISE EXCEPTION 'Modelo inválido'; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = auth.uid() AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil inativo'; END IF;
  IF nullif(trim(_p.nome),'') IS NULL THEN RAISE EXCEPTION 'Preencha seu nome no perfil antes de criar'; END IF;
  INSERT INTO public.exclusive_captures(captor_id,created_by,template,broker_name,broker_cpf,broker_creci)
  VALUES (auth.uid(),auth.uid(),_template,_p.nome,coalesce(_p.cpf,''),coalesce(_p.creci,'')) RETURNING id INTO _id;
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),'criada',nullif(concat_ws(',',
      CASE WHEN _p.cpf IS NOT NULL THEN 'CPF:perfil' END,
      CASE WHEN _p.creci IS NOT NULL THEN 'CRECI:perfil' END),''));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_create(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_create(text) TO authenticated;

CREATE FUNCTION public.exclusive_save(_id uuid, _form jsonb, _broker_cpf text, _broker_creci text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _old_cpf text; _old_creci text;
BEGIN
  -- Serializar com transições/anexos: não aceitar edição concorrente após envio.
  SELECT broker_cpf,broker_creci INTO _old_cpf,_old_creci
    FROM public.exclusive_captures WHERE id=_id FOR UPDATE;
  IF NOT public.exclusive_is_editor(_id, auth.uid()) THEN RAISE EXCEPTION 'Edição não autorizada'; END IF;
  IF _form IS NULL OR jsonb_typeof(_form) <> 'object' OR length(_form::text) > 30000
    OR (nullif(trim(coalesce(_broker_cpf,'')),'') IS NOT NULL
      AND NOT public.exclusive_valid_cpf(trim(_broker_cpf)))
    OR (nullif(trim(coalesce(_broker_creci,'')),'') IS NOT NULL AND
      (length(trim(_broker_creci)) NOT BETWEEN 4 AND 50 OR
       trim(_broker_creci) !~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'))
  THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  UPDATE public.exclusive_captures SET form_data = _form,
    broker_cpf = trim(coalesce(_broker_cpf,'')), broker_creci = trim(coalesce(_broker_creci,'')), updated_at = now()
    WHERE id = _id;
  -- A versão anterior do PDF não pode ser submetida depois da edição.
  DELETE FROM public.exclusive_documents WHERE capture_id = _id AND kind = 'gerado';
  -- Registrar origem/alteração sem gravar CPF ou CRECI no detalhe do histórico.
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),'editada',nullif(concat_ws(',',
      CASE WHEN _old_cpf IS DISTINCT FROM trim(coalesce(_broker_cpf,'')) THEN 'CPF:manual' END,
      CASE WHEN _old_creci IS DISTINCT FROM trim(coalesce(_broker_creci,'')) THEN 'CRECI:manual' END),''));
END $$;
REVOKE ALL ON FUNCTION public.exclusive_save(uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_save(uuid,jsonb,text,text) TO authenticated;

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('exclusive-captures','exclusive-captures',false,16777216,ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;
-- Modelos originais ficam em bucket separado e PRIVADO. Seed dos arquivos do repo
-- somente na etapa autorizada de implantação (service role); nunca em public/ do Vite.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('exclusive-templates','exclusive-templates',false,16777216,ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
-- ON CONFLICT must not silently retain a public bucket with the same name.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets
    WHERE id IN ('exclusive-captures','exclusive-templates') AND public IS DISTINCT FROM false)
  THEN RAISE EXCEPTION 'Bucket de exclusividade deve ser privado'; END IF;
END $$;
CREATE POLICY exclusive_templates_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'exclusive-templates' AND name IN ('campolim.pdf','barao-de-tatui.pdf')
  AND public.exclusive_capture_enabled()
  AND public.exclusive_actor_active((SELECT auth.uid()))
  AND public.has_any_role((SELECT auth.uid()),
    ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[])
);

-- Path: <capture UUID>/<random UUID>.<pdf|jpg|jpeg|png|webp>. No public bucket,
-- no UPDATE/DELETE or listing across captures; signed URL creation uses SELECT RLS.
CREATE POLICY exclusive_storage_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'exclusive-captures' AND
  CASE WHEN split_part(name,'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.exclusive_can_view((split_part(name,'/',1))::uuid, (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.storage_path = name
        AND d.capture_id = (split_part(name,'/',1))::uuid)
    ELSE false END
);
CREATE POLICY exclusive_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'exclusive-captures' AND
  CASE WHEN name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$'
    THEN public.exclusive_is_editor((split_part(name,'/',1))::uuid, (SELECT auth.uid()))
    ELSE false END
);
-- Gestor pode anexar o PDF assinado após envio; não pode modificar outros documentos.
CREATE POLICY exclusive_storage_signed_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'exclusive-captures' AND
  CASE WHEN name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}[.]pdf$'
    THEN public.exclusive_is_manager((split_part(name,'/',1))::uuid, (SELECT auth.uid()))
    ELSE false END AND
  EXISTS (SELECT 1 FROM public.exclusive_captures c WHERE c.id::text = split_part(name,'/',1)
    AND c.status IN ('enviada','em_assinatura'))
);

CREATE FUNCTION public.exclusive_register_document(_id uuid, _kind text, _owner integer,
  _path text, _file_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _status text; _mime text;
BEGIN
  SELECT status INTO _status FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  IF NOT ((_kind IN ('rg','cpf','cnh') AND _owner IN (1,2)) OR
          (_kind IN ('residencia','iptu','matricula','gerado','assinado') AND _owner = 0))
    OR _file_name IS NULL OR length(trim(_file_name)) NOT BETWEEN 1 AND 180
    OR _path !~ ('^' || _id::text || '/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$')
  THEN RAISE EXCEPTION 'Documento inválido'; END IF;
  IF _kind = 'assinado' THEN
    IF NOT public.exclusive_is_manager(_id, auth.uid()) OR _status NOT IN ('enviada','em_assinatura')
      OR _path !~ '[.]pdf$' THEN RAISE EXCEPTION 'Apenas gestor pode anexar contrato assinado'; END IF;
  ELSIF NOT public.exclusive_is_editor(_id, auth.uid()) THEN
    RAISE EXCEPTION 'Upload não autorizado';
  END IF;
  SELECT metadata->>'mimetype' INTO _mime FROM storage.objects
    WHERE bucket_id = 'exclusive-captures' AND name = _path;
  IF NOT FOUND OR _mime NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
    OR (_kind IN ('gerado','assinado') AND _mime <> 'application/pdf')
  THEN RAISE EXCEPTION 'Arquivo ausente ou formato inválido'; END IF;
  INSERT INTO public.exclusive_documents(capture_id,kind,owner_index,storage_path,file_name,uploaded_by)
    VALUES (_id,_kind,_owner,_path,trim(_file_name),auth.uid())
    ON CONFLICT (capture_id,kind,owner_index) DO UPDATE
      SET storage_path=excluded.storage_path,file_name=excluded.file_name,
          uploaded_by=excluded.uploaded_by,created_at=now();
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),'documento_anexado',_kind || ':' || _owner::text);
END $$;
REVOKE ALL ON FUNCTION public.exclusive_register_document(uuid,text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_register_document(uuid,text,integer,text,text) TO authenticated;

CREATE FUNCTION public.exclusive_required_fields(_form jsonb, _cpf text, _creci text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE _o jsonb; _p jsonb; _k text; _i integer;
BEGIN
  IF _form IS NULL OR jsonb_typeof(_form) <> 'object' OR
    nullif(trim(coalesce(_cpf,'')),'') IS NULL OR nullif(trim(coalesce(_creci,'')),'') IS NULL
    OR NOT public.exclusive_valid_cpf(trim(_cpf))
    OR length(trim(_creci)) NOT BETWEEN 4 AND 50
    OR trim(_creci) !~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'
  THEN RETURN false; END IF;
  _p := _form->'imovel';
  FOREACH _k IN ARRAY ARRAY['tipo_imovel','endereco','bairro','municipio','estado',
    'classificacao_fiscal_iptu','numero_matricula','cartorio_registro','valor_imovel'] LOOP
    IF nullif(trim(coalesce(_p->>_k,'')),'') IS NULL THEN RETURN false; END IF;
  END LOOP;
  FOR _i IN 1..2 LOOP
    _o := _form->('proprietario_' || _i::text);
    IF _i = 1 OR (_o IS NOT NULL AND _o <> '{}'::jsonb AND _o <> 'null'::jsonb) THEN
      FOREACH _k IN ARRAY ARRAY['nome_completo','rg','cpf','endereco_completo',
        'nacionalidade','estado_civil','email','telefone_1'] LOOP
        IF nullif(trim(coalesce(_o->>_k,'')),'') IS NULL THEN RETURN false; END IF;
      END LOOP;
    END IF;
  END LOOP;
  FOREACH _k IN ARRAY ARRAY['prazo_dias_numero','prazo_dias_extenso',
    'prazo_dias_uteis_numero','prazo_dias_uteis_extenso',
    'comissao_percentual_numero','comissao_percentual_extenso','foro_comarca','foro_estado'] LOOP
    IF nullif(trim(coalesce(_form->'condicoes'->>_k,'')),'') IS NULL THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_required_fields(jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_required_fields(jsonb,text,text) TO authenticated;

CREATE FUNCTION public.exclusive_transition(_id uuid, _action text, _detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.exclusive_transition(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_transition(uuid,text,text) TO authenticated;
