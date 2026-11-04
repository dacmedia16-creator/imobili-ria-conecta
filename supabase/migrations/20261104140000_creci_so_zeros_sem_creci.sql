-- CRECI sem valor real (vazio ou só zeros: 0, 0000000000, 000-0, 00000-F) = SEM CRECI (t_77132312).
-- Decisão de Denis em 04/11/2026 (tópico 6238). Caso real: captação com broker_creci "0000000000" saiu
-- no modo padrão (captadora como corretora, CRECI 0000000000) porque a 20261104130000 só entrava no
-- modo sem_creci com o CRECI VAZIO.
-- Regra única: public.creci_real(text) (espelho: creciReal() em src/lib/exclusive-captures-ocr.ts).
-- Parte A (CRECI): troca as checagens de CRECI de exclusive_required_fields,
--   exclusive_contrato_corretor_pessoa, exclusive_testemunhas_resolver e exclusive_contrato_editavel.
-- Parte B (escopo aprovado por Denis 04/11): captador que também é PROPRIETÁRIO não é testemunha;
--   as duas testemunhas passam a ser digitadas. Nenhuma testemunha pode ter CPF/e-mail de proprietário
--   nem do corretor do contrato. A edge clicksign-send não muda (usa o resolvedor; envio 422).
-- Captador com CRECI real e que não é proprietário: mesmo resultado e mesma impressão digital.
-- Não altera dados. Rollback: supabase/rollback/20261104140000_creci_so_zeros_sem_creci.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.creci_real(_v text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  -- Valor real = tem ao menos um dígito de 1 a 9. Devolve o CRECI aparado; NULL = sem CRECI.
  SELECT CASE WHEN btrim(coalesce(_v, '')) ~ '[1-9]' THEN btrim(_v) END
$$;
COMMENT ON FUNCTION public.creci_real(text) IS
  'CRECI com valor real (t_77132312): NULL se vazio ou sem dígito 1-9 (ex.: 0000000000). Espelho TS: creciReal().';
REVOKE ALL ON FUNCTION public.creci_real(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creci_real(text) TO authenticated, service_role;

-- 2) CRECI do captador deixa de ser obrigatório no envio ao gestor (formato continua validado) -------
CREATE OR REPLACE FUNCTION public.exclusive_required_fields(_form jsonb, _cpf text, _creci text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE _o jsonb; _p jsonb; _k text; _i integer;
BEGIN
  -- CRECI sem valor real (vazio ou só zeros, t_77132312) = captador sem CRECI (t_e75b58c5): o contrato
  -- sai com o gestor/TL. Com valor real: formato validado como antes.
  IF _form IS NULL OR jsonb_typeof(_form) <> 'object' OR
    nullif(trim(coalesce(_cpf,'')),'') IS NULL
    OR NOT public.exclusive_valid_cpf(trim(_cpf))
    OR (public.creci_real(_creci) IS NOT NULL AND (length(trim(_creci)) NOT BETWEEN 4 AND 50
      OR trim(_creci) !~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'))
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

-- 3) Corretor do contrato: dados e o que falta (gestor/TL ativo da imobiliária, com CPF e CRECI) ----
CREATE OR REPLACE FUNCTION public.exclusive_contrato_corretor_pessoa(_user uuid, _org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _p public.profiles%ROWTYPE; _falta text[] := '{}'; _nome text; _cpf text; _creci text;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = _user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('id', _user, 'nome', '', 'email', '', 'cpf', '', 'creci', '', 'ok', false,
      'falta', jsonb_build_array('cadastro não encontrado'));
  END IF;
  _nome := btrim(regexp_replace(coalesce(_p.nome, ''), '\s+', ' ', 'g'));
  _cpf := btrim(coalesce(_p.cpf, ''));
  -- CRECI só zeros não conta como CRECI (t_77132312): gestor/TL assim não pode ser corretor do contrato.
  _creci := coalesce(public.creci_real(_p.creci), '');
  IF _p.ativo IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM public.organization_members m
      WHERE m.user_id = _user AND m.organization_id = _org AND m.ativo) THEN
    _falta := _falta || 'cadastro inativo ou de outra imobiliária'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user
      AND ur.organization_id = _org AND ur.role IN ('gestor', 'team_leader')) THEN
    _falta := _falta || 'papel de gestor ou team leader'::text;
  END IF;
  IF _nome !~ '^\S+\s+\S+' THEN _falta := _falta || 'nome com sobrenome'::text; END IF;
  IF NOT public.exclusive_valid_cpf(_cpf) THEN _falta := _falta || 'CPF válido'::text; END IF;
  IF length(_creci) NOT BETWEEN 4 AND 50 OR _creci !~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$' THEN
    _falta := _falta || 'CRECI no cadastro'::text;
  END IF;
  RETURN jsonb_build_object('id', _user, 'nome', _nome, 'email', lower(btrim(coalesce(_p.email, ''))),
    'cpf', CASE WHEN public.exclusive_valid_cpf(_cpf) THEN _cpf ELSE '' END,
    'creci', CASE WHEN 'CRECI no cadastro' = ANY(_falta) THEN '' ELSE _creci END,
    'ok', cardinality(_falta) = 0, 'falta', to_jsonb(_falta));
END $$;
REVOKE ALL ON FUNCTION public.exclusive_contrato_corretor_pessoa(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_contrato_corretor_pessoa(uuid, uuid) TO service_role;


-- 4) Captador que também é PROPRIETÁRIO não é testemunha (t_77132312, escopo aprovado por Denis 04/11) --
-- Parte do contrato não pode ser testemunha. Se o captador é um dos proprietários (CPF igual; sem CPF
-- de um dos lados, nome normalizado igual), as DUAS testemunhas são digitadas (nome, CPF, e-mail), com
-- a mesma validação da testemunha 2 digitada. Nenhuma testemunha pode ter o CPF/e-mail de um
-- proprietário nem do corretor do contrato. Captador que não é proprietário: como antes.
ALTER TABLE public.exclusive_captures
  ADD COLUMN IF NOT EXISTS testemunha_1_manual jsonb;
COMMENT ON COLUMN public.exclusive_captures.testemunha_1_manual IS
  'Captador que também é proprietário: testemunha 1 digitada {nome, cpf, email} (t_77132312). Validada no banco.';

CREATE OR REPLACE FUNCTION public.exclusive_nome_norm(_n text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT lower(translate(btrim(regexp_replace(coalesce(_n, ''), '\s+', ' ', 'g')),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;
REVOKE ALL ON FUNCTION public.exclusive_nome_norm(text) FROM PUBLIC, anon, authenticated;

-- Proprietários como lista de "quem não pode ser testemunha" (CPF só dígitos, e-mail minúsculo).
CREATE OR REPLACE FUNCTION public.exclusive_proprietarios_evitar(_form jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'cpf', regexp_replace(coalesce(x.o->>'cpf', ''), '[^0-9]', '', 'g'),
      'email', lower(btrim(coalesce(x.o->>'email', ''))),
      'nome', public.exclusive_nome_norm(x.o->>'nome_completo'),
      'quem', 'não pode ser proprietário do imóvel')), '[]'::jsonb)
  FROM jsonb_array_elements(public.exclusive_owner_list(_form)) x(o)
$$;
REVOKE ALL ON FUNCTION public.exclusive_proprietarios_evitar(jsonb) FROM PUBLIC, anon, authenticated;

-- O captador é um dos proprietários? CPF igual; se faltar CPF de um dos lados, nome normalizado igual.
CREATE OR REPLACE FUNCTION public.exclusive_captador_proprietario(_form jsonb, _cpf text, _nome text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH c AS (SELECT regexp_replace(coalesce(_cpf, ''), '[^0-9]', '', 'g') d,
                    public.exclusive_nome_norm(_nome) n)
  SELECT EXISTS (SELECT 1 FROM c, jsonb_array_elements(public.exclusive_proprietarios_evitar(_form)) e(o)
    WHERE (c.d <> '' AND e.o->>'cpf' = c.d)
       OR ((c.d = '' OR e.o->>'cpf' = '') AND c.n <> '' AND e.o->>'nome' = c.n))
$$;
REVOKE ALL ON FUNCTION public.exclusive_captador_proprietario(jsonb, text, text) FROM PUBLIC, anon, authenticated;

-- Conflitos de uma testemunha com quem não pode ser ela (mesmo CPF ou mesmo e-mail).
CREATE OR REPLACE FUNCTION public.exclusive_testemunha_conflitos(_p jsonb, _evitar jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(array_agg(DISTINCT 'ser outra pessoa (' || (e.o->>'quem') || ')'), '{}')
  FROM jsonb_array_elements(coalesce(_evitar, '[]'::jsonb)) e(o)
  WHERE _p IS NOT NULL AND jsonb_typeof(_p) = 'object' AND (
    (regexp_replace(coalesce(_p->>'cpf', ''), '[^0-9]', '', 'g') <> ''
      AND regexp_replace(coalesce(_p->>'cpf', ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(e.o->>'cpf', ''), '[^0-9]', '', 'g'))
    OR (btrim(coalesce(_p->>'email', '')) <> ''
      AND lower(btrim(_p->>'email')) = lower(btrim(coalesce(e.o->>'email', '')))))
$$;
REVOKE ALL ON FUNCTION public.exclusive_testemunha_conflitos(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Testemunha digitada: normaliza, valida e confere conflitos (NULL = não digitada).
CREATE OR REPLACE FUNCTION public.exclusive_testemunha_digitada(_m jsonb, _evitar jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE _falta text[] := '{}'; _nome text; _cpf text; _email text;
BEGIN
  IF _m IS NULL OR jsonb_typeof(_m) <> 'object' THEN RETURN NULL; END IF;
  _nome := btrim(regexp_replace(coalesce(_m->>'nome', ''), '\s+', ' ', 'g'));
  _cpf := regexp_replace(coalesce(_m->>'cpf', ''), '[^0-9]', '', 'g');
  _email := lower(btrim(coalesce(_m->>'email', '')));
  IF _nome !~ '^\S+\s+\S+' THEN _falta := _falta || 'nome com sobrenome'::text; END IF;
  IF NOT public.exclusive_valid_cpf(_cpf) THEN _falta := _falta || 'CPF válido'::text; END IF;
  IF _email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN _falta := _falta || 'e-mail válido'::text; END IF;
  _falta := _falta || public.exclusive_testemunha_conflitos(
    jsonb_build_object('cpf', _cpf, 'email', _email), _evitar);
  RETURN jsonb_build_object('id', NULL, 'nome', _nome, 'email', _email,
    'cpf', CASE WHEN public.exclusive_valid_cpf(_cpf) THEN _cpf ELSE '' END,
    'ok', cardinality(_falta) = 0, 'falta', to_jsonb(_falta), 'origem', 'manual');
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunha_digitada(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- 5) Resolvedor ------------------------------------------------------------------------------------
-- Captador com CRECI real e que NÃO é proprietário: mesmo resultado e mesma impressão digital de antes
-- (só ganha a recusa de testemunha automática com CPF/e-mail de proprietário).
CREATE OR REPLACE FUNCTION public.exclusive_testemunhas_resolver(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _lider uuid; _gestor uuid; _origem text; _motivo text;
  _cor jsonb; _ges jsonb; _probs text[] := '{}'; _doc_at timestamptz; _doc_path text; _pdf_ok boolean := false;
  _papel_ok boolean; _lider_nome text;
  _sem_creci boolean; _cc uuid; _cc_origem text; _ctr jsonb; _dados text; _algum_creci boolean;
  _cap jsonb; _cap_prop boolean; _donos jsonb; _evitar jsonb; _conf text[]; _t1 jsonb;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Sem CRECI = vazio ou sem valor real (só zeros, ex.: 0000000000) — t_77132312.
  _sem_creci := public.creci_real(_c.broker_creci) IS NULL;

  -- Gestor da equipe: líder da equipe em que o corretor é membro (team_members.membro_id é único).
  SELECT t.lider_id INTO _lider FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _c.organization_id
    WHERE tm.membro_id = _c.captor_id AND tm.organization_id = _c.organization_id LIMIT 1;
  SELECT nullif(btrim(p.nome), '') INTO _lider_nome FROM public.profiles p WHERE p.id = _lider;

  _cap := public.exclusive_testemunha_pessoa(_c.captor_id, _c.organization_id, _c.broker_cpf);
  _cor := _cap;
  _donos := public.exclusive_proprietarios_evitar(_c.form_data);
  _cap_prop := public.exclusive_captador_proprietario(_c.form_data,
    coalesce(nullif(_cap->>'cpf', ''), _c.broker_cpf), coalesce(nullif(_cap->>'nome', ''), _c.broker_name));

  IF NOT _cap_prop AND NOT (_cor->>'ok')::boolean THEN
    _probs := _probs || format('Testemunha 1 (corretor%s): falta %s no cadastro',
      coalesce(' ' || nullif(_cor->>'nome', ''), ''),
      (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_cor->'falta') x));
  END IF;

  IF NOT _sem_creci THEN
    IF NOT _cap_prop THEN
      -- ===== Captador com CRECI: regra de t_e8078685 =====
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
        -- Parte do contrato não é testemunha: gestor que também é proprietário (t_77132312).
        _conf := public.exclusive_testemunha_conflitos(_ges, _donos);
        IF cardinality(_conf) > 0 THEN
          _ges := jsonb_set(jsonb_set(_ges, '{ok}', 'false'), '{falta}', (_ges->'falta') || to_jsonb(_conf));
        END IF;
        _ges := _ges || jsonb_build_object('origem', _origem);
        IF NOT (_ges->>'ok')::boolean THEN
          _probs := _probs || format('Testemunha 2 (%s%s): falta %s. Peça para completar o cadastro ou escolha outro gestor ou team leader',
            CASE _origem WHEN 'equipe' THEN 'gestor da equipe' ELSE 'escolhida' END,
            coalesce(' ' || nullif(_ges->>'nome', ''), ''),
            (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_ges->'falta') x));
        END IF;
      END IF;
    END IF;
  ELSE
    -- ===== Captador SEM CRECI (t_e75b58c5) =====
    -- Corretor do contrato: o escolhido pelo staff ou o líder da equipe (nunca o próprio captador).
    IF _c.contrato_corretor_id IS NOT NULL AND _c.contrato_corretor_id <> _c.captor_id THEN
      _cc := _c.contrato_corretor_id; _cc_origem := 'escolhido';
    ELSIF _lider IS NOT NULL AND _lider <> _c.captor_id THEN
      _cc := _lider; _cc_origem := 'equipe';
    END IF;
    _ctr := public.exclusive_contrato_corretor_pessoa(_cc, _c.organization_id);
    IF _ctr IS NOT NULL THEN _ctr := _ctr || jsonb_build_object('origem', _cc_origem); END IF;
    IF _ctr IS NULL OR NOT (_ctr->>'ok')::boolean THEN
      _algum_creci := EXISTS (SELECT 1 FROM public.user_roles ur
        WHERE ur.organization_id = _c.organization_id AND ur.role IN ('gestor', 'team_leader')
          AND ur.user_id <> _c.captor_id
          AND (public.exclusive_contrato_corretor_pessoa(ur.user_id, _c.organization_id)->>'ok')::boolean);
      IF NOT _algum_creci THEN
        _probs := _probs || 'Corretor do contrato: o captador não tem CRECI e nenhum gestor ou team leader desta imobiliária tem CRECI e CPF válidos no cadastro. O contrato não pode ser gerado sem CRECI: cadastre o CRECI de um gestor/TL (ou do captador)'::text;
      ELSIF _ctr IS NULL THEN
        _probs := _probs || 'Corretor do contrato: o captador não tem CRECI e não está em equipe com líder. Escolha um gestor ou team leader com CRECI'::text;
      ELSE
        _probs := _probs || format('Corretor do contrato (%s%s): falta %s. Complete o cadastro ou escolha outro gestor ou team leader com CRECI',
          CASE _cc_origem WHEN 'equipe' THEN 'gestor da equipe' ELSE 'escolhido' END,
          coalesce(' ' || nullif(_ctr->>'nome', ''), ''),
          (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_ctr->'falta') x));
      END IF;
    END IF;
  END IF;

  -- Quem nunca pode ser testemunha digitada: proprietários e o corretor do contrato.
  _evitar := _donos || CASE WHEN _ctr IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
    'cpf', _ctr->>'cpf', 'email', _ctr->>'email', 'quem', 'não pode ser o corretor do contrato')) ELSE '[]'::jsonb END;

  IF _cap_prop THEN
    -- ===== Captador é proprietário: as duas testemunhas são digitadas (t_77132312) =====
    _evitar := _evitar || jsonb_build_array(jsonb_build_object('cpf', _cap->>'cpf', 'email', _cap->>'email',
      'quem', 'não pode ser o captador, que é proprietário'));
    _t1 := public.exclusive_testemunha_digitada(_c.testemunha_1_manual, _evitar);
    _ges := public.exclusive_testemunha_digitada(_c.testemunha_2_manual, _evitar
      || CASE WHEN _t1 IS NOT NULL THEN jsonb_build_array(jsonb_build_object('cpf', _t1->>'cpf',
        'email', _t1->>'email', 'quem', 'não pode ser a testemunha 1')) ELSE '[]'::jsonb END);
    IF _t1 IS NULL THEN
      _probs := _probs || 'Testemunha 1: o captador também é proprietário deste imóvel e não pode ser testemunha. Digite a testemunha 1 (nome, CPF e e-mail)'::text;
    ELSIF NOT (_t1->>'ok')::boolean THEN
      _probs := _probs || format('Testemunha 1 (digitada%s): falta %s', coalesce(' ' || nullif(_t1->>'nome', ''), ''),
        (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_t1->'falta') x));
    END IF;
    IF _ges IS NULL THEN
      _probs := _probs || 'Testemunha 2: o captador também é proprietário deste imóvel e não pode ser testemunha. Digite a testemunha 2 (nome, CPF e e-mail)'::text;
    ELSIF NOT (_ges->>'ok')::boolean THEN
      _probs := _probs || format('Testemunha 2 (digitada%s): falta %s', coalesce(' ' || nullif(_ges->>'nome', ''), ''),
        (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_ges->'falta') x));
    END IF;
    _cor := coalesce(_t1, jsonb_build_object('id', NULL, 'nome', '', 'email', '', 'cpf', '', 'ok', false,
      'falta', jsonb_build_array('não informada'), 'origem', 'manual'));
    _gestor := NULL;
  ELSIF _sem_creci THEN
    -- Testemunha 2 digitada (t_e75b58c5): não pode ser o captador, o corretor do contrato nem proprietário.
    _ges := public.exclusive_testemunha_digitada(_c.testemunha_2_manual, jsonb_build_array(jsonb_build_object(
      'cpf', _cap->>'cpf', 'email', _cap->>'email', 'quem', 'o captador já é a testemunha 1')) || _evitar);
    IF _ges IS NULL THEN
      _probs := _probs || 'Testemunha 2: o captador não tem CRECI, então a testemunha 2 é digitada. Informe nome, CPF e e-mail'::text;
    ELSIF NOT (_ges->>'ok')::boolean THEN
      _probs := _probs || format('Testemunha 2 (digitada%s): falta %s',
        coalesce(' ' || nullif(_ges->>'nome', ''), ''),
        (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_ges->'falta') x));
    END IF;
  END IF;

  IF _sem_creci THEN
    -- Impressão digital inclui o bloco corretor do contrato (nome, CPF, CRECI).
    _dados := md5(public.exclusive_testemunhas_assinatura(_cor, _ges) || '|' || coalesce(_ctr->>'nome', '')
      || '|' || coalesce(_ctr->>'cpf', '') || '|' || coalesce(_ctr->>'creci', ''));
  ELSE
    _dados := public.exclusive_testemunhas_assinatura(_cor, _ges);
  END IF;

  SELECT d.created_at, d.storage_path INTO _doc_at, _doc_path FROM public.exclusive_documents d
    WHERE d.capture_id = _id AND d.kind = 'gerado';
  _pdf_ok := _doc_at IS NOT NULL AND _c.testemunhas_pdf IS NOT NULL
    AND (_c.testemunhas_pdf->>'path') = _doc_path
    AND (_c.testemunhas_pdf->>'corretor_id')::uuid IS NOT DISTINCT FROM (CASE WHEN _cap_prop THEN NULL ELSE _c.captor_id END)
    AND (_c.testemunhas_pdf->>'gestor_id')::uuid IS NOT DISTINCT FROM _gestor
    AND (_c.testemunhas_pdf->>'contrato_id')::uuid IS NOT DISTINCT FROM (CASE WHEN _sem_creci THEN _cc END)
    AND (_c.testemunhas_pdf->>'dados') = _dados;

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
    'pdf_ok', coalesce(_pdf_ok, false),
    'dados', _dados,
    'captador_proprietario', _cap_prop)
    || CASE WHEN _sem_creci THEN jsonb_build_object(
      'modo', 'sem_creci',
      'contrato', _ctr,
      'contrato_escolhido', _cc_origem = 'escolhido')
    ELSE jsonb_build_object('modo', 'padrao') END;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas_resolver(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunhas_resolver(uuid) TO service_role;

-- 6) Tela: resumo (sem e-mail; CPF e testemunhas digitadas só para quem gere) -----------------------
CREATE OR REPLACE FUNCTION public.exclusive_testemunhas(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _acesso text := public.exclusive_testemunhas_acesso(_id); _r jsonb; _c public.exclusive_captures%ROWTYPE;
BEGIN
  IF _acesso IS NULL THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  _r := public.exclusive_testemunhas_resolver(_id);
  _r := jsonb_set(_r, '{corretor}', (_r->'corretor') - 'email');
  IF _r->'gestor' IS NOT NULL AND jsonb_typeof(_r->'gestor') = 'object' THEN
    _r := jsonb_set(_r, '{gestor}', (_r->'gestor') - 'email');
  END IF;
  IF jsonb_typeof(_r->'contrato') = 'object' THEN
    _r := jsonb_set(_r, '{contrato}', (_r->'contrato') - 'email');
  END IF;
  IF _acesso <> 'gerir' THEN
    _r := _r - 'dados';
    _r := jsonb_set(_r, '{corretor}', (_r->'corretor') - 'cpf');
    IF jsonb_typeof(_r->'gestor') = 'object' THEN
      _r := jsonb_set(_r, '{gestor}', (_r->'gestor') - 'cpf');
    END IF;
    IF jsonb_typeof(_r->'contrato') = 'object' THEN
      _r := jsonb_set(_r, '{contrato}', (_r->'contrato') - 'cpf');
    END IF;
  ELSIF _r->>'modo' = 'sem_creci' OR (_r->>'captador_proprietario')::boolean THEN
    -- Quem gere vê o que digitou (para corrigir), inclusive o e-mail.
    SELECT * INTO _c FROM public.exclusive_captures c WHERE c.id = _id;
    IF _c.testemunha_2_manual IS NOT NULL THEN _r := _r || jsonb_build_object('manual', _c.testemunha_2_manual); END IF;
    IF (_r->>'captador_proprietario')::boolean AND _c.testemunha_1_manual IS NOT NULL THEN
      _r := _r || jsonb_build_object('manual_1', _c.testemunha_1_manual);
    END IF;
  END IF;
  RETURN _r || jsonb_build_object('pode_gerir', _acesso = 'gerir');
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunhas(uuid) TO authenticated;

-- Trava comum das escolhas da tela (antes da assinatura e sem envelope em andamento).
CREATE OR REPLACE FUNCTION public.exclusive_testemunhas_editavel(_id uuid)
RETURNS public.exclusive_captures LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE;
BEGIN
  IF coalesce(public.exclusive_testemunhas_acesso(_id), '') <> 'gerir' THEN
    RAISE EXCEPTION 'Apenas gestor, team leader, jurídico ou admin da imobiliária pode alterar o contrato';
  END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF _c.manual OR _c.archived_at IS NOT NULL OR _c.discarded_at IS NOT NULL
     OR _c.status NOT IN ('rascunho', 'devolvida', 'enviada') THEN
    RAISE EXCEPTION 'Só é possível alterar antes de o contrato ir para assinatura';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clicksign_envelopes e WHERE e.capture_id = _id
      AND e.status IN ('sending', 'running')) THEN
    RAISE EXCEPTION 'Este contrato já está em envio ou em assinatura na Clicksign';
  END IF;
  RETURN _c;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas_editavel(uuid) FROM PUBLIC, anon, authenticated;

-- Corretor do contrato: só para captador sem CRECI (real).
CREATE OR REPLACE FUNCTION public.exclusive_contrato_editavel(_id uuid)
RETURNS public.exclusive_captures LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE;
BEGIN
  _c := public.exclusive_testemunhas_editavel(_id);
  IF public.creci_real(_c.broker_creci) IS NOT NULL THEN
    RAISE EXCEPTION 'O captador tem CRECI: o contrato sai com ele e as testemunhas são as automáticas';
  END IF;
  RETURN _c;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_contrato_editavel(uuid) FROM PUBLIC, anon, authenticated;

-- 9) Tela: gravar testemunha digitada 1 ou 2 (tudo vazio = apaga). A validação é a do resolvedor:
-- grava, relê e, se a testemunha ficou incompleta ou em conflito, desfaz com o motivo.
CREATE OR REPLACE FUNCTION public.exclusive_testemunha_manual_salvar(_id uuid, _qual integer,
  _nome text, _cpf text, _email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _m jsonb; _r jsonb; _p jsonb; _prop boolean;
BEGIN
  IF _qual IS NULL OR _qual NOT IN (1, 2) THEN RAISE EXCEPTION 'Testemunha inválida'; END IF;
  _c := public.exclusive_testemunhas_editavel(_id);
  _r := public.exclusive_testemunhas_resolver(_id);
  _prop := coalesce((_r->>'captador_proprietario')::boolean, false);
  IF NOT _prop AND _r->>'modo' <> 'sem_creci' THEN
    RAISE EXCEPTION 'O captador tem CRECI: o contrato sai com ele e as testemunhas são as automáticas';
  END IF;
  IF _qual = 1 AND NOT _prop THEN
    RAISE EXCEPTION 'A testemunha 1 só é digitada quando o captador também é proprietário';
  END IF;
  IF coalesce(btrim(_nome), '') = '' AND coalesce(btrim(_cpf), '') = '' AND coalesce(btrim(_email), '') = '' THEN
    _m := NULL;
  ELSE
    IF length(coalesce(_nome, '')) > 200 OR length(coalesce(_cpf, '')) > 20 OR length(coalesce(_email, '')) > 254 THEN
      RAISE EXCEPTION 'Dados da testemunha % grandes demais', _qual;
    END IF;
    _m := jsonb_build_object('nome', btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')),
      'cpf', regexp_replace(coalesce(_cpf, ''), '[^0-9]', '', 'g'), 'email', lower(btrim(coalesce(_email, ''))));
  END IF;
  IF _m IS NOT DISTINCT FROM (CASE _qual WHEN 1 THEN _c.testemunha_1_manual ELSE _c.testemunha_2_manual END) THEN
    RETURN public.exclusive_testemunhas(_id);
  END IF;
  IF _qual = 1 THEN
    UPDATE public.exclusive_captures SET testemunha_1_manual = _m WHERE id = _id;
  ELSE
    UPDATE public.exclusive_captures SET testemunha_2_manual = _m WHERE id = _id;
  END IF;
  IF _m IS NOT NULL THEN
    _r := public.exclusive_testemunhas_resolver(_id);
    _p := CASE _qual WHEN 1 THEN _r->'corretor' ELSE _r->'gestor' END;
    IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR NOT (_p->>'ok')::boolean THEN
      RAISE EXCEPTION 'Testemunha %: falta %', _qual,
        coalesce((SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_p->'falta') x), 'dados');
    END IF;
  END IF;
  -- Histórico só com o nome (sem CPF nem e-mail).
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_id, auth.uid(), 'testemunha_digitada', CASE WHEN _m IS NULL
      THEN format('Testemunha %s digitada: apagada', _qual)
      ELSE format('Testemunha %s digitada: %s', _qual, _m->>'nome') END);
  RETURN public.exclusive_testemunhas(_id);
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunha_manual_salvar(uuid, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunha_manual_salvar(uuid, integer, text, text, text) TO authenticated;

-- Compatibilidade: a chamada antiga (testemunha 2) usa a função nova.
CREATE OR REPLACE FUNCTION public.exclusive_testemunha_2_manual_salvar(_id uuid, _nome text, _cpf text, _email text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.exclusive_testemunha_manual_salvar(_id, 2, _nome, _cpf, _email)
$$;
REVOKE ALL ON FUNCTION public.exclusive_testemunha_2_manual_salvar(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_testemunha_2_manual_salvar(uuid, text, text, text) TO authenticated;

-- 11) Transferência do captador: zera também as testemunhas digitadas ------------------------------
CREATE OR REPLACE FUNCTION public.exclusive_testemunhas_reset_captor()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.captor_id IS DISTINCT FROM OLD.captor_id THEN
    NEW.testemunha_gestor_id := NULL;
    NEW.testemunhas_pdf := NULL;
    NEW.contrato_corretor_id := NULL;
    NEW.testemunha_1_manual := NULL;
    NEW.testemunha_2_manual := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_testemunhas_reset_captor() FROM PUBLIC, anon, authenticated;

-- 12) signed_on só depois da assinatura de verdade (t_77132312, escopo 2) -------------------------
-- Origem comprovada: "Salvar data" (exclusive_confirmar_data_assinatura) e exclusive_set_signed_on
-- aceitavam captação enviada/em_assinatura SEM contrato assinado: o corretor gravava a data antes de
-- qualquer assinatura e a vigência começava a contar. Agora, antes da aprovação, só grava com o
-- contrato assinado VÁLIDO anexado (mesmo critério do 'aprovar': no fluxo normal, anexado depois do
-- gerado; no cadastro manual, o assinado de papel). A Clicksign anexa o assinado ao concluir.
-- "Corrigir data" do gestor depois da aprovação continua igual. Nenhum dado é alterado aqui.
CREATE OR REPLACE FUNCTION public.exclusive_tem_assinado_valido(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN c.manual
    THEN EXISTS (SELECT 1 FROM public.exclusive_documents a WHERE a.capture_id = c.id AND a.kind = 'assinado')
    ELSE EXISTS (SELECT 1 FROM public.exclusive_documents g JOIN public.exclusive_documents a
      ON a.capture_id = g.capture_id AND a.kind = 'assinado' AND a.created_at >= g.created_at
      WHERE g.capture_id = c.id AND g.kind = 'gerado') END
  FROM public.exclusive_captures c WHERE c.id = _id
$$;
REVOKE ALL ON FUNCTION public.exclusive_tem_assinado_valido(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_tem_assinado_valido(uuid) TO service_role;
-- exclusive_confirmar_data_assinatura roda como mt_1b_definer (dono): precisa executar a checagem.
GRANT EXECUTE ON FUNCTION public.exclusive_tem_assinado_valido(uuid) TO mt_1b_definer;

CREATE OR REPLACE FUNCTION public.exclusive_confirmar_data_assinatura(_id uuid, _date date, _data_pdf date DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _uid uuid := auth.uid(); _gestor boolean; _captor boolean;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; _origem text;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR _uid IS NULL THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  _gestor := public.exclusive_is_manager(_id, _uid);
  _captor := _c.captor_id = _uid AND public.exclusive_can_view(_id, _uid);
  IF NOT (_gestor OR _captor) OR _c.archived_at IS NOT NULL OR _c.discarded_at IS NOT NULL
  THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  -- Confirmação é antes da aprovação; depois dela o gestor usa "Corrigir data" (exclusive_set_signed_on).
  IF _c.status NOT IN ('enviada','em_assinatura') THEN
    RAISE EXCEPTION 'Captação aprovada: só o gestor corrige a data de assinatura';
  END IF;
  -- t_77132312: antes da aprovação, só com o contrato assinado válido anexado.
  IF _c.status <> 'aprovada' AND NOT coalesce(public.exclusive_tem_assinado_valido(_id), false) THEN
    RAISE EXCEPTION 'A data de assinatura só pode ser informada depois que o contrato estiver assinado e anexado';
  END IF;
  IF _date IS NULL OR _date > _hoje OR _date < date '2000-01-01'
     OR (NOT _c.manual AND _date < _c.created_on_sp)
  THEN RAISE EXCEPTION 'Data de assinatura inválida (não pode ser futura nem anterior à criação da captação)'; END IF;
  IF _data_pdf IS NOT NULL AND (_data_pdf > _hoje OR _data_pdf < date '2000-01-01') THEN _data_pdf := NULL; END IF;
  _origem := CASE WHEN _data_pdf IS NULL THEN 'informada (sem data lida do PDF)'
                  WHEN _data_pdf = _date THEN 'lida do PDF assinado e confirmada'
                  ELSE 'corrigida (o PDF indicava ' || to_char(_data_pdf, 'DD/MM/YYYY') || ')' END
          || CASE WHEN _captor AND NOT _gestor THEN ' pelo corretor' ELSE ' pelo gestor' END;
  UPDATE public.exclusive_captures SET signed_on = _date, updated_at = now() WHERE id = _id;
  INSERT INTO public.exclusive_history(capture_id, actor_id, action, detail)
    VALUES (_id, _uid, 'data_assinatura', to_char(_date, 'DD/MM/YYYY') || ' · ' || _origem);
END $function$;
-- Mesmo dono de exclusive_set_signed_on (padrão das RPCs que gravam na captação).
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_confirmar_data_assinatura(uuid, date, date) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_confirmar_data_assinatura(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_confirmar_data_assinatura(uuid, date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exclusive_set_signed_on(_id uuid, _date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _uid uuid := auth.uid(); _gestor boolean; _captor boolean;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  _gestor := public.exclusive_is_manager(_id, _uid);
  _captor := _c.captor_id = _uid AND public.exclusive_can_view(_id, _uid);
  IF NOT (_gestor OR _captor) THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  IF _c.status NOT IN ('enviada','em_assinatura','aprovada') THEN RAISE EXCEPTION 'Captação ainda não foi enviada'; END IF;
  IF _c.status = 'aprovada' AND NOT _gestor THEN
    RAISE EXCEPTION 'Captação aprovada: só o gestor corrige a data de assinatura';
  END IF;
  -- t_77132312: antes da aprovação, só com o contrato assinado válido anexado.
  IF _c.status <> 'aprovada' AND NOT coalesce(public.exclusive_tem_assinado_valido(_id), false) THEN
    RAISE EXCEPTION 'A data de assinatura só pode ser informada depois que o contrato estiver assinado e anexado';
  END IF;
  IF _date IS NULL OR _date > (now() AT TIME ZONE 'America/Sao_Paulo')::date OR _date < date '2000-01-01'
  THEN RAISE EXCEPTION 'Data de assinatura inválida'; END IF;
  UPDATE public.exclusive_captures SET signed_on = _date, updated_at = now() WHERE id = _id;
  INSERT INTO public.exclusive_history(capture_id, actor_id, action, detail)
    VALUES (_id, _uid, 'data_assinatura', to_char(_date, 'DD/MM/YYYY'));
END $function$;

COMMIT;
