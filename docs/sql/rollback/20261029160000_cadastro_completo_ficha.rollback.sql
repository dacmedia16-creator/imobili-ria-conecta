-- Rollback de 20261029160000_cadastro_completo_ficha (t_b98f3e4b): volta o aviso/trava a cobrar só a
-- ficha. Restaura ficha_minha_situacao e ficha_colaboradores_listar EXATAMENTE como na 20261029130000
-- (texto copiado), remove a RPC de cadastro, os helpers, o gatilho do padrão 630 e o índice único global.
-- Nenhum dado é apagado: o que a pessoa gravou em nome/telefone/CPF/ID RE/MAX continua no perfil.
BEGIN;

DROP FUNCTION IF EXISTS public.cadastro_salvar_meu(text, text, text, text);
DROP TRIGGER IF EXISTS trg_profiles_remax_id_padrao ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_remax_id_padrao();
DROP INDEX IF EXISTS public.profiles_remax_id_uniq;

CREATE OR REPLACE FUNCTION public.ficha_minha_situacao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _desde timestamptz;
  _f public.colaborador_fichas;
  _nasc date;
  _completa boolean;
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

  RETURN jsonb_build_object(
    'aplica', true,
    'completa', _completa,
    'obrigatoria_a_partir_de', _desde,
    'bloqueia', NOT _completa AND now() >= _desde,
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

DROP FUNCTION IF EXISTS public.cadastro_pendencias(uuid, uuid);
DROP FUNCTION IF EXISTS public.cadastro_exige_registro(uuid, uuid);

COMMIT;
