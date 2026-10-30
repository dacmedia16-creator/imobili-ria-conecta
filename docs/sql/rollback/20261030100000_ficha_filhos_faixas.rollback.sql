-- Rollback de 20261030100000_ficha_filhos_faixas (t_27d37c57): volta as 3 RPCs da ficha EXATAMENTE como
-- estavam (ficha_salvar_minha da 20261029130000; ficha_minha_situacao e ficha_colaboradores_listar da
-- 20261029160000, textos copiados) e remove a coluna filhos_faixas.
-- ATENÇÃO: remover a coluna apaga as faixas marcadas desde a publicação. Se quiser guardar, antes rode:
--   CREATE TABLE public._bkp_filhos_faixas AS SELECT user_id, filhos_faixas FROM public.colaborador_fichas
--    WHERE cardinality(filhos_faixas) > 0;
BEGIN;

DROP FUNCTION IF EXISTS public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean, text[]);
-- Grava a própria ficha (e a data de nascimento). Valida tudo no banco; exige o aceite do aviso.
CREATE OR REPLACE FUNCTION public.ficha_salvar_minha(
  _qtd_filhos integer,
  _tem_plano_saude boolean,
  _plano_saude text,
  _emergencia_nome text,
  _emergencia_parentesco text,
  _emergencia_telefone text,
  _hospital_preferencia text,
  _religiao text,
  _data_nascimento date,
  _ciente boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _plano text := nullif(btrim(regexp_replace(coalesce(_plano_saude, ''), '\s+', ' ', 'g')), '');
  _en text := nullif(btrim(regexp_replace(coalesce(_emergencia_nome, ''), '\s+', ' ', 'g')), '');
  _ep text := nullif(btrim(regexp_replace(coalesce(_emergencia_parentesco, ''), '\s+', ' ', 'g')), '');
  _et text := nullif(btrim(coalesce(_emergencia_telefone, '')), '');
  _hosp text := nullif(btrim(regexp_replace(coalesce(_hospital_preferencia, ''), '\s+', ' ', 'g')), '');
  _rel text := nullif(btrim(regexp_replace(coalesce(_religiao, ''), '\s+', ' ', 'g')), '');
  _dig integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF public.ficha_sessao_restrita() THEN
    RAISE EXCEPTION 'A ficha so pode ser preenchida pela propria pessoa' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL THEN RAISE EXCEPTION 'Sem imobiliaria ativa' USING ERRCODE = '42501'; END IF;

  IF _ciente IS NOT TRUE THEN
    RAISE EXCEPTION 'Confirme que leu o aviso de uso dos dados' USING ERRCODE = '22023';
  END IF;
  IF _qtd_filhos IS NULL OR _qtd_filhos < 0 OR _qtd_filhos > 30 THEN
    RAISE EXCEPTION 'Quantidade de filhos invalida' USING ERRCODE = '22023';
  END IF;
  IF _tem_plano_saude IS NULL THEN
    RAISE EXCEPTION 'Informe se tem plano de saude' USING ERRCODE = '22023';
  END IF;
  IF _tem_plano_saude AND (_plano IS NULL OR char_length(_plano) < 2 OR char_length(_plano) > 120) THEN
    RAISE EXCEPTION 'Informe qual e o plano de saude' USING ERRCODE = '22023';
  END IF;
  IF NOT _tem_plano_saude THEN _plano := NULL; END IF;
  IF _en IS NULL OR char_length(_en) < 2 OR char_length(_en) > 120 THEN
    RAISE EXCEPTION 'Informe o nome do contato de emergencia' USING ERRCODE = '22023';
  END IF;
  IF _ep IS NULL OR char_length(_ep) < 2 OR char_length(_ep) > 60 THEN
    RAISE EXCEPTION 'Informe o parentesco do contato de emergencia' USING ERRCODE = '22023';
  END IF;
  _dig := char_length(regexp_replace(coalesce(_et, ''), '\D', '', 'g'));
  IF _dig < 10 OR _dig > 13 OR char_length(_et) > 20 OR _et !~ '^[0-9()+\-. ]+$' THEN
    RAISE EXCEPTION 'Telefone de emergencia invalido (com DDD)' USING ERRCODE = '22023';
  END IF;
  IF _hosp IS NULL OR char_length(_hosp) < 2 OR char_length(_hosp) > 160 THEN
    RAISE EXCEPTION 'Informe o hospital de preferencia' USING ERRCODE = '22023';
  END IF;
  IF _rel IS NOT NULL AND char_length(_rel) > 60 THEN
    RAISE EXCEPTION 'Religiao muito longa' USING ERRCODE = '22023';
  END IF;
  IF NOT public.profile_birthdate_valida(_data_nascimento) THEN
    RAISE EXCEPTION 'Data de nascimento invalida' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profile_birthdates (user_id, data_nascimento) VALUES (_uid, _data_nascimento)
  ON CONFLICT (user_id) DO UPDATE SET data_nascimento = EXCLUDED.data_nascimento, updated_at = now()
    WHERE public.profile_birthdates.data_nascimento IS DISTINCT FROM EXCLUDED.data_nascimento;

  INSERT INTO public.colaborador_fichas AS f (user_id, organization_id, qtd_filhos, tem_plano_saude,
      plano_saude, emergencia_nome, emergencia_parentesco, emergencia_telefone, hospital_preferencia,
      religiao)
  VALUES (_uid, _org, _qtd_filhos, _tem_plano_saude, _plano, _en, _ep, _et, _hosp, _rel)
  ON CONFLICT (user_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    qtd_filhos = EXCLUDED.qtd_filhos,
    tem_plano_saude = EXCLUDED.tem_plano_saude,
    plano_saude = EXCLUDED.plano_saude,
    emergencia_nome = EXCLUDED.emergencia_nome,
    emergencia_parentesco = EXCLUDED.emergencia_parentesco,
    emergencia_telefone = EXCLUDED.emergencia_telefone,
    hospital_preferencia = EXCLUDED.hospital_preferencia,
    religiao = EXCLUDED.religiao,
    updated_at = now();

  RETURN public.ficha_minha_situacao();
END $$;
REVOKE ALL ON FUNCTION public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean) TO authenticated;

-- 3) Situação da própria pessoa (mesma RPC do porteiro, agora com o cadastro) -------------------------
CREATE OR REPLACE FUNCTION public.ficha_minha_situacao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _desde timestamptz;
  _f public.colaborador_fichas;
  _nasc date;
  _completa boolean;
  _pend text[] := ARRAY[]::text[];
  _exige boolean := false;
  _p record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF public.ficha_sessao_restrita() THEN
    RETURN jsonb_build_object('aplica', false, 'motivo', 'sessao_restrita');
  END IF;
  -- Conta do dono da plataforma não preenche ficha de imobiliária (mesma exceção dos outros porteiros).
  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _uid) THEN
    RETURN jsonb_build_object('aplica', false, 'motivo', 'plataforma');
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL THEN RETURN jsonb_build_object('aplica', false, 'motivo', 'sem_imobiliaria'); END IF;

  _desde := public.ficha_obrigatoria_desde(_org);
  SELECT * INTO _f FROM public.colaborador_fichas WHERE user_id = _uid;
  SELECT b.data_nascimento INTO _nasc FROM public.profile_birthdates b WHERE b.user_id = _uid;
  _completa := public.ficha_esta_completa(_f, _nasc);
  -- Cadastro: erro no cálculo = sem pendência (nunca trava por erro).
  BEGIN
    _exige := public.cadastro_exige_registro(_uid, _org);
    _pend := public.cadastro_pendencias(_uid, _org);
  EXCEPTION WHEN others THEN
    _exige := false;
    _pend := ARRAY[]::text[];
  END;
  SELECT p.nome, p.telefone, p.cpf, p.remax_id INTO _p FROM public.profiles p WHERE p.id = _uid;

  RETURN jsonb_build_object(
    'aplica', true,
    'completa', _completa,
    'cadastro_completo', cardinality(_pend) = 0,
    'cadastro_pendente', to_jsonb(_pend),
    'cadastro_exige_registro', _exige,
    'cadastro', jsonb_build_object(
      'nome', _p.nome,
      'telefone', _p.telefone,
      'cpf', CASE WHEN _exige THEN _p.cpf END,
      'remax_id', CASE WHEN _exige THEN _p.remax_id END),
    'obrigatoria_a_partir_de', _desde,
    'bloqueia', (NOT _completa OR cardinality(_pend) > 0) AND now() >= _desde,
    'data_nascimento', _nasc,
    'ficha', CASE WHEN _f.user_id IS NULL THEN NULL ELSE jsonb_build_object(
      'qtd_filhos', _f.qtd_filhos,
      'tem_plano_saude', _f.tem_plano_saude,
      'plano_saude', _f.plano_saude,
      'emergencia_nome', _f.emergencia_nome,
      'emergencia_parentesco', _f.emergencia_parentesco,
      'emergencia_telefone', _f.emergencia_telefone,
      'hospital_preferencia', _f.hospital_preferencia,
      'religiao', _f.religiao,
      'aceite_em', _f.aceite_em,
      'preenchida_em', _f.preenchida_em,
      'updated_at', _f.updated_at) END);
END $$;
REVOKE ALL ON FUNCTION public.ficha_minha_situacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_minha_situacao() TO authenticated;

-- 5) Tela do staff: + cadastro_pendente (só as chaves do que falta, sem valores) ----------------------
-- shortcut: devolve a imobiliária inteira de uma vez (filtros na tela); paginar se passar de ~2 mil pessoas.
CREATE OR REPLACE FUNCTION public.ficha_colaboradores_listar() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid;
BEGIN
  IF NOT public.ficha_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'Sem permissao para ver as fichas dos colaboradores' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  RETURN jsonb_build_object(
    'obrigatoria_a_partir_de', public.ficha_obrigatoria_desde(_org),
    'colaboradores', coalesce((
      SELECT jsonb_agg(x.j ORDER BY x.nome) FROM (
        SELECT p.nome, jsonb_build_object(
          'user_id', p.id,
          'nome', p.nome,
          'email', p.email,
          'telefone', p.telefone,
          'papeis', coalesce((SELECT jsonb_agg(DISTINCT ur.role::text) FROM public.user_roles ur
                               WHERE ur.user_id = p.id AND ur.organization_id = _org), '[]'::jsonb),
          'equipes', coalesce((SELECT jsonb_agg(DISTINCT t.nome) FROM public.teams t
                                WHERE t.organization_id = _org
                                  AND (t.lider_id = p.id OR EXISTS (
                                        SELECT 1 FROM public.team_members tm
                                         WHERE tm.team_id = t.id AND tm.membro_id = p.id))), '[]'::jsonb),
          'data_nascimento', b.data_nascimento,
          'completa', public.ficha_esta_completa(f, b.data_nascimento),
          'cadastro_pendente', to_jsonb(public.cadastro_pendencias(p.id, _org)),
          'qtd_filhos', f.qtd_filhos,
          'tem_plano_saude', f.tem_plano_saude,
          'plano_saude', f.plano_saude,
          'emergencia_nome', f.emergencia_nome,
          'emergencia_parentesco', f.emergencia_parentesco,
          'emergencia_telefone', f.emergencia_telefone,
          'hospital_preferencia', f.hospital_preferencia,
          'religiao', f.religiao,
          'preenchida_em', f.preenchida_em,
          'updated_at', f.updated_at) AS j
        FROM public.organization_members m
        JOIN public.profiles p ON p.id = m.user_id AND p.ativo IS TRUE
        LEFT JOIN public.colaborador_fichas f ON f.user_id = p.id AND f.organization_id = _org
        LEFT JOIN public.profile_birthdates b ON b.user_id = p.id
        WHERE m.organization_id = _org AND m.ativo
          AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p.id)
      ) x), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.ficha_colaboradores_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_colaboradores_listar() TO authenticated;

ALTER TABLE public.colaborador_fichas DROP CONSTRAINT IF EXISTS colaborador_fichas_filhos_faixas_validas;
ALTER TABLE public.colaborador_fichas DROP COLUMN IF EXISTS filhos_faixas;

NOTIFY pgrst, 'reload schema';
COMMIT;
