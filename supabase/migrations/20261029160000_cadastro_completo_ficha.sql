-- Aviso/trava da ficha passa a cobrar TODO o cadastro incompleto + ID RE/MAX obrigatório e validado
-- (t_b98f3e4b, pedido de Denis em 29/10/2026, tópico 6238; correção de Denis: CRECI NÃO é cobrado).
--
-- Quem é cobrado de quê (mesma regra da tela "Meu acesso", que mostra CPF/CRECI/ID RE/MAX só para
-- os papéis corretor, gestor e team_leader — canUsePositioning em perfil.tsx):
--   * todos: nome completo (2 palavras ou mais) e telefone WhatsApp (10 a 13 dígitos); a data de
--     nascimento e os campos da ficha continuam vindo de ficha_esta_completa;
--   * corretor/gestor/team_leader NA imobiliária atual: também CPF válido (dígitos verificadores) e
--     ID RE/MAX (9 dígitos começando com 630, único entre todas as pessoas);
--   * staff/admin/administrador principal/financeiro/jurídico sem esses papéis: não cobra CPF nem ID;
--   * CRECI não é cobrado; se preenchido, continua valendo a validação de formato de hoje.
-- Mesmo prazo (ficha_obrigatoria_desde) e mesmo porteiro: antes do prazo aparece com "Preencher
-- depois"; depois trava até completar. Visão da plataforma, "Entrar como" e dono da plataforma
-- continuam fora (ficha_minha_situacao devolve aplica=false). Erro ao calcular as pendências =
-- nenhuma pendência (nunca trava ninguém por erro).
--
-- IDs antigos fora do padrão/duplicados NÃO são apagados nem corrigidos: a pessoa é cobrada a
-- corrigir. Por isso a trava do padrão 630 é um gatilho que só age quando o ID MUDA (um CHECK
-- travaria qualquer outra edição desse perfil).
--
-- Rollback: docs/sql/rollback/20261029160000_cadastro_completo_ficha.rollback.sql
-- Sem BEGIN/COMMIT próprios (o teste a inclui numa transação desfeita).

-- 1) ID RE/MAX: único entre todas as pessoas ATIVAS e no padrão 630 + 6 dígitos -----------------------
-- Hoje há 0 repetidos (conferido antes); o índice antigo por imobiliária continua. Perfis inativos
-- ficam fora para uma conta desativada não prender quem hoje usa aquele ID.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_remax_id_uniq
  ON public.profiles (remax_id) WHERE remax_id IS NOT NULL AND ativo IS TRUE;

CREATE OR REPLACE FUNCTION public.profiles_remax_id_padrao() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF NEW.remax_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.remax_id IS DISTINCT FROM OLD.remax_id)
     AND NEW.remax_id !~ '^630[0-9]{6}$' THEN
    RAISE EXCEPTION 'ID RE/MAX invalido: sao 9 numeros comecando com 630' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.profiles_remax_id_padrao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_remax_id_padrao ON public.profiles;
CREATE TRIGGER trg_profiles_remax_id_padrao
  BEFORE INSERT OR UPDATE OF remax_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_remax_id_padrao();

-- 2) Regras de cadastro ------------------------------------------------------------------------------
-- Papéis que veem CPF/CRECI/ID RE/MAX em "Meu acesso" (na imobiliária informada).
CREATE OR REPLACE FUNCTION public.cadastro_exige_registro(_uid uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = _uid AND ur.organization_id = _org
       AND ur.role::text IN ('corretor', 'gestor', 'team_leader'))
$$;
REVOKE ALL ON FUNCTION public.cadastro_exige_registro(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Lista do que falta (só chaves, sem valores): nome, telefone, cpf, remax_id, remax_id_invalido,
-- remax_id_duplicado. Uso interno (outras RPCs SECURITY DEFINER). Erro = sem pendência.
CREATE OR REPLACE FUNCTION public.cadastro_pendencias(_uid uuid, _org uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _p record;
  _r text[] := ARRAY[]::text[];
  _tel integer;
BEGIN
  SELECT p.nome, p.telefone, p.cpf, p.remax_id INTO _p FROM public.profiles p WHERE p.id = _uid;
  IF NOT FOUND THEN RETURN _r; END IF;
  IF cardinality(array_remove(regexp_split_to_array(
       btrim(regexp_replace(coalesce(_p.nome, ''), '\s+', ' ', 'g')), ' '), '')) < 2 THEN
    _r := _r || 'nome'::text;
  END IF;
  _tel := char_length(regexp_replace(coalesce(_p.telefone, ''), '\D', '', 'g'));
  IF _tel < 10 OR _tel > 13 THEN _r := _r || 'telefone'::text; END IF;
  IF public.cadastro_exige_registro(_uid, _org) THEN
    IF _p.cpf IS NULL OR NOT public.exclusive_valid_cpf(_p.cpf) THEN _r := _r || 'cpf'::text; END IF;
    IF _p.remax_id IS NULL OR btrim(_p.remax_id) = '' THEN
      _r := _r || 'remax_id'::text;
    ELSIF _p.remax_id !~ '^630[0-9]{6}$' THEN
      _r := _r || 'remax_id_invalido'::text;
    ELSIF EXISTS (SELECT 1 FROM public.profiles o
                   WHERE o.remax_id = _p.remax_id AND o.id <> _uid AND o.ativo IS TRUE) THEN
      _r := _r || 'remax_id_duplicado'::text;
    END IF;
  END IF;
  RETURN _r;
EXCEPTION WHEN others THEN
  RETURN ARRAY[]::text[];
END $$;
REVOKE ALL ON FUNCTION public.cadastro_pendencias(uuid, uuid) FROM PUBLIC, anon, authenticated;

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

-- 4) Grava o próprio cadastro (só os campos enviados; null = não mexe) --------------------------------
-- CPF e ID RE/MAX só são gravados para corretor/gestor/team leader (para os outros são ignorados).
CREATE OR REPLACE FUNCTION public.cadastro_salvar_meu(
  _nome text,
  _telefone text,
  _cpf text,
  _remax_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _exige boolean;
  _n text := nullif(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), '');
  _t text := nullif(btrim(coalesce(_telefone, '')), '');
  _c text := nullif(regexp_replace(coalesce(_cpf, ''), '\D', '', 'g'), '');
  _r text := nullif(regexp_replace(coalesce(_remax_id, ''), '\D', '', 'g'), '');
  _dig integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF public.ficha_sessao_restrita() THEN
    RAISE EXCEPTION 'O cadastro so pode ser atualizado pela propria pessoa' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL THEN RAISE EXCEPTION 'Sem imobiliaria ativa' USING ERRCODE = '42501'; END IF;
  _exige := public.cadastro_exige_registro(_uid, _org);

  IF _n IS NOT NULL AND (cardinality(array_remove(regexp_split_to_array(_n, ' '), '')) < 2
                         OR char_length(_n) > 160) THEN
    RAISE EXCEPTION 'Informe o nome completo' USING ERRCODE = '22023';
  END IF;
  IF _t IS NOT NULL THEN
    _dig := char_length(regexp_replace(_t, '\D', '', 'g'));
    IF _dig < 10 OR _dig > 13 OR char_length(_t) > 20 OR _t !~ '^[0-9()+\-. ]+$' THEN
      RAISE EXCEPTION 'Telefone invalido (com DDD)' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NOT _exige THEN
    _c := NULL;
    _r := NULL;
  END IF;
  IF _c IS NOT NULL THEN
    IF char_length(_c) <> 11 THEN RAISE EXCEPTION 'CPF invalido' USING ERRCODE = '22023'; END IF;
    _c := substr(_c, 1, 3) || '.' || substr(_c, 4, 3) || '.' || substr(_c, 7, 3) || '-' || substr(_c, 10, 2);
    IF NOT public.exclusive_valid_cpf(_c) THEN RAISE EXCEPTION 'CPF invalido' USING ERRCODE = '22023'; END IF;
  END IF;
  IF _r IS NOT NULL THEN
    IF _r !~ '^630[0-9]{6}$' THEN
      RAISE EXCEPTION 'ID RE/MAX invalido: sao 9 numeros comecando com 630' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles o WHERE o.remax_id = _r AND o.id <> _uid AND o.ativo IS TRUE) THEN
      RAISE EXCEPTION 'ID RE/MAX ja esta em outro cadastro' USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.profiles p SET
    nome = coalesce(_n, p.nome),
    telefone = coalesce(_t, p.telefone),
    cpf = coalesce(_c, p.cpf),
    remax_id = coalesce(_r, p.remax_id)
  WHERE p.id = _uid
    AND (p.nome IS DISTINCT FROM coalesce(_n, p.nome)
      OR p.telefone IS DISTINCT FROM coalesce(_t, p.telefone)
      OR p.cpf IS DISTINCT FROM coalesce(_c, p.cpf)
      OR p.remax_id IS DISTINCT FROM coalesce(_r, p.remax_id));

  RETURN public.ficha_minha_situacao();
END $$;
REVOKE ALL ON FUNCTION public.cadastro_salvar_meu(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cadastro_salvar_meu(text, text, text, text) TO authenticated;

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
