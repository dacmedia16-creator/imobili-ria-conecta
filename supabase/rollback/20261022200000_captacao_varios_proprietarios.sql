-- ROLLBACK de 20261022200000_captacao_varios_proprietarios (t_58effd65): volta às definições de origin/main e74c01a.
-- Só roda se NÃO houver documento de proprietário 3+ (o CHECK antigo recusaria). Conferir antes:
--   SELECT count(*) FROM public.exclusive_documents WHERE owner_index > 2;  -- precisa ser 0
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.exclusive_documents WHERE owner_index > 2) THEN
    RAISE EXCEPTION 'Há documentos de proprietário 3+: remova-os antes do rollback';
  END IF;
END $$;
ALTER TABLE public.exclusive_documents DROP CONSTRAINT IF EXISTS exclusive_documents_owner_index_check;
ALTER TABLE public.exclusive_documents ADD CONSTRAINT exclusive_documents_owner_index_check
  CHECK (owner_index = ANY (ARRAY[0, 1, 2]));
ALTER TABLE public.exclusive_documents DROP CONSTRAINT IF EXISTS exclusive_documents_check;
ALTER TABLE public.exclusive_documents ADD CONSTRAINT exclusive_documents_check CHECK (
  ((kind = ANY (ARRAY['rg','cpf','cnh'])) AND (owner_index = ANY (ARRAY[1, 2])))
  OR ((kind = 'residencia') AND (owner_index = ANY (ARRAY[0, 1, 2])))
  OR ((kind <> ALL (ARRAY['rg','cpf','cnh','residencia'])) AND (owner_index = 0)));

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
  -- Comprovante de residência: do imóvel (0, como antes) ou de cada proprietário (1/2) — t_8e496afb.
  IF NOT ((_kind IN ('rg','cpf','cnh') AND _owner IN (1,2)) OR
          (_kind = 'residencia' AND _owner IN (0,1,2)) OR
          (_kind IN ('iptu','matricula','gerado','assinado') AND _owner = 0))
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

CREATE OR REPLACE FUNCTION public.exclusive_required_fields(_form jsonb, _cpf text, _creci text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
    -- Documentos do imóvel obrigatórios no envio (Denis, 15/10/2026). Comprovante de residência segue opcional.
    IF NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND owner_index=0 AND kind='matricula')
      OR NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND owner_index=0 AND kind='iptu')
    THEN RAISE EXCEPTION 'Anexe a matrícula e o IPTU do imóvel antes de enviar'; END IF;
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

CREATE OR REPLACE FUNCTION public.minhas_pendencias()
 RETURNS TABLE(kind text, capture_id uuid, imovel text, detalhe text, prazo date, dias integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH caps AS (
    SELECT c.id, c.organization_id, c.status, c.manual, c.form_data, c.signed_on,
      nullif(concat_ws(' — ', nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), ''),
        nullif(btrim(c.form_data->'imovel'->>'bairro'), '')), '') AS imovel
      FROM public.exclusive_captures c
     WHERE c.captor_id = _me AND c.organization_id = public.current_org_id()
       AND c.archived_at IS NULL AND c.discarded_at IS NULL
       AND public.exclusive_can_view(c.id, _me)),
  apr AS (SELECT caps.*, public.exclusive_aprovada_em(caps.id) AS ap FROM caps WHERE caps.status = 'aprovada'),
  docs AS (
    SELECT caps.id, array_remove(ARRAY[
      CASE WHEN NOT (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 1 AND d.kind = 'cnh')
        OR (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 1 AND d.kind = 'rg')
        AND EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 1 AND d.kind = 'cpf')))
        THEN 'RG e CPF ou CNH do proprietário' END,
      CASE WHEN coalesce(caps.form_data->'proprietario_2', '{}'::jsonb) <> '{}'::jsonb AND NOT (
        EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 2 AND d.kind = 'cnh')
        OR (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 2 AND d.kind = 'rg')
        AND EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 2 AND d.kind = 'cpf')))
        THEN 'RG e CPF ou CNH do 2º proprietário' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 0 AND d.kind = 'matricula')
        THEN 'matrícula' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 0 AND d.kind = 'iptu')
        THEN 'IPTU' END], NULL) AS falta
      FROM caps WHERE caps.status IN ('rascunho', 'devolvida') AND NOT caps.manual),
  venc AS (
    SELECT apr.*, apr.signed_on + (apr.form_data->'condicoes'->>'prazo_dias_numero')::int AS fim
      FROM apr
     WHERE apr.signed_on IS NOT NULL AND coalesce(apr.form_data->'condicoes'->>'prazo_dias_numero', '') ~ '^[0-9]{1,4}$'
       AND (apr.form_data->'condicoes'->>'prazo_dias_numero')::int > 0)
  SELECT 'devolvida'::text, caps.id, caps.imovel, 'Devolvida pela gestão: corrija e reenvie'::text, NULL::date, NULL::integer
    FROM caps WHERE caps.status = 'devolvida'
  UNION ALL
  SELECT 'documentos', docs.id, caps.imovel, 'Falta anexar: ' || array_to_string(docs.falta, ', '), NULL, NULL
    FROM docs JOIN caps ON caps.id = docs.id WHERE cardinality(docs.falta) > 0
  UNION ALL
  SELECT 'sem_anuncio', apr.id, apr.imovel, 'Aprovada sem anúncio ligado nos portais', NULL, (_hoje - apr.ap)
    FROM apr WHERE apr.ap IS NOT NULL AND _hoje - apr.ap > 7
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_listing_links l
                      WHERE l.capture_id = apr.id AND l.status IN ('ativo', 'aguardando_gestor'))
  UNION ALL
  SELECT 'atrasada', apr.id, apr.imovel,
         a.label || CASE WHEN it.sem > 0 THEN ' (Semana ' || it.sem || ')' ELSE '' END, it.prazo, (_hoje - it.prazo)
    FROM apr JOIN public.owner_feedback_actions a
      ON a.organization_id = apr.organization_id AND a.list = 'marketing' AND (apr.form_data->'dossie') ? a.id::text
    CROSS JOIN LATERAL (
      SELECT s.s AS sem,
             CASE WHEN s.s > 0 THEN apr.ap + 7 * s.s - 1 ELSE apr.ap + public.exclusive_plan_prazo_dias(a.weight) END AS prazo
        FROM public.exclusive_plan_semanas(apr.form_data, a.id) s(s)) it
   WHERE apr.ap IS NOT NULL AND it.prazo < _hoje
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_plan_done d
                      WHERE d.capture_id = apr.id AND d.action_id = a.id AND d.semana = it.sem)
  UNION ALL
  SELECT 'vencendo', venc.id, venc.imovel,
         CASE WHEN venc.fim < _hoje THEN 'Exclusividade vencida' ELSE 'Exclusividade vence em breve' END,
         venc.fim, (venc.fim - _hoje)
    FROM venc WHERE venc.fim - _hoje BETWEEN -30 AND 30;
END $function$;

CREATE OR REPLACE FUNCTION public.clicksign_papel_por_sha(_e clicksign_envelopes, _sha text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN nullif(s.v->>'label', '') IS NOT NULL THEN s.v->>'label'
    WHEN s.v->>'papel' = 'proprietario_1' THEN 'Proprietário 1'
    WHEN s.v->>'papel' = 'proprietario_2' THEN 'Proprietário 2'
    WHEN s.v->>'papel' = 'corretor' THEN 'Corretor'
    WHEN s.v->>'papel' IN ('imobiliaria','testemunha') THEN
      CASE s.v->>'papel' WHEN 'imobiliaria' THEN 'Imobiliária ' ELSE 'Testemunha ' END
      || (SELECT count(*) FROM jsonb_array_elements(_e.signers) WITH ORDINALITY x(v, n)
          WHERE x.n <= s.n AND x.v->>'papel' = s.v->>'papel')::text
    ELSE 'Um signatário' END
  FROM jsonb_array_elements(_e.signers) WITH ORDINALITY s(v, n)
  WHERE s.v->>'email_sha256' = _sha LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.exclusive_virar_venda(_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _actor uuid := auth.uid(); _sale uuid;
        _im jsonb; _p1 jsonb; _p2 jsonb; _v text; _valor numeric; _uf text;
        _lider uuid; _lider_nome text; _captador_nome text; _existente jsonb;
        _fi jsonb; _tipo text; _util numeric; _terreno numeric;
BEGIN
  -- Trava a captação: chamadas simultâneas esperam aqui e enxergam a venda já criada.
  SELECT * INTO _c FROM public.exclusive_captures
    WHERE id = _id AND organization_id = public.current_org_id() FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_pode_virar_venda(_id, _actor) THEN
    RAISE EXCEPTION 'Só o captador, corretores e o gestor da mesma equipe podem transformar esta captação em venda.'
      USING ERRCODE = '42501';
  END IF;
  _existente := public.exclusive_venda_ativa(_id);
  IF _existente IS NOT NULL THEN
    RETURN jsonb_build_object('criada', false, 'venda', _existente);
  END IF;

  _im := coalesce(_c.form_data->'imovel', '{}'::jsonb);
  _p1 := _c.form_data->'proprietario_1';
  _p2 := _c.form_data->'proprietario_2';
  _fi := CASE WHEN jsonb_typeof(_c.form_data->'ficha') = 'object' THEN _c.form_data->'ficha' ELSE '{}'::jsonb END;
  _tipo := public.ficha_tipo_do_texto(_im->>'tipo_imovel');
  _util := CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_area_do_texto(_fi->>'area_util_m2') END;
  -- Unidade em condomínio: "terreno" seria fração ideal; não leva.
  _terreno := CASE WHEN _tipo IN ('Apartamento', 'Cobertura', 'Studio') THEN NULL
                   ELSE public.ficha_area_do_texto(_fi->>'area_terreno_m2') END;
  -- "R$ 870.000,00" -> 870000.00 (texto livre da captação; inválido fica em branco)
  _v := regexp_replace(coalesce(_im->>'valor_imovel', ''), '[^0-9,.]', '', 'g');
  _v := CASE WHEN _v LIKE '%,%' THEN replace(replace(_v, '.', ''), ',', '.') ELSE replace(_v, '.', '') END;
  _valor := CASE WHEN _v ~ '^[0-9]{1,13}([.][0-9]{1,2})?$' THEN _v::numeric END;
  _uf := upper(btrim(coalesce(_im->>'estado', '')));
  IF _uf !~ '^[A-Z]{2}$' THEN _uf := NULL; END IF;
  SELECT coalesce(nullif(btrim(p.nome), ''), nullif(btrim(_c.broker_name), '')) INTO _captador_nome
    FROM public.profiles p WHERE p.id = _c.captor_id;
  SELECT t.lider_id, nullif(btrim(lp.nome), '') INTO _lider, _lider_nome
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _c.organization_id
    LEFT JOIN public.profiles lp ON lp.id = t.lider_id
    WHERE tm.membro_id = _c.captor_id AND t.lider_id IS DISTINCT FROM _c.captor_id
    LIMIT 1;

  PERFORM set_config('app.virou_venda', 'on', true);
  INSERT INTO public.sales (
    corretor_id, status, modalidade, exclusive_capture_id,
    imovel_endereco, imovel_logradouro, imovel_complemento, imovel_bairro, imovel_cidade, imovel_uf,
    matricula, iptu, valor_anunciado,
    corretor_captador_id, corretor_captador, lider_captador_id, lider_captador_nome,
    corretor_vendedor_id, corretor_vendedor,
    tipo_imovel, area_util_m2, area_construida_m2, area_terreno_m2, ano_construcao,
    quartos, suites, banheiros, vagas, area_origem)
  VALUES (
    _actor, 'rascunho', 'padrao', _c.id,
    nullif(concat_ws(' - ', nullif(btrim(_im->>'endereco'), ''), nullif(btrim(_im->>'complemento'), '')), ''),
    -- endereço da captação é texto livre: número e CEP ficam para o corretor (decisão 08/10)
    nullif(btrim(_im->>'endereco'), ''),
    nullif(btrim(_im->>'complemento'), ''),
    nullif(btrim(_im->>'bairro'), ''),
    nullif(btrim(_im->>'municipio'), ''),
    _uf,
    nullif(concat_ws(' — ', nullif(btrim(_im->>'numero_matricula'), ''), nullif(btrim(_im->>'cartorio_registro'), '')), ''),
    nullif(btrim(_im->>'classificacao_fiscal_iptu'), ''),
    _valor,
    _c.captor_id, _captador_nome, _lider, CASE WHEN _lider IS NOT NULL THEN _lider_nome END,
    _actor, (SELECT nullif(btrim(nome), '') FROM public.profiles WHERE id = _actor),
    _tipo, _util,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_area_do_texto(_fi->>'area_construida_m2') END,
    _terreno,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN
      public.ficha_int_do_texto(_fi->>'ano_construcao', 1800, extract(year FROM now())::int + 1) END,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_int_do_texto(_fi->>'quartos', 0, 99) END,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_int_do_texto(_fi->>'suites', 0, 99) END,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_int_do_texto(_fi->>'banheiros', 0, 99) END,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_int_do_texto(_fi->>'vagas', 0, 99) END,
    CASE WHEN _util IS NOT NULL OR _terreno IS NOT NULL THEN 'captacao' END)
  RETURNING id INTO _sale;
  PERFORM set_config('app.virou_venda', 'off', true);

  INSERT INTO public.sale_parties (sale_id, papel, tipo_pessoa, nome, rg, cpf_cnpj, email, telefone,
    endereco, nacionalidade, estado_civil)
  SELECT _sale, x.papel, 'fisica', nullif(btrim(x.o->>'nome_completo'), ''), nullif(btrim(x.o->>'rg'), ''),
    nullif(btrim(x.o->>'cpf'), ''), nullif(btrim(x.o->>'email'), ''), nullif(btrim(x.o->>'telefone_1'), ''),
    nullif(btrim(x.o->>'endereco_completo'), ''), nullif(btrim(x.o->>'nacionalidade'), ''),
    nullif(btrim(x.o->>'estado_civil'), '')
  FROM (VALUES ('vendedor_1', _p1), ('vendedor_2', _p2)) x(papel, o)
  WHERE x.papel = 'vendedor_1' OR nullif(btrim(coalesce(x.o->>'nome_completo', '')), '') IS NOT NULL;
  INSERT INTO public.sale_parties (sale_id, papel, tipo_pessoa) VALUES (_sale, 'comprador_1', 'fisica');

  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_c.id, _actor, 'virou_venda', _sale::text);
  RETURN jsonb_build_object('criada', true, 'venda', public.exclusive_venda_ativa(_id));
END $function$;

DROP FUNCTION IF EXISTS public.exclusive_owner_list(jsonb);
COMMIT;
