-- Rollback de 20261104120000_captacao_corretor_sem_creci.sql (t_e75b58c5).
-- Antes de rodar: voltar a tela para a versão anterior. A edge clicksign-send não muda nesta entrega.
-- ATENÇÃO: captações de captador sem CRECI que já foram enviadas ao gestor continuam "enviada"; depois do
-- rollback o PDF delas só sai com o CRECI do captador preenchido (comportamento antigo).
-- Envelopes já enviados/assinados não dependem destas colunas.
DROP FUNCTION IF EXISTS public.exclusive_testemunha_2_manual_salvar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.exclusive_contrato_corretor_escolher(uuid, uuid);
DROP FUNCTION IF EXISTS public.exclusive_contrato_candidatos(uuid);
DROP FUNCTION IF EXISTS public.exclusive_contrato_editavel(uuid);

-- Funções de 20261029220000 como eram (resolvedor, tela, fixar, gatilho):
CREATE OR REPLACE FUNCTION public.exclusive_testemunhas_resolver(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _lider uuid; _gestor uuid; _origem text; _motivo text;
  _cor jsonb; _ges jsonb; _probs text[] := '{}'; _doc_at timestamptz; _doc_path text; _pdf_ok boolean := false;
  _papel_ok boolean; _lider_nome text;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Gestor da equipe: líder da equipe em que o corretor é membro (team_members.membro_id é único).
  SELECT t.lider_id INTO _lider FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _c.organization_id
    WHERE tm.membro_id = _c.captor_id AND tm.organization_id = _c.organization_id LIMIT 1;
  SELECT nullif(btrim(p.nome), '') INTO _lider_nome FROM public.profiles p WHERE p.id = _lider;

  IF _c.testemunha_gestor_id IS NOT NULL THEN
    _gestor := _c.testemunha_gestor_id; _origem := 'escolhido';
  ELSIF _lider IS NOT NULL AND _lider <> _c.captor_id THEN
    _gestor := _lider; _origem := 'equipe';
  ELSIF _lider = _c.captor_id OR EXISTS (SELECT 1 FROM public.teams t
      WHERE t.lider_id = _c.captor_id AND t.organization_id = _c.organization_id) THEN
    _motivo := 'corretor_e_lider';
  ELSE
    _motivo := 'sem_equipe';
  END IF;

  _cor := public.exclusive_testemunha_pessoa(_c.captor_id, _c.organization_id, _c.broker_cpf);
  IF NOT (_cor->>'ok')::boolean THEN
    _probs := _probs || format('Testemunha 1 (corretor%s): falta %s no cadastro',
      coalesce(' ' || nullif(_cor->>'nome', ''), ''),
      (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_cor->'falta') x));
  END IF;

  IF _gestor IS NULL THEN
    _probs := _probs || CASE _motivo
      WHEN 'corretor_e_lider' THEN 'Testemunha 2: o corretor é o próprio líder da equipe. Escolha outro gestor ou team leader da imobiliária'
      ELSE 'Testemunha 2: o corretor não está em nenhuma equipe. Escolha um gestor ou team leader da imobiliária' END;
  ELSE
    _ges := public.exclusive_testemunha_pessoa(_gestor, _c.organization_id);
    _papel_ok := EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _gestor
      AND ur.organization_id = _c.organization_id AND ur.role IN ('gestor', 'team_leader'));
    IF _gestor = _c.captor_id THEN
      _ges := jsonb_set(jsonb_set(_ges, '{ok}', 'false'), '{falta}',
        (_ges->'falta') || '["ser outra pessoa (o corretor já é a testemunha 1)"]');
    ELSIF _origem = 'escolhido' AND NOT _papel_ok THEN
      _ges := jsonb_set(jsonb_set(_ges, '{ok}', 'false'), '{falta}',
        (_ges->'falta') || '["papel de gestor ou team leader"]');
    END IF;
    _ges := _ges || jsonb_build_object('origem', _origem);
    IF NOT (_ges->>'ok')::boolean THEN
      _probs := _probs || format('Testemunha 2 (%s%s): falta %s. Peça para completar o cadastro ou escolha outro gestor ou team leader',
        CASE _origem WHEN 'equipe' THEN 'gestor da equipe' ELSE 'escolhida' END,
        coalesce(' ' || nullif(_ges->>'nome', ''), ''),
        (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_ges->'falta') x));
    END IF;
  END IF;

  -- PDF: o arquivo "gerado" atual é exatamente o registrado (caminho único por upload) e as
  -- testemunhas impressas (pessoa + nome + CPF) são as de agora.
  SELECT d.created_at, d.storage_path INTO _doc_at, _doc_path FROM public.exclusive_documents d
    WHERE d.capture_id = _id AND d.kind = 'gerado';
  _pdf_ok := _doc_at IS NOT NULL AND _c.testemunhas_pdf IS NOT NULL
    AND (_c.testemunhas_pdf->>'path') = _doc_path
    AND (_c.testemunhas_pdf->>'corretor_id')::uuid = _c.captor_id
    AND (_c.testemunhas_pdf->>'gestor_id')::uuid IS NOT DISTINCT FROM _gestor
    AND (_c.testemunhas_pdf->>'dados') = public.exclusive_testemunhas_assinatura(_cor, _ges);

  RETURN jsonb_build_object(
    'aplica', EXISTS (SELECT 1 FROM public.clicksign_org_settings s
      WHERE s.organization_id = _c.organization_id AND s.enabled),
    'corretor', _cor,
    'gestor', _ges,
    'gestor_equipe', CASE WHEN _lider IS NOT NULL AND _lider <> _c.captor_id
      THEN jsonb_build_object('id', _lider, 'nome', coalesce(_lider_nome, '')) END,
    'motivo', _motivo,
    'escolhido', _c.testemunha_gestor_id IS NOT NULL,
    'problemas', to_jsonb(_probs),
    'ok', cardinality(_probs) = 0,
    'pdf_gerado', _doc_at IS NOT NULL,
    'pdf_ok', _pdf_ok,
    -- Devolvida ao fixar: prova que o PDF saiu com estes nomes/CPFs (só para quem gere).
    'dados', public.exclusive_testemunhas_assinatura(_cor, _ges));
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas_resolver(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunhas_resolver(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.exclusive_testemunhas(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _acesso text := public.exclusive_testemunhas_acesso(_id); _r jsonb;
BEGIN
  IF _acesso IS NULL THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  _r := public.exclusive_testemunhas_resolver(_id);
  _r := jsonb_set(_r, '{corretor}', (_r->'corretor') - 'email');
  IF _r->'gestor' IS NOT NULL AND jsonb_typeof(_r->'gestor') = 'object' THEN
    _r := jsonb_set(_r, '{gestor}', (_r->'gestor') - 'email');
  END IF;
  IF _acesso <> 'gerir' THEN
    _r := _r - 'dados';
    _r := jsonb_set(_r, '{corretor}', (_r->'corretor') - 'cpf');
    IF jsonb_typeof(_r->'gestor') = 'object' THEN
      _r := jsonb_set(_r, '{gestor}', (_r->'gestor') - 'cpf');
    END IF;
  END IF;
  RETURN _r || jsonb_build_object('pode_gerir', _acesso = 'gerir');
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunhas(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.exclusive_testemunhas_fixar(_id uuid, _corretor uuid, _gestor uuid,
  _path text, _dados text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _r jsonb; _doc_at timestamptz; _doc_path text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.exclusive_is_manager(_id, auth.uid()), false) THEN
    RAISE EXCEPTION 'Apenas gestor, team leader ou ADM pode gerar o contrato';
  END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF _c.status <> 'enviada' OR _c.manual THEN
    RAISE EXCEPTION 'O contrato só é gerado com a captação enviada ao gestor';
  END IF;
  SELECT created_at, storage_path INTO _doc_at, _doc_path FROM public.exclusive_documents
    WHERE capture_id = _id AND kind = 'gerado';
  IF _doc_at IS NULL THEN RAISE EXCEPTION 'Gere o contrato antes'; END IF;
  IF _path IS DISTINCT FROM _doc_path THEN
    RAISE EXCEPTION 'Outro PDF foi gerado ao mesmo tempo: gere o PDF de novo';
  END IF;
  _r := public.exclusive_testemunhas_resolver(_id);
  IF NOT (_r->>'ok')::boolean OR _corretor IS DISTINCT FROM (_r->'corretor'->>'id')::uuid
     OR _gestor IS DISTINCT FROM (_r->'gestor'->>'id')::uuid
     OR _dados IS DISTINCT FROM public.exclusive_testemunhas_assinatura(_r->'corretor', _r->'gestor') THEN
    RAISE EXCEPTION 'As testemunhas mudaram ou estão incompletas: gere o PDF de novo';
  END IF;
  UPDATE public.exclusive_captures SET testemunhas_pdf = jsonb_build_object(
    'path', _doc_path, 'gerado_at', _doc_at, 'corretor_id', _corretor, 'gestor_id', _gestor,
    'dados', _dados, 'em', now())
  WHERE id = _id;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas_fixar(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunhas_fixar(uuid, uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.exclusive_testemunhas_reset_captor()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.captor_id IS DISTINCT FROM OLD.captor_id THEN
    NEW.testemunha_gestor_id := NULL;
    NEW.testemunhas_pdf := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas_reset_captor() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.exclusive_testemunha_manual_pessoa(jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.exclusive_contrato_corretor_pessoa(uuid, uuid);

-- CRECI do captador volta a ser obrigatório no envio (versão de 20261022200000):
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
  -- Todos os proprietários (1º, 2º e proprietarios_extras) — t_58effd65.
  FOR _o IN SELECT x.o FROM jsonb_array_elements(public.exclusive_owner_list(_form)) x(o) LOOP
    FOREACH _k IN ARRAY ARRAY['nome_completo','rg','cpf','endereco_completo',
      'nacionalidade','estado_civil','email','telefone_1'] LOOP
      IF nullif(trim(coalesce(_o->>_k,'')),'') IS NULL THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  FOREACH _k IN ARRAY ARRAY['prazo_dias_numero','prazo_dias_extenso',
    'prazo_dias_uteis_numero','prazo_dias_uteis_extenso',
    'comissao_percentual_numero','comissao_percentual_extenso','foro_comarca','foro_estado'] LOOP
    IF nullif(trim(coalesce(_form->'condicoes'->>_k,'')),'') IS NULL THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $function$;

ALTER TABLE public.exclusive_captures
  DROP COLUMN IF EXISTS testemunha_2_manual,
  DROP COLUMN IF EXISTS contrato_corretor_id;
