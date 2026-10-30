-- Faixa de idade dos filhos na ficha pessoal (t_27d37c57, pedido de Denis em 30/10/2026, tópico 6238).
--
-- A pergunta "tem filhos" é o campo "Quantidade de filhos" da ficha (colaborador_fichas.qtd_filhos).
-- Quando a quantidade é 1 ou mais, a pessoa pode marcar UMA OU MAIS faixas de idade:
--   '0-5' = 0 a 5 anos, '6-10' = 6 a 10 anos, '11-15' = 11 a 15 anos, '16+' = 16 anos ou mais.
-- Regras:
--   * opcional: não entra em ficha_esta_completa e não bloqueia salvar;
--   * quantidade 0 → as faixas são limpas (gravadas vazias);
--   * _filhos_faixas NULL (tela antiga, sem o campo) → mantém as faixas já gravadas;
--   * valores fora da lista são recusados (22023); repetidos são ignorados; a ordem é a da lista.
-- Aditiva: só cria a coluna (fichas existentes ficam com lista vazia) e recria as 3 RPCs da ficha
-- devolvendo/gravando o campo. Nenhum dado existente é alterado.
-- ficha_salvar_minha ganha o 11º parâmetro com DEFAULT NULL: chamadas antigas (10 parâmetros, por
-- nome ou posição) continuam funcionando.
--
-- Rollback: docs/sql/rollback/20261030100000_ficha_filhos_faixas.rollback.sql
-- Sem BEGIN/COMMIT próprios (o teste a inclui numa transação desfeita).

-- 1) Coluna ------------------------------------------------------------------------------------------
ALTER TABLE public.colaborador_fichas
  ADD COLUMN IF NOT EXISTS filhos_faixas text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'colaborador_fichas_filhos_faixas_validas'
                    AND conrelid = 'public.colaborador_fichas'::regclass) THEN
    ALTER TABLE public.colaborador_fichas
      ADD CONSTRAINT colaborador_fichas_filhos_faixas_validas
      CHECK (filhos_faixas <@ ARRAY['0-5', '6-10', '11-15', '16+']::text[]
             AND (qtd_filhos > 0 OR cardinality(filhos_faixas) = 0));
  END IF;
END $$;

COMMENT ON COLUMN public.colaborador_fichas.filhos_faixas IS
  'Faixas de idade dos filhos (0-5, 6-10, 11-15, 16+), múltipla escolha e opcional; vazia quando qtd_filhos = 0.';

-- 2) Situação da própria pessoa: igual à 20261029160000 + filhos_faixas -------------------------------
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
      'filhos_faixas', to_jsonb(coalesce(_f.filhos_faixas, ARRAY[]::text[])),
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

-- 3) Gravar a própria ficha: igual à 20261029130000 + _filhos_faixas (opcional) ----------------------
-- Troca de assinatura (10 → 11 parâmetros): remove a antiga para não ficar ambígua para o PostgREST.
DROP FUNCTION IF EXISTS public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean);
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
  _ciente boolean,
  _filhos_faixas text[] DEFAULT NULL
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
  _faixas_ok constant text[] := ARRAY['0-5', '6-10', '11-15', '16+'];
  _faixas text[];
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
  IF _filhos_faixas IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(_filhos_faixas) x WHERE x IS NULL OR NOT (x = ANY (_faixas_ok))) THEN
      RAISE EXCEPTION 'Faixa de idade dos filhos invalida' USING ERRCODE = '22023';
    END IF;
    -- Sem repetidos, na ordem da lista.
    SELECT coalesce(array_agg(o.f ORDER BY o.n), ARRAY[]::text[]) INTO _faixas
      FROM unnest(_faixas_ok) WITH ORDINALITY AS o(f, n)
     WHERE o.f = ANY (_filhos_faixas);
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

  INSERT INTO public.colaborador_fichas AS f (user_id, organization_id, qtd_filhos, filhos_faixas,
      tem_plano_saude, plano_saude, emergencia_nome, emergencia_parentesco, emergencia_telefone,
      hospital_preferencia, religiao)
  VALUES (_uid, _org, _qtd_filhos,
      CASE WHEN _qtd_filhos = 0 THEN ARRAY[]::text[] ELSE coalesce(_faixas, ARRAY[]::text[]) END,
      _tem_plano_saude, _plano, _en, _ep, _et, _hosp, _rel)
  ON CONFLICT (user_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    qtd_filhos = EXCLUDED.qtd_filhos,
    -- 0 filhos limpa; NULL (tela antiga) mantém o que já estava.
    filhos_faixas = CASE WHEN EXCLUDED.qtd_filhos = 0 THEN ARRAY[]::text[]
                         ELSE coalesce(_faixas, f.filhos_faixas) END,
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
REVOKE ALL ON FUNCTION public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean, text[]) TO authenticated;

-- 4) Tela do staff: igual à 20261029160000 + filhos_faixas (só leitura) -------------------------------
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
          'filhos_faixas', to_jsonb(coalesce(f.filhos_faixas, ARRAY[]::text[])),
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

NOTIFY pgrst, 'reload schema';
