-- Clicksign da CAPTAÇÃO: testemunhas automáticas = corretor da captação + gestor da equipe dele.
-- Cartão t_e8078685; decisões de Denis em 29/10/2026 (tópico 6238):
--   1. Só o contrato de CAPTAÇÃO (exclusividade). A venda (clicksign-sale) NÃO muda.
--   2. Testemunha 1 = o corretor da captação (captor_id); testemunha 2 = o gestor da equipe dele.
--   3. O corretor assina UMA vez só, como TESTEMUNHA (deixa de assinar como parte).
-- Rollback: supabase/rollback/20261029180000_captacao_testemunhas_automaticas.sql
--
-- Como equipe/gestor está modelado (conferido no banco em 29/10/2026):
--   teams(id, lider_id, organization_id, parent_team_id) = a equipe e o seu líder principal;
--   team_members(membro_id ÚNICO, team_id) = em que equipe a pessoa está (no máximo 1);
--   team_co_leaders = líderes auxiliares (não entram como padrão; podem ser escolhidos).
--   "Gestor da equipe" = teams.lider_id da equipe em que o corretor é membro, na MESMA imobiliária.
--
-- Regra adotada:
--   * Vale só onde a Clicksign da captação está ligada (clicksign_org_settings.enabled). Imobiliária
--     sem Clicksign continua com as testemunhas digitadas na captação, como hoje.
--   * Testemunha 2 padrão = líder da equipe do corretor. Sem equipe, ou o corretor é o próprio líder:
--     não há padrão. Quem envia (gestor/TL/jurídico/admin) pode ESCOLHER outro gestor ou team leader
--     ativo da MESMA imobiliária (testemunha_gestor_id); a escolha vale até ser desfeita.
--   * Cada testemunha precisa de: cadastro ativo na imobiliária, nome com sobrenome, e-mail válido e
--     CPF válido (exclusive_valid_cpf). CPF do corretor = o CPF do captador da captação (broker_cpf),
--     com o do cadastro como reserva. RG não existe no cadastro: o campo RG do contrato fica em branco.
--   * Faltou algo = NUNCA envia com testemunha vazia: a edge clicksign-send recusa (422) com o motivo.
--   * O PDF tem as testemunhas impressas: ao gerar, a tela registra quem imprimiu (testemunhas_pdf);
--     se a testemunha mudar depois (escolha, equipe, transferência, PDF novo), o envio é recusado até
--     gerar o PDF de novo. Envelopes já enviados/assinados não são tocados.
--
-- Segurança: a decisão fica no banco. O resolvedor completo (com e-mail) só roda como service_role
-- (edge). A tela recebe o resumo sem e-mail; o CPF só vai para quem gera o PDF ou envia.

-- 1) Colunas -------------------------------------------------------------------------------------
ALTER TABLE public.exclusive_captures
  ADD COLUMN IF NOT EXISTS testemunha_gestor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS testemunhas_pdf jsonb;
COMMENT ON COLUMN public.exclusive_captures.testemunha_gestor_id IS
  'Testemunha 2 escolhida pelo staff quando não há gestor da equipe válido (t_e8078685). NULL = automático.';
COMMENT ON COLUMN public.exclusive_captures.testemunhas_pdf IS
  'Quem foi impresso como testemunha no PDF gerado: {gerado_at, corretor_id, gestor_id, em}.';

-- 2) Uma pessoa como testemunha: dados e o que falta ----------------------------------------------
CREATE OR REPLACE FUNCTION public.exclusive_testemunha_pessoa(_user uuid, _org uuid, _cpf text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _p public.profiles%ROWTYPE; _falta text[] := '{}'; _nome text; _email text; _doc text;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = _user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('id', _user, 'nome', '', 'email', '', 'cpf', '', 'ok', false,
      'falta', jsonb_build_array('cadastro não encontrado'));
  END IF;
  _nome := btrim(regexp_replace(coalesce(_p.nome, ''), '\s+', ' ', 'g'));
  _email := lower(btrim(coalesce(_p.email, '')));
  -- CPF do CADASTRO primeiro (mesma origem do nome); o CPF do captador na captação só de reserva.
  _doc := CASE WHEN public.exclusive_valid_cpf(btrim(coalesce(_p.cpf, ''))) THEN btrim(_p.cpf)
    ELSE btrim(coalesce(_cpf, '')) END;
  IF _p.ativo IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM public.organization_members m
      WHERE m.user_id = _user AND m.organization_id = _org AND m.ativo) THEN
    _falta := _falta || 'cadastro inativo ou de outra imobiliária'::text;
  END IF;
  IF _nome !~ '^\S+\s+\S+' THEN _falta := _falta || 'nome com sobrenome'::text; END IF;
  IF _email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN _falta := _falta || 'e-mail válido'::text; END IF;
  IF NOT public.exclusive_valid_cpf(_doc) THEN _falta := _falta || 'CPF válido'::text; END IF;
  RETURN jsonb_build_object('id', _user, 'nome', _nome, 'email', _email,
    'cpf', CASE WHEN public.exclusive_valid_cpf(_doc) THEN _doc ELSE '' END,
    'ok', cardinality(_falta) = 0, 'falta', to_jsonb(_falta));
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunha_pessoa(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunha_pessoa(uuid, uuid, text) TO service_role;

-- Impressão digital do que vai impresso no PDF (nome + CPF das 2 testemunhas). Muda se o cadastro mudar.
CREATE OR REPLACE FUNCTION public.exclusive_testemunhas_assinatura(_cor jsonb, _ges jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT md5(coalesce(_cor->>'nome', '') || '|' || coalesce(_cor->>'cpf', '') || '|'
    || coalesce(_ges->>'nome', '') || '|' || coalesce(_ges->>'cpf', ''))
$$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas_assinatura(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- 3) Resolvedor (servidor): quem são as 2 testemunhas desta captação --------------------------------
-- Não depende de auth.uid(): a edge chama como service_role; as RPCs da tela chamam depois de checar
-- permissão. Tudo filtrado pela organização da própria captação.
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

-- Quem pode ver/gerir as testemunhas da captação na tela (mesma imobiliária do contexto).
CREATE OR REPLACE FUNCTION public.exclusive_testemunhas_acesso(_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.exclusive_captures c
      WHERE c.id = _id AND c.organization_id = public.current_org_id() AND c.discarded_at IS NULL) THEN
    RETURN NULL;
  END IF;
  IF coalesce(public.clicksign_capture_sender_ok(auth.uid(), _id), false)
     OR coalesce(public.exclusive_is_manager(_id, auth.uid()), false) THEN
    RETURN 'gerir';
  END IF;
  IF coalesce(public.exclusive_can_view(_id, auth.uid()), false) THEN RETURN 'ver'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas_acesso(uuid) FROM PUBLIC, anon, authenticated;

-- 4) Tela: resumo das testemunhas (sem e-mail; CPF só para quem gere) -------------------------------
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

-- 5) Tela: gestores/team leaders da MESMA imobiliária que podem ser a testemunha 2 ----------------
-- Só nome e o que falta (sem e-mail nem CPF). O corretor da captação fica fora.
CREATE OR REPLACE FUNCTION public.exclusive_testemunhas_candidatos(_id uuid)
RETURNS TABLE (id uuid, nome text, ok boolean, falta text, da_equipe boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE;
BEGIN
  IF coalesce(public.exclusive_testemunhas_acesso(_id), '') <> 'gerir' THEN
    RAISE EXCEPTION 'Apenas gestor, team leader, jurídico ou admin da imobiliária pode escolher a testemunha';
  END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE exclusive_captures.id = _id;
  RETURN QUERY
  WITH cand AS (
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.ativo IS TRUE
    JOIN public.organization_members m ON m.user_id = ur.user_id
      AND m.organization_id = _c.organization_id AND m.ativo
    WHERE ur.organization_id = _c.organization_id AND ur.role IN ('gestor', 'team_leader')
      AND ur.user_id <> _c.captor_id
  ), info AS (
    SELECT c.user_id, public.exclusive_testemunha_pessoa(c.user_id, _c.organization_id) j FROM cand c
  )
  SELECT i.user_id, i.j->>'nome', (i.j->>'ok')::boolean,
    nullif((SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(i.j->'falta') x), ''),
    EXISTS (SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.membro_id = _c.captor_id AND t.lider_id = i.user_id)
  FROM info i
  ORDER BY (i.j->>'ok')::boolean DESC, i.j->>'nome';
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas_candidatos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunhas_candidatos(uuid) TO authenticated;

-- 6) Tela: escolher (ou voltar ao automático) a testemunha 2 --------------------------------------
-- Só antes do contrato ir para assinatura (rascunho, devolvida, enviada) e sem envelope em andamento.
CREATE OR REPLACE FUNCTION public.exclusive_testemunha_gestor_escolher(_id uuid, _user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _p jsonb;
BEGIN
  IF coalesce(public.exclusive_testemunhas_acesso(_id), '') <> 'gerir' THEN
    RAISE EXCEPTION 'Apenas gestor, team leader, jurídico ou admin da imobiliária pode escolher a testemunha';
  END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF _c.manual OR _c.archived_at IS NOT NULL OR _c.discarded_at IS NOT NULL
     OR _c.status NOT IN ('rascunho', 'devolvida', 'enviada') THEN
    RAISE EXCEPTION 'A testemunha só pode ser trocada antes de o contrato ir para assinatura';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clicksign_envelopes e WHERE e.capture_id = _id
      AND e.status IN ('sending', 'running')) THEN
    RAISE EXCEPTION 'Este contrato já está em envio ou em assinatura na Clicksign';
  END IF;
  IF _user IS NOT NULL THEN
    IF _user = _c.captor_id THEN
      RAISE EXCEPTION 'O corretor já é a testemunha 1: escolha outra pessoa';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user
        AND ur.organization_id = _c.organization_id AND ur.role IN ('gestor', 'team_leader')) THEN
      RAISE EXCEPTION 'Escolha um gestor ou team leader desta imobiliária';
    END IF;
    _p := public.exclusive_testemunha_pessoa(_user, _c.organization_id);
    IF NOT (_p->>'ok')::boolean THEN
      RAISE EXCEPTION 'Cadastro incompleto para ser testemunha: falta %',
        (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_p->'falta') x);
    END IF;
  END IF;
  IF _user IS NOT DISTINCT FROM _c.testemunha_gestor_id THEN
    RETURN public.exclusive_testemunhas(_id);
  END IF;
  UPDATE public.exclusive_captures SET testemunha_gestor_id = _user WHERE id = _id;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_id, auth.uid(), 'testemunha_escolhida', CASE WHEN _user IS NULL
      THEN 'Testemunha 2: volta para o gestor da equipe'
      ELSE 'Testemunha 2: ' || (_p->>'nome') END);
  RETURN public.exclusive_testemunhas(_id);
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunha_gestor_escolher(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunha_gestor_escolher(uuid, uuid) TO authenticated;

-- 7) Tela: registrar quem foi impresso no PDF gerado ----------------------------------------------
-- Chamada logo depois de anexar o PDF "gerado", com o caminho do arquivo que ESTA tela subiu e o que
-- ela imprimiu (ids + nome/CPF). Se outro PDF foi gerado no meio (outra aba/pessoa) ou as testemunhas
-- mudaram, recusa (o envio pela Clicksign fica bloqueado até gerar de novo).
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

-- 8) Corretor da captação mudou (transferência): a escolha manual e o registro do PDF valiam para o
-- corretor antigo. Zera os dois; o líder da equipe do novo corretor volta a ser o padrão.
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
DROP TRIGGER IF EXISTS trg_exclusive_testemunhas_reset_captor ON public.exclusive_captures;
CREATE TRIGGER trg_exclusive_testemunhas_reset_captor BEFORE UPDATE OF captor_id ON public.exclusive_captures
  FOR EACH ROW EXECUTE FUNCTION public.exclusive_testemunhas_reset_captor();
